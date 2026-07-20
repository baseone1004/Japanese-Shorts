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
    // KIE는 Authorization: Bearer <key>를 기대한다. SDK의 authToken이 그 형태로 보낸다.
    client = new Anthropic({ authToken: process.env.KIE_API_KEY, baseURL: KIE_BASE_URL });
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

export async function callClaude({ system, userMessage, schema }) {
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
