import { renderCategoryBlock, CATEGORIES } from './categories.js';

const LANG_SEPARATION_RULE = `[⚠️ 절대 주의사항 - 언어 분리]
- 한국어가 쓰여야 할 필드(ko로 끝나는 모든 필드)에는 반드시 한국어만 표기하세요.
- 일본어가 쓰여야 할 필드(ja로 끝나는 모든 필드)에는 반드시 일본어만 표기하세요.
- 일본어와 한국어를 한 필드나 한 문장 안에 실수로 혼용하는 일이 절대 없도록 철저히 검증 후 출력하세요.
- 고유명사·브랜드명 등 원어 표기가 필수인 경우만 예외로 허용합니다.`;

const JSON_ONLY_RULE = `[출력 형식]
결과는 지정된 JSON 스키마로만 출력합니다. 서론·후기·마크다운 코드펜스 없이 JSON 객체 하나만 반환하세요.`;

// ─────────────────────────────────────────────────────────────────────────
// 모드 1: 대본 생성 — 카테고리(+주제)만으로 일본어 쇼츠 대본을 새로 쓴다.
// ─────────────────────────────────────────────────────────────────────────

const SCRIPT_PROMPT = `[역할 및 페르소나]
당신은 일본 유튜브 쇼츠(Shorts) 전문 작가입니다. 주어진 카테고리와 주제로, 일본 시청자를 대상으로 한 쇼츠 대본을 처음부터 창작합니다. 인사말이나 서론 없이 즉시 대본만 만듭니다.

[대본 작성 규칙]
1. 첫 3초 안에 훅(hook)이 들어가야 합니다. 결론·충격 포인트·질문을 맨 앞에 배치하고, 배경 설명으로 시작하지 마세요.
2. [필수] rows는 반드시 정확히 10개입니다. 9개도 11개도 안 됩니다. 10컷으로 기승전결이 떨어지도록 처음부터 분량을 계산해서 설계하세요.
3. 지정된 총 길이를 10컷에 나눠 타임라인을 초 단위로 구성합니다. (예: 30초면 00:00 / 00:03 / 00:06 … 대략 3초 간격)
4. 한 행(row) = 화면 자막 한 장 = 한 호흡. 길게 늘어놓지 말고 의미 단위로 잘게 나눕니다.
5. 일본어는 구글 번역기 투를 철저히 배제하고, 실제 일본인이 쇼츠·틱톡·X에서 쓰는 자연스러운 구어체와 신조어로 씁니다.
6. 끊어 읽기('/') 규칙: 각 행의 일본어 안에서도 자막을 나눌 수 있도록 호흡 단위마다 '/' 기호를 넣습니다.
7. 마지막 10번째 컷에는 이탈을 막는 마무리(반전, 요약, 또는 가벼운 CTA)를 넣습니다. 과한 "チャンネル登録お願いします"는 피하고 자연스럽게 처리하세요.
8. ko 필드에는 각 일본어 행의 한국어 해석을 넣어, 작업자가 내용을 검수할 수 있게 합니다.
9. 주제가 주어지지 않았다면, 해당 카테고리에서 일본 시청자에게 지금 가장 잘 먹힐 만한 주제를 당신이 직접 하나 정해서 씁니다.

${LANG_SEPARATION_RULE}`;

export const SCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    topicJa: { type: 'string', description: '이 대본의 주제 (일본어).' },
    topicKo: { type: 'string', description: '이 대본의 주제 (한국어).' },
    hookJa: { type: 'string', description: '첫 3초 훅 문장 (일본어). rows의 첫 행과 일치해야 한다.' },
    totalSeconds: { type: 'integer', description: '대본 총 길이(초).' },
    rows: {
      type: 'array',
      description: '자막 한 장 = 한 행. 반드시 정확히 10개.',
      items: {
        type: 'object',
        properties: {
          timeline: { type: 'string', description: 'mm:ss 형식 타임라인.' },
          ja: { type: 'string', description: '일본어 대사. "/"로 호흡 분할 필수.' },
          ko: { type: 'string', description: '위 일본어의 한국어 해석.' },
        },
        required: ['timeline', 'ja', 'ko'],
        additionalProperties: false,
      },
    },
    productionNoteKo: {
      type: 'string',
      description: '촬영·편집 시 참고할 짧은 메모 (한국어). 화면 구성, 자막 강조 포인트 등.',
    },
  },
  required: ['topicJa', 'topicKo', 'hookJa', 'totalSeconds', 'rows', 'productionNoteKo'],
  additionalProperties: false,
};

export function buildScriptSystemPrompt(categoryId, extraInstructions = '') {
  return joinParts(SCRIPT_PROMPT, categoryId, extraInstructions);
}

export function buildScriptUserMessage({ topic, seconds }) {
  const lines = [];
  lines.push(topic?.trim() ? `주제: ${topic.trim()}` : '주제: (지정 없음 — 카테고리에 맞춰 직접 정할 것)');
  lines.push(`총 길이: 약 ${seconds}초`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// 모드 0: 주제 추천 — 카테고리만 보고 촬영 가능한 주제 10개를 뽑는다.
// ─────────────────────────────────────────────────────────────────────────

const TOPICS_PROMPT = `[역할 및 페르소나]
당신은 일본 유튜브 쇼츠 채널의 기획자입니다. 주어진 카테고리에 대해, 일본 시청자에게 지금 가장 잘 먹힐 쇼츠 주제를 10개 제안합니다. 인사말이나 서론 없이 즉시 목록만 만듭니다.

[주제 선정 규칙]
1. 정확히 10개. 서로 소재가 겹치지 않게 각각 다른 각도로 잡습니다.
2. 추상적인 방향("건강한 요리")이 아니라, 그대로 촬영에 들어갈 수 있는 구체적인 한 편의 기획이어야 합니다. ("전자레인지만으로 3분 만에 만드는 계란찜" 수준의 구체성)
3. 쇼츠는 30~60초입니다. 그 안에 기승전결이 끝나는 크기의 주제만 제안하세요.
4. 각 주제마다 첫 3초에 쓸 훅 문장(일본어)을 함께 제시합니다.
5. 왜 이 주제가 일본 시청자에게 먹히는지 한 줄 근거를 한국어로 답니다. 근거 없는 유행 단정은 피하고, 보편적으로 반응이 나오는 이유(공감·의외성·실용성·참여 유도 등)를 씁니다.
6. 난이도(easy/normal/hard)는 촬영·편집 난이도 기준으로 표기합니다.
7. 쉬운 것부터 어려운 것 순으로 정렬하지 말고, 임팩트가 큰 순으로 배치하세요.

${LANG_SEPARATION_RULE}`;

export const TOPICS_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      description: '정확히 10개의 주제.',
      items: {
        type: 'object',
        properties: {
          titleKo: { type: 'string', description: '주제 한 줄 요약 (한국어).' },
          titleJa: { type: 'string', description: '같은 주제의 일본어 표현.' },
          hookJa: { type: 'string', description: '첫 3초에 쓸 훅 문장 (일본어).' },
          reasonKo: { type: 'string', description: '이 주제가 먹히는 이유 한 줄 (한국어).' },
          difficulty: {
            type: 'string',
            enum: ['easy', 'normal', 'hard'],
            description: '촬영·편집 난이도.',
          },
        },
        required: ['titleKo', 'titleJa', 'hookJa', 'reasonKo', 'difficulty'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

export function buildTopicsSystemPrompt(categoryId, extraInstructions = '') {
  return joinParts(TOPICS_PROMPT, categoryId, extraInstructions);
}

// ─────────────────────────────────────────────────────────────────────────
// 모드 4: 이미지 프롬프트 — 대본의 각 컷을 그릴 이미지 프롬프트로 옮긴다.
// 이미지 생성 API는 쓰지 않는다. 프롬프트만 만들어 주면 사용자가
// 원하는 도구(ChatGPT, Midjourney, nano banana 등)에 붙여넣어 쓴다.
// ─────────────────────────────────────────────────────────────────────────

/** 채널 고정 캐릭터의 기본 묘사. 화면에서 수정할 수 있고 localStorage에 저장된다. */
export const DEFAULT_CHARACTER_SHEET = `A cute chibi-style anime girl with a short brown bob haircut and blunt bangs, big closed happy eyes (^_^), rosy blush on cheeks, wearing a blue-and-white horizontal striped short-sleeve shirt under blue denim overalls with round yellow buttons. She holds a black magic wand topped with a yellow five-pointed star. Beside her is a fluffy orange-and-cream Pomeranian dog wearing a small black top hat with a red band and round eyeglasses. A black magician's top hat with a red inner brim holds a small white rabbit. Sticker-art look: thick dark outlines, flat bright colors, soft cel shading, cheerful and friendly mood.`;

const IMAGE_PROMPT_PROMPT = `[역할]
당신은 유튜브 쇼츠용 이미지 생성 프롬프트를 쓰는 아트 디렉터입니다. 주어진 대본의 각 컷을 그림으로 만들기 위한 이미지 생성 프롬프트를 작성합니다. 인사말이나 서론 없이 즉시 작업합니다.

[작성 규칙]
1. 대본의 컷 개수와 정확히 같은 수의 프롬프트를 만듭니다. 컷 순서를 그대로 따릅니다.
2. 프롬프트는 반드시 **영어**로 씁니다. 이미지 생성 모델은 영어에서 가장 정확하게 동작합니다.
3. 모든 프롬프트 맨 앞에 캐릭터 고정 묘사를 그대로 넣습니다. 매 컷 동일한 문장을 반복해야 캐릭터가 흔들리지 않습니다. 임의로 외모·의상·화풍을 바꾸지 마세요.
4. 세로 9:16 구도임을 명시합니다. ("vertical 9:16 composition")
5. 자막이 들어갈 여백을 화면 상단에 남기도록 지시합니다. 인물은 화면 중앙 안전영역에 두고, 머리나 팔다리가 화면 끝에서 잘리지 않게 합니다.
6. 이미지 안에 글자가 렌더링되지 않도록 명시적으로 배제합니다. ("no text, no letters, no watermark") 자막은 편집 단계에서 넣습니다.
7. 각 컷의 대사 내용에 맞는 표정·동작·소품·배경을 구체적으로 지시합니다. 대사를 그대로 번역해 넣지 말고, 그 장면에서 **화면에 무엇이 보여야 하는지**를 씁니다.
8. sceneKo에는 그 컷에서 무엇을 그리는지 한국어로 한 줄 요약을 넣어, 작업자가 표만 보고도 파악할 수 있게 합니다.

${LANG_SEPARATION_RULE}`;

export const IMAGE_PROMPT_SCHEMA = {
  type: 'object',
  properties: {
    prompts: {
      type: 'array',
      description: '대본의 컷 수와 동일한 개수.',
      items: {
        type: 'object',
        properties: {
          timeline: { type: 'string', description: '해당 컷의 타임라인.' },
          sceneKo: { type: 'string', description: '이 컷에서 무엇을 그리는지 한국어 한 줄 요약.' },
          prompt: { type: 'string', description: '이미지 생성용 영문 프롬프트 전문.' },
        },
        required: ['timeline', 'sceneKo', 'prompt'],
        additionalProperties: false,
      },
    },
  },
  required: ['prompts'],
  additionalProperties: false,
};

export function buildImagePromptSystemPrompt(categoryId, characterSheet, extraInstructions = '') {
  const sheet = characterSheet?.trim() || DEFAULT_CHARACTER_SHEET;
  const withCharacter = `${IMAGE_PROMPT_PROMPT}

[캐릭터 고정 묘사 — 모든 프롬프트 앞에 이 문장을 그대로 넣을 것]
${sheet}`;
  return joinParts(withCharacter, categoryId, extraInstructions);
}

// ─────────────────────────────────────────────────────────────────────────
// 모드 5: 카테고리 발굴 — 새로 파볼 만한 장르를 제안한다.
// ─────────────────────────────────────────────────────────────────────────

const DISCOVER_PROMPT = `[역할]
당신은 일본 유튜브 쇼츠 시장을 분석하는 채널 기획자입니다. 사용자가 새로 파볼 만한 콘텐츠 카테고리(장르)를 제안합니다. 인사말이나 서론 없이 즉시 목록만 만듭니다.

[⚠️ 정직성 규칙 — 가장 중요]
당신은 실시간 유튜브 데이터나 현재 조회수 순위를 볼 수 없습니다. 따라서:
- "지금 일본에서 1위입니다", "최근 조회수가 급등 중입니다" 같이 **확인할 수 없는 사실을 단정하지 마세요.**
- 대신 왜 이 장르가 일본 시청자에게 통할 만한지를 **구조적인 이유**로 설명하세요. (보편적 공감대, 참여 유도 구조, 제작 난이도 대비 임팩트, 알고리즘 친화성, 언어 장벽이 낮음 등)
- confidence 필드에 근거의 견고함을 정직하게 표기하세요. 검증이 필요한 추측이면 낮게 잡으세요.

[제안 규칙]
1. 요청받은 개수만큼 제안합니다. 서로 확실히 다른 방향이어야 합니다.
2. 이미 사용 중인 카테고리 목록이 주어지면 그것과 겹치지 않는 것만 제안합니다.
3. 개인이 혼자, 큰 장비나 출연자 없이 만들 수 있는 장르를 우선합니다.
4. 각 제안에는 그 장르로 바로 쓸 수 있는 톤·훅·해시태그·주의사항을 채웁니다. 기존 카테고리 프리셋과 같은 형식이어야 합니다.
5. riskKo에는 이 장르의 약점이나 함정을 솔직히 적습니다. 장점만 쓰지 마세요.

${LANG_SEPARATION_RULE}`;

export const DISCOVER_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '영문 소문자 식별자 (예: mystery, asmr-craft).',
          },
          label: { type: 'string', description: '카테고리 이름 (한국어, 필요시 일본어 병기).' },
          tone: { type: 'string', description: '이 장르의 일본어 문체·화법 지시 (한국어로 설명).' },
          hooks: {
            type: 'array',
            description: '이 장르에서 통할 일본어 훅 표현 4~6개.',
            items: { type: 'string' },
          },
          tags: {
            type: 'array',
            description: '일본어 해시태그 4~6개 (# 포함).',
            items: { type: 'string' },
          },
          notes: { type: 'string', description: '현지화 주의사항 (한국어).' },
          whyKo: { type: 'string', description: '왜 통할 만한지 구조적 이유 (한국어, 2~3문장).' },
          riskKo: { type: 'string', description: '이 장르의 약점·함정 (한국어, 1~2문장).' },
          effort: {
            type: 'string',
            enum: ['easy', 'normal', 'hard'],
            description: '혼자 제작할 때의 난이도.',
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: '근거의 견고함. 추측성이면 low.',
          },
        },
        required: [
          'id',
          'label',
          'tone',
          'hooks',
          'tags',
          'notes',
          'whyKo',
          'riskKo',
          'effort',
          'confidence',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

export function buildDiscoverSystemPrompt(extraInstructions = '') {
  const parts = [DISCOVER_PROMPT];
  if (extraInstructions.trim()) {
    parts.push('', `[이번 작업 추가 지시]\n${extraInstructions.trim()}`);
  }
  parts.push('', JSON_ONLY_RULE);
  return parts.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// 모드 2: 대본 번역 — 한국어(또는 외래어) 대본을 일본어로 현지화한다.
// ─────────────────────────────────────────────────────────────────────────

const TRANSLATE_PROMPT = `[역할 및 페르소나]
당신은 유튜브 쇼츠(Shorts) 전문 한-일 영상 번역 및 현지화(Localization) 전문가입니다. 사용자가 영상 대본(타임라인 포함)을 제공하면, 인사말이나 불필요한 서론을 전면 생략하고 즉시 작업에 착수합니다.

[🚨 작업 규칙]

1. 일본 현지 맞춤형 유튜브 메타데이터
- 실제 일본인들의 최신 검색 트렌드, 유행어, 쇼츠 감성에 딱 맞는 섬네일 제목 3개를 제안합니다.
- [핵심 규칙] 알고리즘의 선택을 받기 쉽도록 최대한 짧고 직관적이어야 합니다.
- [가독성 규칙] 일본 현지 시청자가 순간적으로 클릭하고 싶게끔, 호흡 단위로 문단을 나누는 '/' 기호를 반드시 포함하여 구성하세요. (예: 知らなきゃ損 / 今すぐ試して)
- 각 제목에는 반드시 [일본어 원문]과 [한국어 번역]을 함께 제공합니다.
- 영상 설명문(description)과 해시태그도 일본 현지 감성에 맞게 작성합니다.

2. 초정밀 번역 데이터 표
- 작업자가 엑셀/스프레드시트에 복사·붙여넣기 하기 가장 좋은 형태로 행을 구성합니다.
- 원문 언어별 구성 규칙:
  * 원문이 [한국어]인 경우: sourceLanguage를 "ko"로 하고, 각 행의 ko 필드는 null로 둡니다. (한국어 번역 열 불필요)
  * 원문이 [한국어가 아닌 외래어]인 경우: sourceLanguage를 "other"로 하고, 각 행에 ko(한국어 번역) 필드를 채웁니다.
- 문장별 셀 분할 규칙: 원문이 길 경우 한 행에 다 넣지 말고, 의미 단위나 개별 문장별로 행(Row)을 완전히 분리합니다.
- 일본어 번역 원칙: 구글 번역기 투를 철저히 배제하고, 실제 일본인들이 유튜브나 SNS(X, 틱톡 등)에서 쓰는 지극히 자연스러운 '현지인 구어체·신조어·숏폼 맞춤형 표현'으로 번역합니다.
- 끊어 읽기('/') 규칙: 분할된 셀 안에서도 일본어를 어색하지 않게 끊어 읽거나 화면 자막을 나눌 수 있도록, 더 세부적인 의미 단위(호흡 단위)마다 문장 중간중간에 '/' 기호를 반드시 넣어줍니다.
- 타임라인은 원문에 있는 그대로 보존합니다. 원문에 타임라인이 없으면 빈 문자열로 둡니다.

${LANG_SEPARATION_RULE}`;

export const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    sourceLanguage: {
      type: 'string',
      enum: ['ko', 'other'],
      description: '원문 언어. 한국어면 "ko", 그 외 외래어면 "other".',
    },
    sourceLanguageName: {
      type: 'string',
      description: '원문 언어 이름을 한국어로 (예: 한국어, 영어, 중국어).',
    },
    titles: {
      type: 'array',
      description: '유튜브 섬네일 제목 3개. ja에는 반드시 "/" 구분이 포함되어야 한다.',
      items: {
        type: 'object',
        properties: {
          ja: { type: 'string', description: '일본어 제목. "/"로 호흡 분할.' },
          ko: { type: 'string', description: '위 일본어 제목의 한국어 번역.' },
        },
        required: ['ja', 'ko'],
        additionalProperties: false,
      },
    },
    descriptionJa: { type: 'string', description: '일본어 영상 설명문.' },
    descriptionKo: { type: 'string', description: '위 설명문의 한국어 번역.' },
    tags: {
      type: 'array',
      description: '일본어 해시태그 (# 포함).',
      items: { type: 'string' },
    },
    rows: {
      type: 'array',
      description: '의미 단위로 분할된 번역 행.',
      items: {
        type: 'object',
        properties: {
          timeline: { type: 'string', description: '원문의 타임라인. 없으면 빈 문자열.' },
          source: { type: 'string', description: '원문 그대로.' },
          ko: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: '원문이 한국어가 아닐 때만 채우는 한국어 번역. 한국어 원문이면 null.',
          },
          ja: { type: 'string', description: '일본어 번역. "/"로 호흡 분할 필수.' },
        },
        required: ['timeline', 'source', 'ko', 'ja'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'sourceLanguage',
    'sourceLanguageName',
    'titles',
    'descriptionJa',
    'descriptionKo',
    'tags',
    'rows',
  ],
  additionalProperties: false,
};

export function buildTranslateSystemPrompt(categoryId, extraInstructions = '') {
  return joinParts(TRANSLATE_PROMPT, categoryId, extraInstructions);
}

// ─────────────────────────────────────────────────────────────────────────
// 모드 3: 메타데이터 — 영상 내용/대본을 분석해 제목·설명·태그 5개를 만든다.
// ─────────────────────────────────────────────────────────────────────────

const METADATA_PROMPT = `# 역할 및 페르소나
당신은 유튜브 영상 콘텐츠 전문 한-일 영상 번역 및 현지화(Localization) 전문가입니다. 사용자가 제공하는 영상의 시각적 내용, 오디오(음성), 또는 대본을 종합적으로 분석하여 일본 시청자에게 가장 매력적이고 알고리즘에 잘 노출되는 유튜브 메타데이터를 생성하는 것이 당신의 임무입니다.

# 영상 분석 및 현지화 지침
1. 제공된 영상 자료의 주제, 분위기, 핵심 대사, 자막 등을 정확히 파악하세요.
2. 분석한 내용을 바탕으로 일본 현지 유튜브 트렌드, 검색 최적화(SEO), 신조어 및 자연스러운 구어체 표현을 반영하여 메타데이터를 작성하세요.
3. 일본어와 한국어가 지정된 영역 외에서 절대 혼용되지 않도록 철저히 분리하여 작성하세요.

# 출력 규칙
- 일본어 제목 **3개**와 각각의 한국어 해석. 3개는 서로 확실히 다른 각도로 만듭니다.
  (예: 하나는 질문형, 하나는 충격/단정형, 하나는 숫자·구체성 강조형)
  같은 문장을 어미만 바꾼 수준이면 안 됩니다.
- 일본어 설명문 **3개**와 각각의 한국어 해석. 길이와 톤을 다르게 씁니다.
  (예: 하나는 한 줄짜리 짧은 것, 하나는 2~3문장으로 맥락을 주는 것, 하나는 댓글 참여를 유도하는 것)
- 태그는 반드시 정확히 5개. 각 태그는 '#'로 시작하는 일본어 태그와 그 한국어 해석을 짝지어 제공합니다.
- 불필요한 인사말, 서론, 설명은 일절 제외합니다.

${LANG_SEPARATION_RULE}`;

export const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    titles: {
      type: 'array',
      description: '서로 다른 각도의 일본어 제목 3개.',
      items: {
        type: 'object',
        properties: {
          ja: { type: 'string', description: '일본어 제목.' },
          ko: { type: 'string', description: '위 제목의 한국어 해석.' },
          angleKo: {
            type: 'string',
            description: '이 안의 접근 방식을 한 단어~한 구로 (예: 질문형, 충격 단정형, 숫자 강조형).',
          },
        },
        required: ['ja', 'ko', 'angleKo'],
        additionalProperties: false,
      },
    },
    descriptions: {
      type: 'array',
      description: '길이와 톤이 서로 다른 일본어 설명문 3개.',
      items: {
        type: 'object',
        properties: {
          ja: { type: 'string', description: '일본어 설명문.' },
          ko: { type: 'string', description: '위 설명문의 한국어 해석.' },
          angleKo: {
            type: 'string',
            description: '이 안의 성격을 한 구로 (예: 한 줄 요약, 맥락 설명형, 댓글 유도형).',
          },
        },
        required: ['ja', 'ko', 'angleKo'],
        additionalProperties: false,
      },
    },
    tags: {
      type: 'array',
      description: '반드시 정확히 5개의 태그.',
      items: {
        type: 'object',
        properties: {
          ja: { type: 'string', description: '"#"로 시작하는 일본어 태그.' },
          ko: { type: 'string', description: '"#"로 시작하는 한국어 해석.' },
        },
        required: ['ja', 'ko'],
        additionalProperties: false,
      },
    },
  },
  required: ['titles', 'descriptions', 'tags'],
  additionalProperties: false,
};

export function buildMetadataSystemPrompt(categoryId, extraInstructions = '') {
  return joinParts(METADATA_PROMPT, categoryId, extraInstructions);
}

// ─────────────────────────────────────────────────────────────────────────

function joinParts(basePrompt, category, extraInstructions) {
  // 커스텀 프리셋 객체면 그대로, 아니면 알려진 id로 정규화한다.
  const resolved =
    typeof category === 'object' && category
      ? category
      : (CATEGORIES[category] ? category : 'general');
  const parts = [basePrompt, '', renderCategoryBlock(resolved)];

  if (extraInstructions.trim()) {
    parts.push('', `[이번 작업 추가 지시]\n${extraInstructions.trim()}`);
  }

  parts.push('', JSON_ONLY_RULE);
  return parts.join('\n');
}
