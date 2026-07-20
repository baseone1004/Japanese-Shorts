import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

import { CATEGORY_LIST, CATEGORIES } from './categories.js';
import {
  buildTopicsSystemPrompt,
  TOPICS_SCHEMA,
  buildScriptSystemPrompt,
  buildScriptUserMessage,
  SCRIPT_SCHEMA,
  buildTranslateSystemPrompt,
  TRANSLATE_SCHEMA,
  buildMetadataSystemPrompt,
  METADATA_SCHEMA,
} from './prompt.js';
import { generateImage, CHARACTER_PATH, SHORTS_ASPECT } from './image.js';

const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 32000;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const client = new Anthropic();

app.get('/api/categories', (_req, res) => {
  res.json({ categories: CATEGORY_LIST });
});

/**
 * 세 모드가 공유하는 Claude 호출부.
 * max_tokens가 크므로 스트리밍으로 보내고 최종 메시지만 수거한다 (HTTP 타임아웃 회피).
 */
async function callClaude({ system, userMessage, schema }) {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema },
    },
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new HttpError(422, '모델이 이 요청의 처리를 거부했습니다.');
  }

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock) {
    throw new HttpError(502, '모델이 텍스트를 반환하지 않았습니다.');
  }

  let data;
  try {
    data = JSON.parse(textBlock.text);
  } catch {
    throw new HttpError(502, '모델 응답을 JSON으로 해석하지 못했습니다.');
  }

  return {
    usage: { input: message.usage.input_tokens, output: message.usage.output_tokens },
    truncated: message.stop_reason === 'max_tokens',
    result: data,
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 카테고리를 검증하고 정규화된 id를 반환. */
function validate(req) {
  const { category = 'general' } = req.body ?? {};
  if (!CATEGORIES[category]) {
    throw new HttpError(400, `알 수 없는 카테고리: ${category}`);
  }
  return category;
}

/** 입력 검증을 모두 통과한 뒤, Claude 호출 직전에만 확인한다. */
function requireApiKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(
      401,
      'ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.example을 .env로 복사한 뒤 키를 넣고 서버를 재시작하세요.',
    );
  }
}

function requireScript(req) {
  const script = req.body?.script;
  if (typeof script !== 'string' || !script.trim()) {
    throw new HttpError(400, '대본이 비어 있습니다.');
  }
  return script.trim();
}

// ── 모드 0: 주제 추천 ────────────────────────────────────────────────────
app.post('/api/topics', async (req, res) => {
  try {
    const category = validate(req);
    requireApiKey();

    const out = await callClaude({
      system: buildTopicsSystemPrompt(category, req.body?.extraInstructions ?? ''),
      userMessage: `카테고리: ${CATEGORIES[category].label}\n이 카테고리로 쇼츠 주제 10개를 제안해줘.`,
      schema: TOPICS_SCHEMA,
    });

    res.json({ category, categoryLabel: CATEGORIES[category].label, ...out });
  } catch (err) {
    sendError(res, err);
  }
});

// ── 모드 1: 대본 생성 ────────────────────────────────────────────────────
app.post('/api/script', async (req, res) => {
  try {
    const category = validate(req);
    const { topic = '', seconds = 30, extraInstructions = '' } = req.body ?? {};

    const dur = Number(seconds);
    if (!Number.isFinite(dur) || dur < 10 || dur > 180) {
      throw new HttpError(400, '길이는 10~180초 사이여야 합니다.');
    }
    requireApiKey();

    const out = await callClaude({
      system: buildScriptSystemPrompt(category, extraInstructions),
      userMessage: buildScriptUserMessage({ topic, seconds: dur }),
      schema: SCRIPT_SCHEMA,
    });

    res.json({ category, categoryLabel: CATEGORIES[category].label, ...out });
  } catch (err) {
    sendError(res, err);
  }
});

// ── 모드 2: 대본 번역 ────────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  try {
    const category = validate(req);
    const script = requireScript(req);
    requireApiKey();

    const out = await callClaude({
      system: buildTranslateSystemPrompt(category, req.body?.extraInstructions ?? ''),
      userMessage: script,
      schema: TRANSLATE_SCHEMA,
    });

    res.json({ category, categoryLabel: CATEGORIES[category].label, ...out });
  } catch (err) {
    sendError(res, err);
  }
});

// ── 모드 3: 메타데이터 ───────────────────────────────────────────────────
app.post('/api/metadata', async (req, res) => {
  try {
    const category = validate(req);
    const script = requireScript(req);
    requireApiKey();

    const out = await callClaude({
      system: buildMetadataSystemPrompt(category, req.body?.extraInstructions ?? ''),
      userMessage: script,
      schema: METADATA_SCHEMA,
    });

    res.json({ category, categoryLabel: CATEGORIES[category].label, ...out });
  } catch (err) {
    sendError(res, err);
  }
});

// ── 모드 4: 쇼츠 이미지 생성 (Gemini) ────────────────────────────────────
app.post('/api/image', async (req, res) => {
  try {
    const { scene, overlayText = '', useCharacter = true } = req.body ?? {};
    if (typeof scene !== 'string' || !scene.trim()) {
      throw new HttpError(400, '장면 설명이 비어 있습니다.');
    }

    const out = await generateImage({
      scene: scene.trim(),
      overlayText,
      useCharacter: Boolean(useCharacter),
    });

    res.json({ aspect: SHORTS_ASPECT, ...out });
  } catch (err) {
    sendError(res, err);
  }
});

/** 캐릭터 참조 이미지가 준비돼 있는지 프론트에서 미리 알려주기 위한 엔드포인트. */
app.get('/api/image/status', async (_req, res) => {
  const { existsSync } = await import('node:fs');
  res.json({
    hasKey: Boolean(process.env.GEMINI_API_KEY),
    hasCharacter: existsSync(CHARACTER_PATH),
    characterPath: CHARACTER_PATH,
    aspect: SHORTS_ASPECT,
  });
});

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // image.js 등에서 status를 직접 붙여 던진 오류
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);

  if (err instanceof Anthropic.AuthenticationError) {
    return res.status(401).json({ error: 'ANTHROPIC_API_KEY가 없거나 잘못되었습니다.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: '요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.' });
  }
  if (err instanceof Anthropic.APIError) {
    return res.status(502).json({ error: `Claude API 오류 (${err.status}): ${err.message}` });
  }
  res.status(500).json({ error: String(err?.message ?? err) });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\n  일본 쇼츠 번역기 → http://localhost:${port}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠  ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.\n');
  }
});
