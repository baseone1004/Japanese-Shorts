# 🇯🇵 일본 쇼츠 번역기 (Japanese-Shorts)

유튜브 쇼츠 대본을 일본 현지 감성에 맞게 번역·현지화하는 로컬 웹 도구.
Claude API(`claude-opus-4-8`)를 호출해 **일본 맞춤 메타데이터**와 **엑셀 복사용 초정밀 번역 표**를 한 번에 만든다.

## 기능

- **장르별 톤 프리셋 12종** — 요리/여행/리뷰/이슈/동물/꿀팁/뷰티/운동/재테크/K-POP/유머/일반.
  선택한 장르에 따라 일본어 말투, 훅 표현, 해시태그 스타일이 자동으로 바뀐다.
- **섬네일 제목 3안** — 짧고 직관적이며 `/`로 호흡을 나눈 일본어 + 한국어 번역 병기.
- **설명문 · 해시태그** — 일본 현지 검색 트렌드 기반.
- **번역 데이터 표** — 의미 단위로 행 분리, 일본어에 `/` 끊어읽기 자동 삽입.
  - 원문이 한국어면 `[타임라인 | 원문 | 일본어]` 3열
  - 원문이 외래어면 `[타임라인 | 원문 | 한국어 | 일본어]` 4열
- **엑셀용 TSV 복사 / CSV 다운로드** (UTF-8 BOM 포함 — Excel에서 한글·일본어 안 깨짐).

## 설치

```bash
npm install
cp .env.example .env    # Windows: copy .env.example .env
```

`.env`에 [Anthropic Console](https://console.anthropic.com)에서 발급받은 키를 넣는다:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## 실행

```bash
npm start
```

→ http://localhost:3000

대본 입력창에서 `Ctrl+Enter`(macOS `Cmd+Enter`)로도 실행된다.

## 입력 예시

```
00:00 안녕하세요, 오늘은 3분만에 만드는 김치볶음밥 알려드릴게요
00:04 재료는 딱 네 개면 됩니다
00:07 신김치, 찬밥, 계란, 그리고 참기름
```

타임라인은 없어도 동작한다 (타임라인 열이 빈 칸으로 나온다).

## 구조

| 파일 | 역할 |
| --- | --- |
| `server.js` | Express 서버 + Claude API 호출 |
| `prompt.js` | 번역기 시스템 프롬프트 + 구조화 출력 JSON 스키마 |
| `categories.js` | 장르별 톤 프리셋 정의 |
| `public/` | 프론트엔드 (바닐라 JS) |

## 카테고리 추가하기

`categories.js`의 `CATEGORIES` 객체에 항목을 하나 추가하면 끝이다.
서버 재시작 후 드롭다운에 자동으로 나타난다.

```js
newGenre: {
  label: '새 장르',
  tone: '어떤 일본어 문체를 쓸지',
  hooks: ['훅 표현1', '훅 표현2'],
  tags: ['#해시태그'],
  notes: '현지화 주의사항',
},
```

## 참고

- 모델: `claude-opus-4-8` (adaptive thinking, effort `high`, 구조화 출력)
- 긴 대본 대응을 위해 스트리밍으로 호출하고 최종 메시지만 수거한다.
