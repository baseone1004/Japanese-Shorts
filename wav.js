/**
 * WAV 파일 이어붙이기.
 *
 * FFmpeg 같은 외부 도구 없이 처리한다. 설치 부담을 지우지 않기 위해서다.
 * 타입캐스트가 돌려주는 WAV는 포맷이 동일하므로, 헤더를 새로 쓰고 PCM 데이터만
 * 순서대로 붙이면 된다.
 */

/** WAV 헤더를 읽어 포맷 정보와 데이터 구간 위치를 찾는다. */
function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('WAV 파일이 아닙니다.');
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  // 청크를 순회한다. LIST 같은 부가 청크가 끼어 있을 수 있어 위치를 가정하지 않는다.
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }

    offset = body + size + (size % 2); // 청크는 짝수 바이트로 정렬된다
  }

  if (!fmt || !data) throw new Error('WAV 구조를 해석하지 못했습니다.');
  return { fmt, data };
}

function silence(fmt, seconds) {
  const bytesPerSample = fmt.bitsPerSample / 8;
  const frames = Math.round(fmt.sampleRate * seconds);
  // 16비트 PCM의 무음은 0이므로 0으로 채운 버퍼면 된다.
  return Buffer.alloc(frames * fmt.channels * bytesPerSample);
}

function writeHeader(fmt, dataLength) {
  const header = Buffer.alloc(44);
  const byteRate = (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8;
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(fmt.audioFormat, 20);
  header.writeUInt16LE(fmt.channels, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(fmt.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataLength, 40);
  return header;
}

/**
 * 여러 WAV를 사이에 무음을 넣어 하나로 합친다.
 * @param buffers  WAV 파일 버퍼 배열
 * @param gapSec   각 조각 사이에 넣을 무음 길이(초)
 */
export function concatWav(buffers, gapSec = 0.25) {
  if (!buffers.length) throw new Error('합칠 음성이 없습니다.');

  const parsed = buffers.map(parseWav);
  const fmt = parsed[0].fmt;

  const mismatch = parsed.find(
    (p) =>
      p.fmt.sampleRate !== fmt.sampleRate ||
      p.fmt.channels !== fmt.channels ||
      p.fmt.bitsPerSample !== fmt.bitsPerSample,
  );
  if (mismatch) throw new Error('음성 조각들의 포맷이 서로 다릅니다.');

  const gap = gapSec > 0 ? silence(fmt, gapSec) : Buffer.alloc(0);

  const parts = [];
  parsed.forEach((p, i) => {
    if (i > 0 && gap.length) parts.push(gap);
    parts.push(p.data);
  });

  const data = Buffer.concat(parts);
  return Buffer.concat([writeHeader(fmt, data.length), data]);
}
