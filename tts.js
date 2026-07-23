/**
 * 타입캐스트 TTS 연동.
 *
 * 타임스탬프 엔드포인트를 써서 음성과 함께 글자 단위 정렬 데이터를 받는다.
 * 그 타이밍으로 SRT 자막을 만들면 대본의 추정 타임라인이 아니라 실제 음성에
 * 맞는 자막이 나온다.
 */

const BASE = 'https://api.typecast.ai';
const MODEL = 'ssfm-v30';

export const USING_TTS = Boolean(process.env.TYPECAST_API_KEY);

class TtsError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function headers() {
  if (!process.env.TYPECAST_API_KEY) {
    throw new TtsError(
      401,
      'TYPECAST_API_KEY가 없습니다. https://studio.typecast.ai/developers 에서 발급받아 .env에 넣으세요.',
    );
  }
  return {
    'X-API-KEY': process.env.TYPECAST_API_KEY,
    'Content-Type': 'application/json',
  };
}

/** 목소리 목록. 타입캐스트에 언어 필터가 없어 전체를 받아 화면에서 고르게 한다. */
export async function listVoices() {
  const res = await fetch(`${BASE}/v2/voices?model=${MODEL}`, { headers: headers() });
  if (!res.ok) {
    throw new TtsError(res.status, `타입캐스트 목소리 목록 실패 (${res.status})`);
  }
  const data = await res.json();
  const voices = Array.isArray(data) ? data : (data.voices ?? []);
  return voices.map((v) => ({
    id: v.voice_id,
    name: v.voice_name,
    gender: v.gender,
    age: v.age,
  }));
}

/**
 * 한 컷을 읽어 음성과 글자 타이밍을 받는다.
 * 일본어는 단어 단위 정렬이 문장 전체를 하나로 묶어버려서 char를 써야 한다(공식 문서 명시).
 */
async function speakOne({ text, voiceId, emotion }) {
  const res = await fetch(`${BASE}/v1/text-to-speech/with-timestamps?granularity=char`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      voice_id: voiceId,
      text,
      model: MODEL,
      language: 'jpn',
      prompt: {
        emotion_type: 'preset',
        emotion_preset: emotion || 'normal',
        emotion_intensity: 1.0,
      },
      output: { audio_format: 'wav', volume: 100 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new TtsError(401, 'TYPECAST_API_KEY가 잘못되었거나 권한이 없습니다.');
    }
    if (res.status === 429) {
      throw new TtsError(429, '타입캐스트 사용량 한도를 초과했습니다.');
    }
    throw new TtsError(502, `타입캐스트 오류 (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    audio: Buffer.from(data.audio, 'base64'),
    duration: data.audio_duration,
    characters: data.characters ?? [],
  };
}

/** 자막에는 화면 분할용 '/'가 들어가면 안 되므로 읽기 전에 뗀다. */
function forSpeech(ja) {
  return ja.replace(/\s*\/\s*/g, ' ').trim();
}

/**
 * 컷별로 음성을 만들고, 각 컷이 전체 타임라인에서 언제 시작하는지 계산한다.
 * 컷 사이에는 짧은 무음을 넣어 숨 쉴 틈을 준다.
 */
export async function synthesizeScript({ rows, voiceId, emotion, gapMs = 250 }) {
  const clips = [];
  let cursor = 0;

  for (const row of rows) {
    const text = forSpeech(row.ja);
    if (!text) continue;

    const out = await speakOne({ text, voiceId, emotion });
    clips.push({
      index: clips.length,
      text,
      audio: out.audio,
      start: cursor,
      end: cursor + out.duration,
      duration: out.duration,
      characters: out.characters,
    });
    cursor += out.duration + gapMs / 1000;
  }

  return { clips, totalDuration: cursor };
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
}

/**
 * 대본의 '/' 단위로 자막을 쪼갠다.
 *
 * 타입캐스트가 돌려준 글자 단위 타이밍을 그대로 쓴다. 글자수 비례로 나누면
 * 말이 빠른 구간과 느린 구간이 어긋나고, 앞뒤 무음까지 자막에 포함된다.
 * 실제 타이밍을 쓰면 소리가 나는 순간에 자막이 뜬다.
 */
export function buildSrt({ clips, rows }) {
  const entries = [];

  clips.forEach((clip, i) => {
    const ja = rows[i]?.ja ?? clip.text;
    const parts = ja.split('/').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;

    const timed = sliceByCharTiming(clip, parts);
    if (timed) {
      entries.push(...timed);
      return;
    }

    // 글자 타이밍을 못 받았을 때만 길이 비례로 나눈다.
    const totalChars = parts.reduce((n, p) => n + p.length, 0);
    let t = clip.start;
    parts.forEach((part, n) => {
      const end = n === parts.length - 1 ? clip.end : t + (part.length / totalChars) * clip.duration;
      entries.push({ start: t, end, text: part });
      t = end;
    });
  });

  return entries
    .map((e, i) => `${i + 1}\n${srtTime(e.start)} --> ${srtTime(e.end)}\n${e.text}\n`)
    .join('\n');
}

/**
 * 글자 타이밍 배열을 걸어가며 각 조각이 실제로 발음되는 구간을 찾는다.
 * 읽은 텍스트는 '/'가 공백으로 바뀐 형태라, 조각의 글자를 순서대로 대조하면
 * 어느 타이밍 항목까지가 그 조각인지 알 수 있다.
 */
function sliceByCharTiming(clip, parts) {
  const chars = clip.characters;
  if (!Array.isArray(chars) || !chars.length) return null;

  const out = [];
  let idx = 0;

  for (const part of parts) {
    // 조각 시작 전의 공백은 건너뛴다.
    while (idx < chars.length && !chars[idx].text.trim()) idx++;
    if (idx >= chars.length) return null;

    const startIdx = idx;
    let matched = 0;
    const target = part.replace(/\s/g, '');

    while (idx < chars.length && matched < target.length) {
      const t = chars[idx].text;
      if (t.trim()) matched += t.length;
      idx++;
    }

    // 대조가 어긋나면 신뢰할 수 없으므로 비례 분할로 넘긴다.
    if (matched < target.length) return null;

    out.push({
      start: clip.start + chars[startIdx].start,
      end: clip.start + chars[idx - 1].end,
      text: part,
    });
  }

  return out;
}

export { TtsError };
