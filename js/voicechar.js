// js/voicechar.js — vocal character chain for voice-studio (character node).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and
// in the browser. See js/contract.md and js/contract-appendix.md.
//
// Chain, in order: pitch resample (linear interpolation) -> one-pole treble
// shelf -> tanh soft drive -> seeded breath noise. Every stage is skipped
// when its amount is 0, so the `natural` character is a transparent pass.
// `applyCharacter` always returns a new buffer and never aliases the input.

const SHELF_HZ = 3500           // treble shelf corner, clamped under Nyquist
const NOISE_SEED = 0x5eed1a7   // fixed seed: same take in, same take out

export const CHARACTERS = Object.freeze([
  Object.freeze({ name: 'natural', pitchSemis: 0, tiltDb: 0, driveDb: 0, breathMix: 0 }),
  Object.freeze({ name: 'warm-double', pitchSemis: -3, tiltDb: -4, driveDb: 4, breathMix: 0.06 }),
  Object.freeze({ name: 'deep-monster', pitchSemis: -7, tiltDb: -6, driveDb: 7, breathMix: 0.05 }),
  Object.freeze({ name: 'bright-air', pitchSemis: 5, tiltDb: 6, driveDb: 2, breathMix: 0.14 }),
  Object.freeze({ name: 'phone-radio', pitchSemis: 0, tiltDb: 9, driveDb: 11, breathMix: 0.03 }),
  Object.freeze({ name: 'whisper', pitchSemis: 0, tiltDb: -2, driveDb: 0, breathMix: 0.3 }),
  Object.freeze({ name: 'chipmunk', pitchSemis: 7, tiltDb: 4, driveDb: 1, breathMix: 0.02 }),
])

function characterByName(name) {
  const c = CHARACTERS.find((entry) => entry.name === name)
  if (!c) throw new Error('unknown character')
  return c
}

// mulberry32 — tiny deterministic PRNG, plenty for breath noise.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Linear resample by `ratio` (>1 = shorter and higher). Integer positions
// land exactly on source samples; the last source sample repeats past the end.
function resample(take, ratio) {
  const len = take.length
  if (len === 0) return new Float32Array(0)
  if (ratio === 1) {
    const same = new Float32Array(len)
    same.set(take)
    return same
  }
  const outLen = Math.max(1, Math.round(len / ratio))
  const out = new Float32Array(outLen)
  const last = len - 1
  let pos = 0
  for (let i = 0; i < outLen; i++) {
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = take[i0 > last ? last : i0]
    const b = take[i0 + 1 > last ? last : i0 + 1]
    out[i] = a + (b - a) * frac
    pos += ratio
  }
  return out
}

// One-pole treble shelf: split into low + high with a one-pole lowpass, scale
// the high band by the tilt gain (1.0 at 0 dB, so the stage is identity then).
function trebleShelf(buf, tiltDb, sampleRate) {
  const g = 10 ** (tiltDb / 20)
  const corner = Math.min(SHELF_HZ, sampleRate * 0.45)
  const a = 1 - Math.exp((-2 * Math.PI * corner) / sampleRate)
  let lp = 0
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]
    lp += a * (x - lp)
    buf[i] = lp + (x - lp) * g
  }
}

// tanh soft drive, pre-gain from driveDb in dB, normalised so a full-scale
// sample stays at full scale. Compresses peaks, so it works as a leveller too.
function drive(buf, driveDb) {
  const k = 10 ** (driveDb / 20)
  const norm = Math.tanh(k) || 1
  for (let i = 0; i < buf.length; i++) {
    const y = Math.tanh(buf[i] * k) / norm
    buf[i] = y > 1 ? 1 : y < -1 ? -1 : y
  }
}

// Seeded broadband noise mixed in under the headroom left by the signal, so
// the sum cannot exceed ±1. Off entirely at breathMix 0.
function breath(buf, breathMix, seed) {
  const rand = mulberry32(seed)
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]
    const room = 1 - Math.min(1, Math.abs(x))
    const noise = rand() * 2 - 1
    buf[i] = x + noise * breathMix * room
  }
}

// Apply a named character to a mono take. Returns a NEW Float32Array of
// roughly len / 2**(pitchSemis/12) samples. Empty input gives empty output.
export function applyCharacter(take, characterName, sampleRate) {
  if (!(take instanceof Float32Array)) throw new Error('take must be a Float32Array')
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('bad sample rate')
  const c = characterByName(characterName)
  if (take.length === 0) return new Float32Array(0)

  const out = resample(take, 2 ** (c.pitchSemis / 12))
  if (c.tiltDb !== 0) trebleShelf(out, c.tiltDb, sampleRate)
  if (c.driveDb !== 0) drive(out, c.driveDb)
  if (c.breathMix !== 0) breath(out, c.breathMix, NOISE_SEED)
  // Hard ceiling: tilt can over-unity a transient and breath adds on top.
  for (let i = 0; i < out.length; i++) {
    const v = out[i]
    out[i] = v > 1 ? 1 : v < -1 ? -1 : v
  }
  return out
}

// Names in table order, for dropdowns.
export function characterNames() {
  return CHARACTERS.map((c) => c.name)
}
