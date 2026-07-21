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
  buildImagePromptSystemPrompt,
  IMAGE_PROMPT_SCHEMA,
  DEFAULT_CHARACTER_SHEET,
  buildDiscoverSystemPrompt,
  DISCOVER_SCHEMA,
} from './prompt.js';
import { callClaude, assertConfigured, providerInfo, USING_KIE, MODEL } from './llm.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

app.get('/api/categories', (_req, res) => {
  res.json({ categories: CATEGORY_LIST, provider: providerInfo() });
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * 카테고리를 검증한다.
 * 기본 프리셋이면 id 문자열을, 발굴 기능이 만든 커스텀이면 프리셋 객체를 반환한다.
 * 프롬프트 빌더가 두 형태를 모두 받는다.
 */
function validate(req) {
  const { category = 'general', customCategory } = req.body ?? {};

  if (typeof category === 'string' && category.startsWith('custom:')) {
    const c = customCategory;
    const ok =
      c && typeof c.label === 'string' && typeof c.tone === 'string' &&
      Array.isArray(c.hooks) && Array.isArray(c.tags) && typeof c.notes === 'string';
    if (!ok) throw new HttpError(400, '커스텀 카테고리 정보가 올바르지 않습니다.');
    return c;
  }

  if (!CATEGORIES[category]) {
    throw new HttpError(400, `알 수 없는 카테고리: ${category}`);
  }
  return category;
}

/** 응답에 표시할 카테고리 이름. */
function labelOf(category) {
  return typeof category === 'object' ? category.label : CATEGORIES[category].label;
}

/** 입력 검증을 모두 통과한 뒤, 모델 호출 직전에만 확인한다. */
function requireApiKey() {
  assertConfigured();
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
      userMessage: `카테고리: ${labelOf(category)}\n이 카테고리로 쇼츠 주제 10개를 제안해줘.`,
      schema: TOPICS_SCHEMA,
      validate: (r) => r?.topics?.length > 0,
    });

    res.json({ category: req.body?.category ?? "general", categoryLabel: labelOf(category), ...out });
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
      validate: (r) => r?.rows?.length > 0,
    });

    res.json({ category: req.body?.category ?? "general", categoryLabel: labelOf(category), ...out });
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
      validate: (r) => r?.rows?.length > 0 && r?.titles?.length > 0,
    });

    res.json({ category: req.body?.category ?? "general", categoryLabel: labelOf(category), ...out });
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
      validate: (r) => r?.titles?.length > 0 && r?.descriptions?.length > 0 && r?.tags?.length > 0,
    });

    res.json({ category: req.body?.category ?? "general", categoryLabel: labelOf(category), ...out });
  } catch (err) {
    sendError(res, err);
  }
});

// ── 모드 4: 이미지 프롬프트 ──────────────────────────────────────────────
app.post('/api/imageprompts', async (req, res) => {
  try {
    const category = validate(req);
    const script = requireScript(req);
    const { characterSheet = '', extraInstructions = '' } = req.body ?? {};
    requireApiKey();

    const out = await callClaude({
      system: buildImagePromptSystemPrompt(category, characterSheet, extraInstructions),
      userMessage: `아래 대본의 각 컷에 대한 이미지 생성 프롬프트를 만들어줘.\n\n${script}`,
      schema: IMAGE_PROMPT_SCHEMA,
      validate: (r) => r?.prompts?.length > 0,
    });

    res.json({ category: req.body?.category ?? "general", categoryLabel: labelOf(category), ...out });
  } catch (err) {
    sendError(res, err);
  }
});

/** 화면에서 캐릭터 묘사 기본값을 채워 넣기 위한 엔드포인트. */
app.get('/api/character-sheet', (_req, res) => {
  res.json({ characterSheet: DEFAULT_CHARACTER_SHEET });
});

// ── 모드 5: 카테고리 발굴 ────────────────────────────────────────────────
app.post('/api/discover', async (req, res) => {
  try {
    const { count = 6, extraInstructions = '' } = req.body ?? {};
    const n = Number(count);
    if (!Number.isFinite(n) || n < 1 || n > 12) {
      throw new HttpError(400, '제안 개수는 1~12 사이여야 합니다.');
    }
    requireApiKey();

    const existing = CATEGORY_LIST.map((c) => c.label).join(', ');
    const out = await callClaude({
      system: buildDiscoverSystemPrompt(extraInstructions),
      userMessage:
        `일본 유튜브 쇼츠로 새로 파볼 만한 카테고리를 ${n}개 제안해줘.\n` +
        `이미 쓰고 있는 카테고리(겹치지 않게 할 것): ${existing}`,
      schema: DISCOVER_SCHEMA,
      validate: (r) => r?.ideas?.length > 0,
    });

    res.json(out);
  } catch (err) {
    sendError(res, err);
  }
});

function sendError(res, err) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  // llm.js가 status를 직접 붙여 던진 오류
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 600) {
    return res.status(err.status).json({ error: err.message });
  }

  console.error(err);

  const where = USING_KIE ? 'KIE' : 'Anthropic';

  if (err instanceof Anthropic.AuthenticationError) {
    const key = USING_KIE ? 'KIE_API_KEY' : 'ANTHROPIC_API_KEY';
    return res.status(401).json({ error: `${key}가 없거나 잘못되었습니다.` });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: `${where} 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.` });
  }
  if (err instanceof Anthropic.APIError) {
    return res.status(502).json({ error: `${where} API 오류 (${err.status}): ${err.message}` });
  }
  res.status(500).json({ error: String(err?.message ?? err) });
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\n  일본 쇼츠 스튜디오 → http://localhost:${port}`);
  console.log(`  텍스트: ${MODEL} (${USING_KIE ? 'KIE 경유 — 약 60% 저렴' : 'Anthropic 직접'})\n`);

  if (!USING_KIE && !process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠  API 키가 없습니다. .env에 KIE_API_KEY 또는 ANTHROPIC_API_KEY를 넣으세요.');
  }
  console.log('');
});
