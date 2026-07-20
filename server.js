import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

import { CATEGORY_LIST, CATEGORIES } from './categories.js';
import { buildSystemPrompt, OUTPUT_SCHEMA } from './prompt.js';

const MODEL = 'claude-opus-4-8';
const MAX_TOKENS = 32000;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const client = new Anthropic();

app.get('/api/categories', (_req, res) => {
  res.json({ categories: CATEGORY_LIST });
});

app.post('/api/translate', async (req, res) => {
  const { script, category = 'general', extraInstructions = '' } = req.body ?? {};

  if (typeof script !== 'string' || !script.trim()) {
    return res.status(400).json({ error: '대본(script)이 비어 있습니다.' });
  }
  if (!CATEGORIES[category]) {
    return res.status(400).json({ error: `알 수 없는 카테고리: ${category}` });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(401).json({
      error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.example을 .env로 복사한 뒤 키를 넣고 서버를 재시작하세요.',
    });
  }

  try {
    // max_tokens가 크므로 스트리밍으로 보내고 최종 메시지만 수거한다 (HTTP 타임아웃 회피).
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system: buildSystemPrompt(category, extraInstructions),
      messages: [{ role: 'user', content: script }],
    });

    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return res.status(422).json({ error: '모델이 이 요청의 처리를 거부했습니다.' });
    }

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: '모델이 텍스트를 반환하지 않았습니다.' });
    }

    let data;
    try {
      data = JSON.parse(textBlock.text);
    } catch {
      return res.status(502).json({
        error: '모델 응답을 JSON으로 해석하지 못했습니다.',
        raw: textBlock.text.slice(0, 2000),
      });
    }

    res.json({
      category,
      categoryLabel: CATEGORIES[category].label,
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
      },
      truncated: message.stop_reason === 'max_tokens',
      result: data,
    });
  } catch (err) {
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
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\n  일본 쇼츠 번역기 → http://localhost:${port}\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('  ⚠  ANTHROPIC_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.\n');
  }
});
