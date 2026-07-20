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
2. 지정된 총 길이에 맞춰 타임라인을 초 단위로 구성합니다. (예: 00:00 / 00:03 / 00:07 …)
3. 한 행(row) = 화면 자막 한 장 = 한 호흡. 길게 늘어놓지 말고 의미 단위로 잘게 나눕니다.
4. 일본어는 구글 번역기 투를 철저히 배제하고, 실제 일본인이 쇼츠·틱톡·X에서 쓰는 자연스러운 구어체와 신조어로 씁니다.
5. 끊어 읽기('/') 규칙: 각 행의 일본어 안에서도 자막을 나눌 수 있도록 호흡 단위마다 '/' 기호를 넣습니다.
6. 마지막에는 이탈을 막는 마무리(반전, 요약, 또는 가벼운 CTA)를 넣습니다. 과한 "チャンネル登録お願いします"는 피하고 자연스럽게 처리하세요.
7. ko 필드에는 각 일본어 행의 한국어 해석을 넣어, 작업자가 내용을 검수할 수 있게 합니다.
8. 주제가 주어지지 않았다면, 해당 카테고리에서 일본 시청자에게 지금 가장 잘 먹힐 만한 주제를 당신이 직접 하나 정해서 씁니다.

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
      description: '자막 한 장 = 한 행.',
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
- 일본어 제목 1개와 그 한국어 해석
- 일본어 설명문 1개와 그 한국어 해석
- 태그는 반드시 정확히 5개. 각 태그는 '#'로 시작하는 일본어 태그와 그 한국어 해석을 짝지어 제공합니다.
- 불필요한 인사말, 서론, 설명은 일절 제외합니다.

${LANG_SEPARATION_RULE}`;

export const METADATA_SCHEMA = {
  type: 'object',
  properties: {
    titleJa: { type: 'string', description: '일본어 제목.' },
    titleKo: { type: 'string', description: '위 제목의 한국어 해석.' },
    descriptionJa: { type: 'string', description: '일본어 설명문.' },
    descriptionKo: { type: 'string', description: '위 설명문의 한국어 해석.' },
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
  required: ['titleJa', 'titleKo', 'descriptionJa', 'descriptionKo', 'tags'],
  additionalProperties: false,
};

export function buildMetadataSystemPrompt(categoryId, extraInstructions = '') {
  return joinParts(METADATA_PROMPT, categoryId, extraInstructions);
}

// ─────────────────────────────────────────────────────────────────────────

function joinParts(basePrompt, categoryId, extraInstructions) {
  const id = CATEGORIES[categoryId] ? categoryId : 'general';
  const parts = [basePrompt, '', renderCategoryBlock(id)];

  if (extraInstructions.trim()) {
    parts.push('', `[이번 작업 추가 지시]\n${extraInstructions.trim()}`);
  }

  parts.push('', JSON_ONLY_RULE);
  return parts.join('\n');
}
