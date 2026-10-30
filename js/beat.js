// js/beat.js — synthesized drum machine for apollo-studios (beat node).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and in the
// browser. See js/contract-appendix.md.
//
// Nothing here uses samples: every hit is synthesized.
//   kick  = sine swept 110 -> 45 Hz over 40 ms, exponential decay
//   snare = highpassed noise burst + 180 Hz body tone, 120 ms
//   hat   = highpassed noise burst, 30 ms, delayed on offbeat 16ths (swing)
//
// renderBeat is deterministic: all noise comes from a local mulberry32 seeded from the
// genre name, and events are always visited bar-by-bar, step-by-step, voice-by-voice.
// Output is mono Float32Array at the requested sample rate, exactly bars * 4 beats long,
// peak-normalised to 0.95 so it can never exceed full scale.

const STEPS_PER_BAR = 16            // 16th-note grid, 4 beats per bar
const BEATS_PER_BAR = 4
const KICK_SWEEP_S = 0.04           // 110 -> 45 Hz glide time constant window
const SNARE_S = 0.12
const HAT_S = 0.03
const PEAK_CEIL = 0.95
const ATTACK_S = 0.002

// ---- deterministic PRNG ------------------------------------------------------

// 32-bit FNV-1a over the genre name: a stable integer seed for any string.
function hashSeed(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

// mulberry32 — tiny, fast, fully reproducible from a 32-bit seed.
function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- genres -----------------------------------------------------------------
// Patterns are 16 steps per bar; 'x' is a hit, '.' is a rest. Voice numbers are
// deliberately far apart between genres so the grooves differ in weight, tuning and
// brightness, not just in pattern.

export const GENRES = Object.freeze([
  Object.freeze({
    name: 'boom bap',
    bpm: 90,
    swing: 0.18,
    pattern: Object.freeze({
      kick: 'x......x..x.....',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
    }),
    voices: Object.freeze({
      kick: Object.freeze({ gain: 0.92, decay: 0.26, startHz: 108, endHz: 47 }),
      snare: Object.freeze({ gain: 0.58, decay: 0.055, body: 188, hp: 1150, toneMix: 0.34 }),
      hat: Object.freeze({ gain: 0.21, decay: 0.009, hp: 7200, toneMix: 0 }),
    }),
  }),
  Object.freeze({
    name: 'trap',
    bpm: 140,
    swing: 0.1,
    pattern: Object.freeze({
      kick: 'x.....x...x.....',
      snare: '........x.......',
      hat: 'xxxxxxxxxxxxxxxx',
    }),
    voices: Object.freeze({
      kick: Object.freeze({ gain: 0.98, decay: 0.5, startHz: 96, endHz: 38 }),
      snare: Object.freeze({ gain: 0.5, decay: 0.045, body: 172, hp: 1500, toneMix: 0.28 }),
      hat: Object.freeze({ gain: 0.15, decay: 0.006, hp: 9200, toneMix: 0 }),
    }),
  }),
  Object.freeze({
    name: 'drill',
    bpm: 142,
    swing: 0.14,
    pattern: Object.freeze({
      kick: 'x..x......x..x..',
      snare: '....x.......x...',
      hat: 'x.xxx.xxx.xxx.xx',
    }),
    voices: Object.freeze({
      kick: Object.freeze({ gain: 1.0, decay: 0.38, startHz: 124, endHz: 41 }),
      snare: Object.freeze({ gain: 0.64, decay: 0.05, body: 204, hp: 1850, toneMix: 0.4 }),
      hat: Object.freeze({ gain: 0.13, decay: 0.005, hp: 8200, toneMix: 0 }),
    }),
  }),
  Object.freeze({
    name: 'house',
    bpm: 124,
    swing: 0.06,
    pattern: Object.freeze({
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '..x...x...x...x.',
    }),
    voices: Object.freeze({
      kick: Object.freeze({ gain: 0.95, decay: 0.21, startHz: 110, endHz: 45 }),
      snare: Object.freeze({ gain: 0.52, decay: 0.06, body: 180, hp: 1600, toneMix: 0.3 }),
      hat: Object.freeze({ gain: 0.25, decay: 0.012, hp: 6800, toneMix: 0 }),
    }),
  }),
])

const BY_NAME = new Map(GENRES.map((g) => [g.name, g]))

// ---- small DSP helpers --------------------------------------------------------

// RBJ highpass biquad coefficients, normalised by a0.
function highpassCoeffs(freq, sampleRate) {
  const f = Math.min(Math.max(freq, 20), sampleRate * 0.45)
  const w0 = (2 * Math.PI * f) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
  const a0 = 1 + alpha
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  }
}

// Adds a highpassed noise burst. `gainAt(t)` is the amplitude envelope.
function addNoisy(out, start, sampleRate, dur, hp, gainAt, rnd) {
  const coeffs = highpassCoeffs(hp, sampleRate)
  const len = Math.min(out.length - start, Math.max(1, Math.ceil(dur * sampleRate)))
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate
    const x0 = rnd() * 2 - 1
    const y0 = coeffs.b0 * x0 + coeffs.b1 * x1 + coeffs.b2 * x2 - coeffs.a1 * y1 - coeffs.a2 * y2
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    out[start + i] += y0 * gainAt(t)
  }
}

const attack = (t) => Math.min(1, t / ATTACK_S)

// Pitch-swept sine kick: 110 -> 45 Hz inside 40 ms, exponential amplitude decay.
function addKick(out, start, sampleRate, v) {
  const len = Math.min(out.length - start, Math.max(1, Math.ceil(v.decay * 5 * sampleRate)))
  let phase = 0
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate
    const hz = v.endHz + (v.startHz - v.endHz) * Math.exp(-t / (KICK_SWEEP_S / 4))
    phase += (2 * Math.PI * hz) / sampleRate
    out[start + i] += Math.sin(phase) * v.gain * Math.exp(-t / v.decay) * attack(t)
  }
}

// Noise burst over a 180 Hz-class body tone. Body decays much faster than the noise,
// which is what makes it read as a snare rather than a tom.
function addSnare(out, start, sampleRate, v, rnd) {
  let phase = 0
  addNoisy(out, start, sampleRate, SNARE_S, v.hp, (t) => v.gain * Math.exp(-t / v.decay) * attack(t), rnd)
  const len = Math.min(out.length - start, Math.max(1, Math.ceil(SNARE_S * sampleRate)))
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate
    phase += (2 * Math.PI * v.body) / sampleRate
    out[start + i] += Math.sin(phase) * v.gain * v.toneMix * Math.exp(-t / 0.035) * attack(t)
  }
}

// ---- render -------------------------------------------------------------------

function validate(bars, sampleRate) {
  if (!Number.isFinite(bars) || !Number.isInteger(bars) || bars < 1) throw new Error('bad bars')
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('bad sample rate')
}

const hit = (pattern, step) => pattern[step] === 'x'

// Deterministic groove render. Throws `unknown genre` for an unknown name, `bad bars`
// for a non-positive / fractional bar count and `bad sample rate` for a bad rate.
export function renderBeat(genreName, bars, sampleRate) {
  const genre = BY_NAME.get(genreName)
  if (!genre) throw new Error('unknown genre')
  validate(bars, sampleRate)
  if (!Number.isFinite(genre.bpm) || genre.bpm <= 0) throw new Error('bad bpm')

  const stepDur = 60 / genre.bpm / 4
  const total = Math.round(bars * BEATS_PER_BAR * (60 / genre.bpm) * sampleRate)
  const out = new Float32Array(total)
  const rnd = mulberry32(hashSeed(genre.name))
  const v = genre.voices

  for (let bar = 0; bar < bars; bar++) {
    for (let step = 0; step < STEPS_PER_BAR; step++) {
      // Swing pushes odd (offbeat) 16ths later; only the hat follows it.
      const swung = step % 2 === 1 ? step * stepDur + genre.swing * stepDur : step * stepDur
      const barStart = bar * STEPS_PER_BAR * stepDur
      if (hit(genre.pattern.kick, step)) {
        addKick(out, Math.round((barStart + swung) * sampleRate), sampleRate, v.kick)
      }
      if (hit(genre.pattern.snare, step)) {
        addSnare(out, Math.round((barStart + swung) * sampleRate), sampleRate, v.snare, rnd)
      }
      if (hit(genre.pattern.hat, step)) {
        const at = Math.round((barStart + swung) * sampleRate)
        addNoisy(out, at, sampleRate, HAT_S, v.hat.hp, (t) => v.hat.gain * Math.exp(-t / v.hat.decay) * attack(t), rnd)
      }
    }
  }

  let peak = 0
  for (let i = 0; i < out.length; i++) {
    const s = out[i]
    if (!Number.isFinite(s)) out[i] = 0
    else peak = Math.max(peak, Math.abs(s))
  }
  if (peak > PEAK_CEIL) {
    const scale = PEAK_CEIL / peak
    for (let i = 0; i < out.length; i++) out[i] *= scale
  }
  return out
}

export function genreNames() {
  return GENRES.map((g) => g.name)
}
