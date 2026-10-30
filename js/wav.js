// wav.js — 16-bit PCM stereo RIFF/WAVE encoder, byte-exact per js/contract.md.
// Pure ESM, dependency-free, runs under plain Node 22 and in the browser.

const HEADER_BYTES = 44

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

// Round with Math.round, clip to [-1, 1] then int16 range.
function toInt16(sample) {
  if (!Number.isFinite(sample)) return 0
  const clamped = sample <= -1 ? -1 : sample >= 1 ? 1 : sample
  return Math.round(clamped * 32767)
}

// 16-bit PCM little-endian, 44-byte header:
// "RIFF", size, "WAVE", "fmt ", 16, 1, channels=2, sampleRate, byteRate,
// blockAlign=4, bits=16, "data", dataSize, then interleaved L/R samples.
export function encodeWav(stereo, sampleRate) {
  if (!stereo || !(stereo.left instanceof Float32Array) || !(stereo.right instanceof Float32Array)) {
    throw new Error('stereo must be { left, right } Float32Arrays')
  }
  if (stereo.left.length !== stereo.right.length) {
    throw new Error('stereo channels must have equal length')
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('sample rate must be a positive finite number')
  }
  const sr = Math.round(sampleRate)
  const frames = stereo.left.length
  const blockAlign = 4 // 2 channels × 2 bytes
  const byteRate = sr * blockAlign
  const dataSize = frames * blockAlign
  const riffSize = 36 + dataSize
  const bytes = new Uint8Array(HEADER_BYTES + dataSize)
  const view = new DataView(bytes.buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, riffSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true)  // PCM
  view.setUint16(22, 2, true)  // channels
  view.setUint32(24, sr, true) // sample rate
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = HEADER_BYTES
  for (let i = 0; i < frames; i++) {
    view.setInt16(offset, toInt16(stereo.left[i]), true)
    view.setInt16(offset + 2, toInt16(stereo.right[i]), true)
    offset += blockAlign
  }
  return bytes
}

export function wavHeaderBytes() {
  return HEADER_BYTES
}
