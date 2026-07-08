import { encodeWavFloat32 } from "./wavEncoder";

// Chromium의 <audio>/decodeAudioData는 AIFF 컨테이너 자체를 지원하지 않는다(WAV/MP3/AAC/
// OGG/FLAC만 지원) — 그래서 AIFF는 재생 전에 항상 여기서 직접 파싱해 WAV로 변환해야 한다.
export function isAiffPath(filePath: string): boolean {
  return /\.aif[fc]?$/i.test(filePath);
}

interface AiffPcm {
  channels: Float32Array[];
  sampleRate: number;
}

// AIFF COMM 청크의 sampleRate는 80-bit IEEE 754 extended float(빅엔디안)로 저장된다
function readIeeeExtended(view: DataView, offset: number): number {
  let exponent = view.getUint16(offset);
  const hiMant = view.getUint32(offset + 2);
  const loMant = view.getUint32(offset + 6);
  if (exponent === 0 && hiMant === 0 && loMant === 0) return 0;
  let sign = 1;
  if (exponent & 0x8000) {
    sign = -1;
    exponent &= 0x7fff;
  }
  exponent -= 16383;
  let f = hiMant * Math.pow(2, exponent - 31);
  f += loMant * Math.pow(2, exponent - 63);
  return sign * f;
}

function readTag(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

// AIFF(-C) 원본 PCM을 채널별 Float32([-1, 1]) 배열로 디코딩.
// 지원: 8/16/24/32-bit 정수 PCM(빅엔디안 'NONE'/'twos', 리틀엔디안 'sowt'), 32/64-bit float('fl32'/'fl64').
// 그 외 압축 코덱(ulaw/alaw/ima4 등)은 흔치 않아 지원하지 않고 에러를 던진다.
export function decodeAiff(bytes: Uint8Array): AiffPcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readTag(view, 0) !== "FORM")
    throw new Error("AIFF 파일이 아님 (FORM 청크 없음)");
  const formType = readTag(view, 8);
  if (formType !== "AIFF" && formType !== "AIFC")
    throw new Error(`지원하지 않는 AIFF 형식: ${formType}`);

  let numChannels = 0;
  let numFrames = 0;
  let bitsPerSample = 16;
  let sampleRate = 44100;
  let compression = "NONE";
  let ssndDataStart = -1;

  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const chunkId = readTag(view, pos);
    const chunkSize = view.getUint32(pos + 4);
    const dataStart = pos + 8;
    if (chunkId === "COMM") {
      numChannels = view.getInt16(dataStart);
      numFrames = view.getUint32(dataStart + 2);
      bitsPerSample = view.getInt16(dataStart + 6);
      sampleRate = Math.round(readIeeeExtended(view, dataStart + 8));
      if (formType === "AIFC" && chunkSize >= 22) {
        compression = readTag(view, dataStart + 18);
      }
    } else if (chunkId === "SSND") {
      const ssndOffset = view.getUint32(dataStart);
      ssndDataStart = dataStart + 8 + ssndOffset;
    }
    // 청크는 짝수 바이트 경계로 패딩된다
    pos = dataStart + chunkSize + (chunkSize % 2);
  }

  if (ssndDataStart < 0)
    throw new Error("AIFF 파일에 SSND(샘플 데이터) 청크가 없음");
  if (numChannels <= 0 || numFrames <= 0)
    throw new Error("AIFF 파일의 COMM 청크가 올바르지 않음");

  const compLower = compression.toLowerCase();
  const isFloat = compLower === "fl32" || compLower === "fl64";
  const littleEndian = compLower === "sowt";
  const bytesPerSample = Math.ceil(bitsPerSample / 8);
  const channels: Float32Array[] = Array.from(
    { length: numChannels },
    () => new Float32Array(numFrames),
  );
  const maxVal = Math.pow(2, bitsPerSample - 1);

  let offset = ssndDataStart;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample: number;
      if (isFloat && bitsPerSample === 32) {
        sample = view.getFloat32(offset, littleEndian);
      } else if (isFloat && bitsPerSample === 64) {
        sample = view.getFloat64(offset, littleEndian);
      } else if (bitsPerSample <= 8) {
        sample = view.getInt8(offset) / maxVal;
      } else if (bitsPerSample <= 16) {
        sample = view.getInt16(offset, littleEndian) / maxVal;
      } else if (bitsPerSample <= 24) {
        // 24비트는 DataView에 내장 메서드가 없어 바이트 3개를 직접 조합
        const b0 = view.getUint8(offset);
        const b1 = view.getUint8(offset + 1);
        const b2 = view.getUint8(offset + 2);
        let v = littleEndian
          ? (b2 << 16) | (b1 << 8) | b0
          : (b0 << 16) | (b1 << 8) | b2;
        if (v & 0x800000) v -= 0x1000000;
        sample = v / maxVal;
      } else {
        sample = view.getInt32(offset, littleEndian) / maxVal;
      }
      channels[ch][frame] = sample;
      offset += bytesPerSample;
    }
  }

  return { channels, sampleRate };
}

// AIFF 원본 바이트 → 브라우저가 그대로 재생/디코드할 수 있는 WAV(32-bit float PCM) 바이트로 변환
export function decodeAiffToWav(bytes: Uint8Array): Uint8Array {
  const { channels, sampleRate } = decodeAiff(bytes);
  return encodeWavFloat32(channels, sampleRate);
}
