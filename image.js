import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

/** 채널 고정 캐릭터 참조 이미지 경로. 사용자가 직접 이 경로에 파일을 넣는다. */
export const CHARACTER_PATH = path.resolve('assets/character.png');

/** 쇼츠는 세로 9:16. 캡컷에 그대로 올릴 수 있는 비율. */
export const SHORTS_ASPECT = '9:16';

const MODEL = 'gemini-3.1-flash-image';

let ai = null;
function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  ai ??= new GoogleGenAI({ apiKey });
  return ai;
}

/** 캐릭터 참조 이미지를 base64로 읽는다. 없으면 null. */
async function loadCharacter() {
  try {
    const buf = await readFile(CHARACTER_PATH);
    return buf.toString('base64');
  } catch {
    return null;
  }
}

/**
 * 장면 설명을 실제 이미지 생성 프롬프트로 조립한다.
 * 캐릭터 일관성 유지가 이 앱의 핵심 요구사항이라 그 지시를 맨 앞에 둔다.
 */
export function buildImagePrompt({ scene, overlayText, useCharacter }) {
  const parts = [];

  parts.push(
    'Vertical 9:16 illustration for a YouTube Shorts video. Full-bleed composition, no borders, no letterboxing.',
  );

  if (useCharacter) {
    parts.push(
      'CHARACTER CONSISTENCY IS THE TOP PRIORITY. The reference image shows the channel mascot. ' +
        'Reproduce that exact character: identical face shape, eye style, hairstyle and hair color, ' +
        'outfit, proportions, line weight, outline color, shading style, and color palette. ' +
        'Do not redesign, age up, restyle, or change the outfit. Keep the same cute chibi sticker art style.',
    );
  }

  parts.push(`SCENE: ${scene}`);

  parts.push(
    'COMPOSITION: keep the character fully inside the frame — never crop the head or cut off limbs at the edge. ' +
      'Leave clear, uncluttered space in the top third of the image so a caption can be added later in editing. ' +
      'Keep the main subject inside the central safe area, away from the very top and bottom edges ' +
      '(those get covered by YouTube Shorts UI).',
  );

  if (overlayText?.trim()) {
    parts.push(
      `TEXT IN IMAGE: render exactly this Japanese text, large and legible, in the upper area: "${overlayText.trim()}". ` +
        'Use a bold rounded sans-serif with a thick white outline so it stays readable over the artwork. ' +
        'Do not add any other text, watermarks, or signatures.',
    );
  } else {
    parts.push('Do not render any text, letters, watermarks, or signatures in the image.');
  }

  return parts.join('\n\n');
}

/** Gemini로 쇼츠 사이즈 이미지 한 장을 생성한다. */
export async function generateImage({ scene, overlayText = '', useCharacter = true }) {
  const genai = client();
  if (!genai) {
    const err = new Error(
      'GEMINI_API_KEY가 설정되지 않았습니다. .env에 키를 넣고 서버를 재시작하세요. ' +
        '키는 https://aistudio.google.com/apikey 에서 발급받습니다.',
    );
    err.status = 401;
    throw err;
  }

  const characterB64 = useCharacter ? await loadCharacter() : null;
  if (useCharacter && !characterB64) {
    const err = new Error(
      `캐릭터 이미지를 찾지 못했습니다. 채널 캐릭터 PNG를 ${CHARACTER_PATH} 경로에 저장한 뒤 다시 시도하세요.`,
    );
    err.status = 400;
    throw err;
  }

  const prompt = buildImagePrompt({ scene, overlayText, useCharacter: Boolean(characterB64) });

  const input = [{ type: 'text', text: prompt }];
  if (characterB64) {
    input.push({ type: 'image', mime_type: 'image/png', data: characterB64 });
  }

  const interaction = await genai.interactions.create({
    model: MODEL,
    input,
    response_format: {
      type: 'image',
      mime_type: 'image/png',
      aspect_ratio: SHORTS_ASPECT,
      // 쇼츠 최종 출력은 1080x1920이다. 9:16의 1K가 이미 그 해상도를 넘기므로
      // 2K는 화질 이득 없이 장당 단가만 올린다.
      image_size: '1K',
    },
  });

  const image = interaction?.output_image;
  if (!image?.data) {
    const err = new Error('이미지가 반환되지 않았습니다. 장면 설명을 조금 바꿔서 다시 시도해 보세요.');
    err.status = 502;
    throw err;
  }

  return {
    mimeType: image.mime_type ?? 'image/png',
    data: image.data,
    prompt,
    usedCharacter: Boolean(characterB64),
  };
}
