// js/automix.js — genre-derived mix suggestions, level balancing and a tiny
// additive instrument bank for previews. Contract: js/contract-appendix.md.
//
// Nothing here is a model: `suggestFromGenre` maps a genre to a brightness and a
// density number and turns those into a partial master setting. Bright genres
// get a presence lift around 3 kHz and a hotter -12 dBFS target; dark genres get
// the top end shelved off and a -16 dBFS target; both get a mud cut and a
// rumble highpass so the suggestion is usable on its own.
//
// `balance` moves N track levels to the median level and clamps the result to
// -24..+12 dB. The loudest track is the anchor and is never boosted, so applying
// the trims can only ever pull the mix down.
//
// `INSTRUMENTS` are additive preview patches: harmonics are summed with a fixed
// per-instrument amplitude table, shaped by an attack/sustain/release envelope
// and decay, then peak-normalised. Identical arguments always give identical
// samples.
//
// Pure: no browser globals, no dependencies.

const MIN_TRIM_DB = -24
const MAX_TRIM_DB = 12
const TARGET_FLOOR_DB = -16 // dark genre target
const TARGET_CEIL_DB = -12 // bright genre target
const DARK = -0.5
const BRIGHT = 0.5
const EQ_KINDS = new Set(['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass'])
const WAVES = new Set(['saw', 'sine', 'square'])

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const round1 = (v) => Math.round(v * 10) / 10

// brightness -1 (dark) .. +1 (bright), density 0 .. 1
const GENRES = {
  ambient: { brightness: -1, density: 0.2 },
  lofi: { brightness: -0.75, density: 0.35 },
  boombap: { brightness: -0.55, density: 0.6 },
  drill: { brightness: -0.35, density: 0.85 },
  trap: { brightness: -0.1, density: 0.9 },
  acoustic: { brightness: 0.2, density: 0.25 },
  house: { brightness: 0.55, density: 0.6 },
  pop: { brightness: 0.7, density: 0.55 },
  edm: { brightness: 1, density: 0.9 },
}

// "boom bap", "Boom_Bap", "boom-bap" all land on the same profile.
const genreKey = (name) => String(name ?? '').toLowerCase().replace(/[\s_-]+/g, '')

function lookupGenre(name) {
  const key = genreKey(name)
  const genre = GENRES[key]
  if (!genre) throw new Error('unknown genre')
  return genre
}

// Partial master setting for a genre: EQ bands, compressor, loudness target.
export function suggestFromGenre(genreName) {
  const { brightness: b, density: d } = lookupGenre(genreName)
  const eq = [{ kind: 'highpass', freq: 80, q: 0.71, gainDb: 0 }]

  if (b < 0) {
    // Dark: shelf the top off, and add weight down low as it gets darker.
    eq.push({ kind: 'highshelf', freq: 8000, q: 0.71, gainDb: round1(3.5 * b) })
    eq.push({ kind: 'lowshelf', freq: 110, q: 0.71, gainDb: round1(-1.5 * b) })
  } else if (b > 0) {
    // Bright: presence lift at 3 kHz, thin the basement as it gets brighter.
    eq.push({ kind: 'peaking', freq: 3000, q: 1, gainDb: round1(2 + 2 * b) })
    eq.push({ kind: 'lowshelf', freq: 110, q: 0.71, gainDb: round1(-0.8 * b) })
  }

  // Trim the mud and clamp the top so the band count stays bounded.
  eq.push({ kind: 'peaking', freq: 320, q: 1.1, gainDb: -round1(1 + d) })
  eq.sort((x, y) => x.freq - y.freq)

  let targetRmsDb
  if (b <= DARK) targetRmsDb = TARGET_FLOOR_DB
  else if (b >= BRIGHT) targetRmsDb = TARGET_CEIL_DB
  else targetRmsDb = round1(-14 + 2 * b)

  const comp = {
    thresholdDb: round1(-14 - 6 * d),
    ratio: round1(2 + 2 * d),
    attackMs: round1(20 - 12 * d),
    releaseMs: round1(180 - 60 * d),
    makeupDb: 0,
  }

  return { eq, comp, targetRmsDb }
}

// Per-track trims in dB that land every level on the median. Non-finite levels
// count as 0 dB. The loudest track ends at 0 or below and every trim is clamped
// to -24..+12.
export function balance(levels) {
  if (!Array.isArray(levels)) throw new Error('levels must be an array')
  const n = levels.length
  if (n === 0) return []
  const clean = levels.map((v) => (Number.isFinite(v) ? v : 0))
  const sorted = [...clean].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2

  const trims = clean.map((v) => clamp(median - v, MIN_TRIM_DB, MAX_TRIM_DB))

  // The median can sit above the loudest track only after clamping; if any
  // loudest-track trim came out positive, shift the whole set down by it.
  const loudest = Math.max(...clean)
  let anchor = -Infinity
  for (let i = 0; i < n; i++) if (clean[i] === loudest && trims[i] > anchor) anchor = trims[i]
  if (anchor > 0) for (let i = 0; i < n; i++) trims[i] = clamp(trims[i] - anchor, MIN_TRIM_DB, MAX_TRIM_DB)

  return trims.map(round1)
}

// ---- additive instrument bank ----------------------------------------------

export const INSTRUMENTS = [
  { name: 'glass', wave: 'sine', attack: 0.004, release: 0.35 },
  { name: 'reed', wave: 'square', attack: 0.06, release: 0.18 },
  { name: 'brass', wave: 'saw', attack: 0.02, release: 0.12 },
  { name: 'pluck', wave: 'saw', attack: 0.002, release: 0.25 },
  { name: 'pad', wave: 'sine', attack: 0.25, release: 0.6 },
  { name: 'bell', wave: 'square', attack: 0.001, release: 0.9 },
]

// Harmonic number + amplitude, plus a per-second decay. Distinct spectra so no
// two previews sound or sample alike.
const SPECTRA = {
  glass: { partials: [[1, 1], [2, 0.35], [3, 0.2], [5, 0.12], [7, 0.06]], decay: 3 },
  reed: { partials: [[1, 1], [3, 0.5], [5, 0.33], [7, 0.22], [9, 0.15]], decay: 1.2 },
  brass: { partials: [[1, 1], [2, 0.6], [3, 0.45], [4, 0.3], [5, 0.2], [6, 0.12], [7, 0.08]], decay: 0.8 },
  pluck: { partials: [[1, 1], [2, 0.25], [3, 0.1], [4, 0.05]], decay: 5 },
  pad: { partials: [[1, 1], [2, 0.15], [3, 0.06]], decay: 0.15 },
  bell: { partials: [[1, 1], [2, 0.4], [3, 0.25], [4, 0.15], [5, 0.1], [6, 0.06], [7, 0.04]], decay: 2 },
}

function findInstrument(name) {
  const instrument = INSTRUMENTS.find((i) => i.name === name)
  if (!instrument) throw new Error('unknown instrument')
  return instrument
}

// One note of `dur` seconds at `hz`, additive, enveloped, peak-normalised to
// 0.9 so it can never clip.
export function renderNote(instrumentName, hz, dur, sampleRate) {
  const instrument = findInstrument(instrumentName)
  if (!Number.isFinite(hz) || hz <= 0) throw new Error('hz must be a positive finite number')
  if (!Number.isFinite(dur) || dur < 0) throw new Error('dur must be a non-negative finite number')
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('sample rate must be a positive finite number')
  }
  if (!WAVES.has(instrument.wave)) throw new Error('unknown wave')

  const length = Math.round(dur * sampleRate)
  const out = new Float32Array(length)
  if (length === 0) return out

  const { partials, decay } = SPECTRA[instrument.name]
  const nyquist = sampleRate / 2
  const attack = clamp(Math.round(instrument.attack * sampleRate), 0, length)
  const release = clamp(Math.round(instrument.release * sampleRate), 0, length - attack)
  const releaseStart = length - release
  const step = (2 * Math.PI * hz) / sampleRate

  for (let i = 0; i < length; i++) {
    let env = 1
    if (attack > 0 && i < attack) env = i / attack
    else if (release > 0 && i >= releaseStart) env = (length - i) / release
    env *= Math.exp((-decay * i) / sampleRate)
    let sample = 0
    for (const [harmonic, amplitude] of partials) {
      const f = hz * harmonic
      if (f >= nyquist) break
      sample += amplitude * Math.sin(step * harmonic * i)
    }
    out[i] = sample * env
  }

  let peak = 0
  for (let i = 0; i < length; i++) {
    const a = Math.abs(out[i])
    if (Number.isFinite(a) && a > peak) peak = a
  }
  if (peak > 0) {
    const gain = 0.9 / peak
    for (let i = 0; i < length; i++) out[i] = Number.isFinite(out[i]) ? out[i] * gain : 0
  } else {
    out.fill(0)
  }
  return out
}
