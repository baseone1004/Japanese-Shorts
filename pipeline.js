import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { CATEGORIES } from './categories.js';
import {
  buildScriptSystemPrompt,
  buildScriptUserMessage,
  SCRIPT_SCHEMA,
  buildMetadataSystemPrompt,
  METADATA_SCHEMA,
  buildImagePromptSystemPrompt,
  IMAGE_PROMPT_SCHEMA,
} from './prompt.js';
import { callClaude } from './llm.js';
import { synthesizeScript, buildSrt, USING_TTS } from './tts.js';
import { concatWav } from './wav.js';

/**
 * 하루에 만들 수 있는 영상 편수 상한.
 *
 * 자동화는 버튼 한 번에 여러 API를 연달아 호출하므로, 코드 실수나 반복 클릭이
 * 곧장 요금으로 이어진다. 실제로 Google Cloud에서 자동화 반복 호출로 예상 밖의
 * 청구가 발생한 적이 있어 상한을 코드에 박아둔다.
 */
const DAILY_LIMIT = Number(process.env.DAILY_VIDEO_LIMIT) || 10;

const OUTPUT_ROOT =
  process.env.OUTPUT_DIR || path.join(os.homedir(), 'OneDrive', 'Desktop', '일본쇼츠');

const COUNTER_FILE = path.join(OUTPUT_ROOT, '.daily-count.json');

/** 오늘 몇 편 만들었는지 세어 상한을 넘지 않게 한다. */
async function checkDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  let state = { date: today, count: 0 };

  if (existsSync(COUNTER_FILE)) {
    try {
      const saved = JSON.parse(await readFile(COUNTER_FILE, 'utf8'));
      if (saved.date === today) state = saved;
    } catch {
      /* 파일이 깨졌으면 새로 시작한다 */
    }
  }

  if (state.count >= DAILY_LIMIT) {
    const err = new Error(
      `오늘 이미 ${state.count}편을 만들었습니다. 하루 상한은 ${DAILY_LIMIT}편입니다.\n` +
        '비용 사고를 막기 위한 제한이며, .env의 DAILY_VIDEO_LIMIT으로 조정할 수 있습니다.',
    );
    err.status = 429;
    throw err;
  }

  return {
    async increment() {
      state.count += 1;
      await writeFile(COUNTER_FILE, JSON.stringify(state), 'utf8');
      return state.count;
    },
    remaining: DAILY_LIMIT - state.count,
  };
}

/** 폴더 이름으로 쓸 수 없는 문자를 정리한다. */
function safeName(s) {
  return (s || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 소재 하나로 캡컷에 넣을 파일 한 세트를 만든다.
 * 각 단계 결과를 onProgress로 알려 화면에서 진행 상황을 볼 수 있게 한다.
 */
export async function buildVideoPackage({
  category,
  topic = '',
  seconds = 30,
  extraInstructions = '',
  voiceId = '',
  emotion = 'normal',
  characterSheet = '',
  onProgress = () => {},
}) {
  const limiter = await checkDailyLimit();
  const steps = [];
  const note = (msg) => {
    steps.push(msg);
    onProgress(msg);
  };

  // 1. 대본
  note('대본 쓰는 중…');
  const scriptOut = await callClaude({
    system: buildScriptSystemPrompt(category, extraInstructions),
    userMessage: buildScriptUserMessage({ topic, seconds }),
    schema: SCRIPT_SCHEMA,
    validate: (r) =>
      Array.isArray(r?.rows) &&
      r.rows.length === 10 &&
      r.rows.every((x) => x?.ja?.trim() && x?.ko?.trim()) &&
      r?.topicKo?.trim(),
  });
  const script = scriptOut.result;
  note(`대본 완성 — ${script.topicKo}`);

  const jaScript = script.rows.map((r) => `${r.timeline} ${r.ja}`).join('\n');

  // 2. 메타데이터와 이미지 프롬프트는 서로 독립이라 동시에 부른다.
  note('메타데이터 · 이미지 프롬프트 만드는 중…');
  const [metaOut, imgOut] = await Promise.all([
    callClaude({
      system: buildMetadataSystemPrompt(category, extraInstructions),
      userMessage:
        '아래는 이 영상의 실제 대본입니다. 제목·설명·태그는 반드시 이 대본에 나오는 소재만 다뤄야 합니다.\n\n' +
        `[대본]\n${jaScript}`,
      schema: METADATA_SCHEMA,
      validate: (r) => r?.titles?.length === 3 && r?.descriptions?.length === 3 && r?.tags?.length,
    }),
    callClaude({
      system: buildImagePromptSystemPrompt(category, characterSheet, extraInstructions),
      userMessage: `아래 대본의 각 컷에 대한 이미지 생성 프롬프트를 만들어줘.\n\n${jaScript}`,
      schema: IMAGE_PROMPT_SCHEMA,
      validate: (r) => r?.prompts?.length > 0,
    }),
  ]);
  note('메타데이터 · 이미지 프롬프트 완성');

  // 3. 음성 (키가 없으면 이 단계만 건너뛴다)
  let tts = null;
  if (USING_TTS && voiceId) {
    note(`음성 만드는 중… (${script.rows.length}컷)`);
    tts = await synthesizeScript({ rows: script.rows, voiceId, emotion });
    note(`음성 완성 — ${tts.totalDuration.toFixed(1)}초`);
  } else {
    note(USING_TTS ? '목소리를 고르지 않아 음성은 건너뜁니다.' : 'TYPECAST_API_KEY가 없어 음성은 건너뜁니다.');
  }

  // 4. 파일로 저장
  const dir = path.join(OUTPUT_ROOT, `${stamp()} ${safeName(script.topicKo)}`);
  await mkdir(dir, { recursive: true });

  const files = [];
  const save = async (name, content) => {
    await writeFile(path.join(dir, name), content);
    files.push(name);
  };

  await save('대본.txt', renderScriptTxt(script));
  await save('메타데이터.txt', renderMetaTxt(metaOut.result));
  await save('이미지프롬프트.txt', renderImageTxt(imgOut.result));

  if (tts) {
    await save('voice.wav', concatWav(tts.clips.map((c) => c.audio)));
    await save('자막.srt', buildSrt({ clips: tts.clips, rows: script.rows }));
  } else {
    // 음성이 없으면 대본의 추정 타임라인으로 임시 자막을 만들어 둔다.
    await save('자막(추정).srt', srtFromTimeline(script.rows));
  }

  await save('_읽어보세요.txt', renderReadme({ hasVoice: Boolean(tts), files }));

  const count = await limiter.increment();
  note(`완료 — 오늘 ${count}/${DAILY_LIMIT}편`);

  return {
    folder: dir,
    files,
    steps,
    topicKo: script.topicKo,
    durationSec: tts?.totalDuration ?? null,
    usage: {
      input: scriptOut.usage.input + metaOut.usage.input + imgOut.usage.input,
      output: scriptOut.usage.output + metaOut.usage.output + imgOut.usage.output,
    },
    remainingToday: DAILY_LIMIT - count,
    script,
    metadata: metaOut.result,
    imagePrompts: imgOut.result.prompts,
  };
}

// ─── 파일 내용 렌더링 ────────────────────────────────────────────────────

function renderScriptTxt(s) {
  const rows = s.rows
    .map((r, i) => `${String(i + 1).padStart(2, '0')}. [${r.timeline}]\n    ${r.ja}\n    ${r.ko}`)
    .join('\n\n');
  return [
    `주제: ${s.topicKo}`,
    `주제(JA): ${s.topicJa}`,
    `길이: 약 ${s.totalSeconds}초 · ${s.rows.length}컷`,
    '',
    '─'.repeat(50),
    rows,
    '',
    '─'.repeat(50),
    '[제작 메모]',
    s.productionNoteKo,
  ].join('\n');
}

function renderMetaTxt(m) {
  return [
    '■ 1. 일본어 제목 (3안)',
    ...m.titles.map((t, i) => `${i + 1}. [${t.angleKo}] ${t.ja}\n   ${t.ko}`),
    '',
    '■ 2. 일본어 설명 (3안)',
    ...m.descriptions.map((d, i) => `${i + 1}. [${d.angleKo}] ${d.ja}\n   ${d.ko}`),
    '',
    '■ 3. 태그',
    m.tags.map((t) => t.ja).join(' '),
    m.tags.map((t) => t.ko).join(' '),
  ].join('\n');
}

function renderImageTxt(r) {
  return r.prompts
    .map(
      (p, i) =>
        `${'='.repeat(50)}\n[컷 ${i + 1}] ${p.timeline}  ${p.sceneKo}\n${'='.repeat(50)}\n${p.prompt}\n`,
    )
    .join('\n');
}

function srtTime(sec) {
  const ms = Math.round(sec * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(
    Math.floor((ms % 60000) / 1000),
  )},${p(ms % 1000, 3)}`;
}

/** 음성이 없을 때 대본의 mm:ss 타임라인으로 만드는 임시 자막. */
function srtFromTimeline(rows) {
  const toSec = (t) => {
    const [m, s] = String(t).split(':').map(Number);
    return (m || 0) * 60 + (s || 0);
  };
  return rows
    .map((r, i) => {
      const start = toSec(r.timeline);
      const end = i + 1 < rows.length ? toSec(rows[i + 1].timeline) : start + 3;
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${r.ja.replace(/\s*\/\s*/g, '\n')}\n`;
    })
    .join('\n');
}

function renderReadme({ hasVoice }) {
  return [
    '캡컷에서 이렇게 쓰세요',
    '='.repeat(40),
    '',
    '1. 캡컷을 열고 새 프로젝트를 만듭니다 (9:16 세로).',
    hasVoice
      ? '2. voice.wav 를 타임라인으로 끌어다 놓습니다.'
      : '2. (음성 파일 없음 — TYPECAST_API_KEY를 넣으면 자동으로 만들어집니다)',
    hasVoice
      ? '3. 자막.srt 를 끌어다 놓으면 자막이 통째로 들어갑니다.'
      : '3. 자막(추정).srt 를 끌어다 놓습니다. 실제 음성에 맞춰 타이밍 조정이 필요합니다.',
    '4. 이미지프롬프트.txt 의 프롬프트로 그림을 만들어 컷 순서대로 배치합니다.',
    '5. BGM을 깔고 볼륨을 20~30%로 낮춥니다.',
    '',
    '메타데이터.txt 의 제목·설명·태그는 업로드할 때 씁니다.',
    '',
    '※ 자막 폰트와 위치는 캡컷에서 한 번 설정해 두면 다음에도 재사용됩니다.',
  ].join('\n');
}

export { DAILY_LIMIT, OUTPUT_ROOT };
