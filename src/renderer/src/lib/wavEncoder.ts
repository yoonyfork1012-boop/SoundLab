// 선택 구간을 DAW로 드래그하기 위한 최소한의 WAV 인코더.
// 원본 화질 손실 없이 32-bit float PCM(WAV 포맷 코드 3)으로 저장 —
// Cubase/Ableton/Reaper 모두 32-bit float WAV를 문제없이 읽는다.
export function encodeWavFloat32(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length
  const numFrames = channels[0]?.length ?? 0
  const bytesPerSample = 4
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, s: string): void {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 3, true) // format code 3 = IEEE float
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 32, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      view.setFloat32(offset, channels[ch][i], true)
      offset += 4
    }
  }

  return new Uint8Array(buffer)
}

// AudioBuffer에서 [startSec, endSec) 구간만 잘라 채널별 Float32Array로 반환
export function sliceAudioBuffer(buf: AudioBuffer, startSec: number, endSec: number): Float32Array[] {
  const start = Math.max(0, Math.floor(startSec * buf.sampleRate))
  const end = Math.min(buf.length, Math.ceil(endSec * buf.sampleRate))
  const length = Math.max(0, end - start)
  const channels: Float32Array[] = []
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    channels.push(buf.getChannelData(ch).slice(start, end))
  }
  if (length === 0) return channels.map(() => new Float32Array(0))
  return channels
}
