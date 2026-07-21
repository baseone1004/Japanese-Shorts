import Anthropic from '@anthropic-ai/sdk';

/**
 * 텍스트 생성 호출부.
 *
 * 같은 Claude 모델을 두 경로 중 하나로 부른다:
 *  - KIE_API_KEY가 있으면 KIE 프록시 경유 (동일 모델, 약 60% 저렴)
 *  - 없으면 Anthropic 직접 호출
 *
 * KIE는 Anthropic 호환 엔드포인트를 제공하므로 baseURL만 갈아끼우면 된다.
 * 다만 프록시가 구조화 출력(output_config)이나 adaptive thinking 같은
 * 최신 파라미터를 통과시키는지는 보장되지 않아, 거부당하면 JSON 모드로 재시도한다.
 */

const KIE_BASE_URL = 'https://api.kie.ai/claude';
const MAX_TOKENS = 32000;

export const MODEL = process.env.LLM_MODEL || 'claude-opus-4-8';
export const USING_KIE = Boolean(process.env.KIE_API_KEY);

let client = null;
function getClient() {
  if (client) return client;

  if (USING_KIE) {
    client = new Anthropic({
      // KIE는 Authorization: Bearer <key>를 기대한다. SDK의 authToken이 그 형태로 보낸다.
      authToken: process.env.KIE_API_KEY,
      baseURL: KIE_BASE_URL,
      // KIE의 방화벽이 SDK 기본 User-Agent("Anthropic/JS ...")를 403으로 차단한다.
      // 다른 값이면 무엇이든 통과하므로 앱 이름으로 바꿔 보낸다.
      // (검증: Anthropic/JS만 403, node·curl·앱이름 등은 모두 200)
      defaultHeaders: { 'User-Agent': 'japanese-shorts/1.0' },
    });
  } else {
    client = new Anthropic(); // ANTHROPIC_API_KEY를 환경변수에서 읽는다
  }
  return client;
}

export class LlmError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 어떤 경로도 쓸 수 없는 상태면 그 사실을 명확히 알린다. */
export function assertConfigured() {
  if (!USING_KIE && !process.env.ANTHROPIC_API_KEY) {
    throw new LlmError(
      401,
      'API 키가 없습니다. .env에 KIE_API_KEY(권장, 더 저렴) 또는 ANTHROPIC_API_KEY 중 하나를 넣고 서버를 재시작하세요.',
    );
  }
}

/**
 * 구조화 출력을 지원하지 않는 경로를 위한 폴백.
 * 스키마를 시스템 프롬프트에 박아넣고 JSON만 뱉게 한다.
 */
function withSchemaInPrompt(system, schema) {
  return [
    system,
    '',
    '[출력 스키마]',
    '아래 JSON Schema를 정확히 만족하는 JSON 객체 하나만 출력하세요.',
    '설명·서론·마크다운 코드펜스 없이 여는 중괄호로 시작해서 닫는 중괄호로 끝나야 합니다.',
    '',
    JSON.stringify(schema, null, 2),
  ].join('\n');
}

/** 모델이 코드펜스를 씌워 보내는 경우가 있어 벗겨내고 파싱한다. (테스트를 위해 export) */
export function parseJson(text) {
  let s = text.trim();

  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }

  try {
    return JSON.parse(s);
  } catch (err) {
    // 앞이나 뒤에 설명이 붙어 온 경우 가장 바깥 중괄호 범위만 잘라 다시 시도한다.
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) throw err;
    return JSON.parse(s.slice(start, end + 1));
  }
}

function extractText(message) {
  const block = message.content.find((b) => b.type === 'text');
  if (!block) throw new LlmError(502, '모델이 텍스트를 반환하지 않았습니다.');
  return block.text;
}

/** 프록시가 최신 파라미터를 거부했는지 판별한다. */
function looksLikeUnsupportedParam(err) {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status !== 400 && err.status !== 422) return false;
  return /output_config|thinking|unknown|unsupported|invalid.*(field|parameter|property)/i.test(
    err.message ?? '',
  );
}

/**
 * @param validate  결과가 쓸만한지 검사하는 함수. false를 반환하면 한 번 재시도한다.
 *                  KIE 프록시가 간헐적으로 필수 배열이 빈 채로 응답을 돌려주는 일이 있어
 *                  (스키마는 통과하지만 내용이 없음) 호출부가 직접 검사할 수 있게 열어둔다.
 */
/**
 * KIE는 사용량 한도 초과 같은 오류를 스트리밍이 아닌 일반 JSON으로 돌려준다.
 * 그러면 SDK는 "chunks를 못 받았다"고만 알려주어 원인이 드러나지 않는다.
 * 실제 사유를 확인하려고 짧은 비스트리밍 요청을 한 번 더 보내 본문을 읽는다.
 */
async function probeRealError() {
  try {
    const res = await fetch(`${KIE_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.KIE_API_KEY}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const body = await res.json();
    const msg = body?.msg ?? body?.error?.message;
    if (!msg) return null;

    if (/one hour limit/i.test(msg)) {
      return 'KIE 키의 시간당 사용 한도를 초과했습니다. 1시간 뒤에 풀리거나, kie.ai → API Keys → Safe-Spend Limits에서 한도를 올리면 됩니다.';
    }
    if (/da(y|ily) limit/i.test(msg)) {
      return 'KIE 키의 일일 사용 한도를 초과했습니다. 자정에 풀리거나, Safe-Spend Limits에서 한도를 올리면 됩니다.';
    }
    if (/total limit/i.test(msg)) {
      return 'KIE 키의 총 사용 한도를 초과했습니다. Safe-Spend Limits에서 한도를 올려주세요.';
    }
    if (/insufficient|balance|credit/i.test(msg)) {
      return 'KIE 잔액이 부족합니다. kie.ai → Billing에서 크레딧을 충전해 주세요.';
    }
    return `KIE 응답: ${msg}`;
  } catch {
    return null;
  }
}

/**
 * KIE 프록시는 간헐적으로 응답을 못 보내고 연결을 끊는다
 * ("request ended without sending any chunks"). 재시도로 대부분 해결된다.
 */
function isTransient(err) {
  if (err instanceof LlmError) return false;
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError && err.status >= 500) return true;
  return /without sending any chunks|socket hang up|ECONNRESET|ETIMEDOUT|aborted|terminated/i.test(
    err?.message ?? '',
  );
}

const ATTEMPTS = 3;

export async function callClaude({ system, userMessage, schema, validate }) {
  let lastErr = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let out;
    try {
      out = await callOnce({ system, userMessage, schema });
    } catch (err) {
      if (!isTransient(err) || attempt === ATTEMPTS) {
        // 마지막 시도까지 실패했다면 KIE에 진짜 사유를 물어본다.
        if (USING_KIE && isTransient(err)) {
          const reason = await probeRealError();
          if (reason) throw new LlmError(429, reason);
        }
        throw err;
      }
      lastErr = err;
      console.warn(`[llm] 통신 실패 (${attempt}/${ATTEMPTS}): ${err.message} — 재시도합니다.`);
      await sleep(1000 * attempt);
      continue;
    }

    if (!validate || validate(out.result)) {
      return attempt > 1 ? { ...out, retried: true } : out;
    }

    if (attempt === ATTEMPTS) break;
    console.warn(`[llm] 응답 내용이 불완전합니다 (${attempt}/${ATTEMPTS}) — 재시도합니다.`);
  }

  throw new LlmError(
    502,
    lastErr
      ? '모델 서버와 통신이 계속 실패합니다. 잠시 후 다시 시도해 주세요.'
      : '모델이 불완전한 응답을 반복해서 반환했습니다. 잠시 후 다시 시도해 주세요.',
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOnce({ system, userMessage, schema }) {
  assertConfigured();
  const anthropic = getClient();

  const base = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: userMessage }],
  };

  let message;
  let mode = 'structured';

  try {
    message = await anthropic.messages
      .stream({
        ...base,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema } },
        system,
      })
      .finalMessage();
  } catch (err) {
    if (!looksLikeUnsupportedParam(err)) throw err;

    // 프록시가 구조화 출력을 지원하지 않는다. 스키마를 프롬프트에 넣어 재시도.
    console.warn(`[llm] 구조화 출력 거부됨 (${err.message}). JSON 프롬프트 모드로 재시도합니다.`);
    mode = 'json-prompt';
    message = await anthropic.messages
      .stream({ ...base, system: withSchemaInPrompt(system, schema) })
      .finalMessage();
  }

  if (message.stop_reason === 'refusal') {
    throw new LlmError(422, '모델이 이 요청의 처리를 거부했습니다.');
  }

  let result;
  try {
    result = parseJson(extractText(message));
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError(502, '모델 응답을 JSON으로 해석하지 못했습니다.');
  }

  return {
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
    truncated: message.stop_reason === 'max_tokens',
    provider: USING_KIE ? 'kie' : 'anthropic',
    model: MODEL,
    mode,
    result,
  };
}

/** 프론트에 현재 어떤 경로로 돌고 있는지 알려주기 위한 정보. */
export function providerInfo() {
  return {
    provider: USING_KIE ? 'kie' : 'anthropic',
    model: MODEL,
    configured: USING_KIE || Boolean(process.env.ANTHROPIC_API_KEY),
  };
}
