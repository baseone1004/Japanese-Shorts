import { renderCategoryBlock } from './categories.js';

/** 사용자가 제공한 원본 번역기 프롬프트 (역할 정의 + 규칙). */
const BASE_PROMPT = `[역할 및 페르소나]
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

[⚠️ 절대 주의사항 - 언어 분리]
- 한국어가 쓰여야 할 필드(ko, titles[].ko, descriptionKo 등)에는 반드시 한국어만 표기하세요.
- 일본어가 쓰여야 할 필드(ja, titles[].ja, descriptionJa, tags 등)에는 반드시 일본어만 표기하세요.
- 일본어와 한국어를 한 필드나 한 문장 안에 실수로 혼용하는 일이 절대 없도록 철저히 검증 후 출력하세요.
- 고유명사·브랜드명 등 원어 표기가 필수인 경우만 예외로 허용합니다.`;

/** 구조화 출력 JSON 스키마 (output_config.format). */
export const OUTPUT_SCHEMA = {
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

/** 카테고리 프리셋을 결합한 최종 시스템 프롬프트를 만든다. */
export function buildSystemPrompt(categoryId, extraInstructions = '') {
  const parts = [BASE_PROMPT, '', renderCategoryBlock(categoryId)];

  if (extraInstructions.trim()) {
    parts.push('', `[이번 작업 추가 지시]\n${extraInstructions.trim()}`);
  }

  parts.push(
    '',
    '[출력 형식]',
    '결과는 지정된 JSON 스키마로만 출력합니다. 서론·후기·마크다운 코드펜스 없이 JSON 객체 하나만 반환하세요.',
  );

  return parts.join('\n');
}
