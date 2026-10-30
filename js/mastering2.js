// js/mastering2.js — preset mastering surface (mastering node, preset variant).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and
// in the browser.
//
// The shape deliberately mirrors the product surface users of the real thing
// expect: a preset slug, an intensity dial, an input trim, three fixed EQ
// bands (low / mid / high) behind ONE shared eqBypass, and a whole-chain
// bypass. Nothing here is parametric — the preset supplies the curve, the
// user only trims it.
//
// State is plain data and every setter returns a NEW state; nothing mutates
// its input. Band gains are dB and clamped to ±12, input trim to ±24.
//
// Chain invariant: the limiter is always the last node, even bypassed.

const BAND_LIMIT_DB = 12
const INPUT_GAIN_LIMIT_DB = 24
const SUGGESTION_LIMIT_DB = 6
const LIMITER_CEILING_DB = -0.3
const LOW_SPLIT_HZ = 180 // one-pole split between low and mid
const HIGH_SPLIT_HZ = 4000 // one-pole split between mid and high
const BANDS = ['low', 'mid', 'high']

// Fixed band nodes, low to high. Frequencies and Qs are the only ones the
// surface ever exposes; the user moves gain only.
const BAND_NODES = {
  low: { node: 'lowShelf', kind: 'lowshelf', freq: 120, q: 0.71 },
  mid: { node: 'midBell', kind: 'peaking', freq: 1200, q: 0.9 },
  high: { node: 'highShelf', kind: 'highshelf', freq: 7000, q: 0.71 },
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const clean = (v) => (Number.isFinite(v) ? v : 0)
const clamp01 = (v) => clamp(clean(v), 0, 1)
const clampDb = (v, limit) => clamp(clean(v), -limit, limit)
const round3 = (v) => Math.round(v * 1000) / 1000

// Preset curves are all inside ±3 dB so a heavy intensity still leaves
// headroom under BAND_LIMIT_DB. intensityBias stretches or tames the curve:
// it is how "Fire" hits harder than "Natural" at the same dial position.
export const PRESETS = Object.freeze([
  Object.freeze({
    slug: 'universal',
    name: 'Universal',
    desc: 'Balanced polish that survives any mix',
    intensityBias: 1,
    lowGain: 0.8,
    midGain: 0.4,
    highGain: 0.8,
  }),
  Object.freeze({
    slug: 'fire',
    name: 'Fire',
    desc: 'Loud, forward and hot through the mids',
    intensityBias: 1.3,
    lowGain: 1.2,
    midGain: 2.2,
    highGain: 1,
  }),
  Object.freeze({
    slug: 'clarity',
    name: 'Clarity',
    desc: 'Clears mud, lifts presence and air',
    intensityBias: 1.1,
    lowGain: -1.2,
    midGain: 1.2,
    highGain: 2.6,
  }),
  Object.freeze({
    slug: 'tape',
    name: 'Tape',
    desc: 'Warm low glue with a rolled-off top',
    intensityBias: 0.9,
    lowGain: 1,
    midGain: 0.8,
    highGain: -1.4,
  }),
  Object.freeze({
    slug: 'natural',
    name: 'Natural',
    desc: 'Barely-there correction, preserves dynamics',
    intensityBias: 0.6,
    lowGain: 0.3,
    midGain: 0.2,
    highGain: 0.6,
  }),
  Object.freeze({
    slug: 'spatial',
    name: 'Spatial',
    desc: 'Scooped mids with a wide, airy top',
    intensityBias: 1,
    lowGain: 0.4,
    midGain: -1.2,
    highGain: 2.2,
  }),
  Object.freeze({
    slug: 'cinematic',
    name: 'Cinematic',
    desc: 'Huge low end under a dark top',
    intensityBias: 1.2,
    lowGain: 2.4,
    midGain: 0.6,
    highGain: -0.8,
  }),
  Object.freeze({
    slug: 'punch',
    name: 'Punch',
    desc: 'Tight low end and snappy upper mids',
    intensityBias: 1.15,
    lowGain: 1.8,
    midGain: 1.4,
    highGain: 0.4,
  }),
])

export const INTENSITIES = Object.freeze(['Light', 'Normal', 'Heavy'])

// Dial label -> 0..1 position. Defaults to the middle label.
export const INTENSITY_VALUES = Object.freeze({ Light: 0.2, Normal: 0.5, Heavy: 0.85 })

export const DEFAULT_INTENSITY = INTENSITY_VALUES.Normal

export function presetBySlug(slug) {
  return PRESETS.find((p) => p.slug === slug) ?? null
}

// Nearest dial label for a 0..1 position; ties go to the earlier label.
export function intensityLabel(value) {
  const v = clamp01(value)
  let best = INTENSITIES[0]
  let bestDist = Infinity
  for (const label of INTENSITIES) {
    const dist = Math.abs(INTENSITY_VALUES[label] - v)
    if (dist < bestDist) {
      best = label
      bestDist = dist
    }
  }
  return best
}

export function createState(init = {}) {
  const o = init ?? {}
  const preset = presetBySlug(o.preset) ? o.preset : 'universal'
  return clampState({
    preset,
    intensity: o.intensity ?? DEFAULT_INTENSITY,
    inputGain: o.inputGain ?? 0,
    low: o.low ?? 0,
    mid: o.mid ?? 0,
    high: o.high ?? 0,
    eqBypass: o.eqBypass ?? false,
    bypass: o.bypass ?? false,
  })
}

// Never throws. Always a fresh object with every field inside bounds and a
// known preset slug.
export function clampState(state) {
  const s = state ?? {}
  return {
    preset: presetBySlug(s.preset) ? s.preset : 'universal',
    intensity: clamp01(s.intensity ?? DEFAULT_INTENSITY),
    inputGain: clampDb(s.inputGain, INPUT_GAIN_LIMIT_DB),
    low: clampDb(s.low, BAND_LIMIT_DB),
    mid: clampDb(s.mid, BAND_LIMIT_DB),
    high: clampDb(s.high, BAND_LIMIT_DB),
    eqBypass: Boolean(s.eqBypass),
    bypass: Boolean(s.bypass),
  }
}

// ---- setters ---------------------------------------------------------------
// Every setter is (state, value) -> new state, clamped.

export function setPreset(state, slug) {
  if (!presetBySlug(slug)) throw new Error('unknown mastering preset')
  return clampState({ ...clampState(state), preset: slug })
}

export function setIntensity(state, value) {
  return clampState({ ...clampState(state), intensity: value })
}

export function setInputGain(state, db) {
  return clampState({ ...clampState(state), inputGain: db })
}

export function setBand(state, band, db) {
  if (!BANDS.includes(band)) throw new Error('band must be low, mid or high')
  return clampState({ ...clampState(state), [band]: db })
}

export function toggleEqBypass(state) {
  const s = clampState(state)
  return { ...s, eqBypass: !s.eqBypass }
}

export function toggleBypass(state) {
  const s = clampState(state)
  return { ...s, bypass: !s.bypass }
}

export function isBypassed(state) {
  return Boolean(state?.bypass)
}

// ---- effective gains -------------------------------------------------------

// Final per-band gains in dB after the preset curve is scaled by intensity
// and its bias, then offset by the user trims. Bands read 0 under eqBypass or
// bypass; under a whole-chain bypass the input trim is neutral too.
export function effectiveGains(state) {
  const s = clampState(state)
  if (s.bypass || s.eqBypass) return { low: 0, mid: 0, high: 0 }
  const preset = presetBySlug(s.preset)
  const scale = s.intensity * preset.intensityBias
  return {
    low: round3(clampDb(s.low + preset.lowGain * scale, BAND_LIMIT_DB)),
    mid: round3(clampDb(s.mid + preset.midGain * scale, BAND_LIMIT_DB)),
    high: round3(clampDb(s.high + preset.highGain * scale, BAND_LIMIT_DB)),
  }
}

// ---- reference analysis ----------------------------------------------------

const onePole = (hz, sampleRate) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate)

function channelsOf(channels) {
  if (channels && !Array.isArray(channels) &&
      channels.left instanceof Float32Array && channels.right instanceof Float32Array) {
    return [channels.left, channels.right]
  }
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error('channels must be a non-empty array of Float32Array')
  }
  for (const ch of channels) {
    if (!(ch instanceof Float32Array)) throw new Error('channels must be a non-empty array of Float32Array')
  }
  return channels
}

// Three band energies via one-pole splits (low below 180 Hz, high above 4 kHz,
// mid is the band between) plus overall loudness. Returns gain suggestions
// inside ±6 dB: a band louder than the track's own average is cut, a quieter
// one is lifted. intensity follows crest factor — a squashed mix asks for more
// push, a dynamic one for less.
export function analyseReference(channels, sampleRate) {
  const chans = channelsOf(channels)
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('sampleRate must be a positive finite number')
  }
  const aLow = onePole(LOW_SPLIT_HZ, sampleRate)
  const aMid = onePole(HIGH_SPLIT_HZ, sampleRate)
  let lowState = 0
  let midState = 0
  let lowSq = 0
  let midSq = 0
  let highSq = 0
  let sumSq = 0
  let peak = 0
  let frames = 0
  for (const ch of chans) {
    lowState = 0
    midState = 0
    for (let i = 0; i < ch.length; i++) {
      const x = clean(ch[i])
      lowState += aLow * (x - lowState)
      midState += aMid * (x - midState)
      const low = lowState
      const mid = midState - lowState
      const high = x - midState
      lowSq += low * low
      midSq += mid * mid
      highSq += high * high
      sumSq += x * x
      const mag = Math.abs(x)
      if (mag > peak) peak = mag
      frames++
    }
  }
  if (frames === 0 || sumSq === 0) {
    return { low: 0, mid: 0, high: 0, intensity: DEFAULT_INTENSITY }
  }
  const db = (sq) => (sq > 0 ? 20 * Math.log10(Math.sqrt(sq / frames)) : -Infinity)
  const lowDb = db(lowSq)
  const midDb = db(midSq)
  const highDb = db(highSq)
  const finite = [lowDb, midDb, highDb].filter(Number.isFinite)
  const mean = finite.reduce((a, b) => a + b, 0) / (finite.length || 1)
  const suggest = (bandDb) => (Number.isFinite(bandDb) ? round3(clampDb((mean - bandDb) * 0.8, SUGGESTION_LIMIT_DB)) : 0)
  const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / frames))
  const crestDb = 20 * Math.log10(peak) - rmsDb
  return {
    low: suggest(lowDb),
    mid: suggest(midDb),
    high: suggest(highDb),
    intensity: round3(clamp((18 - crestDb) / 16, 0.15, 0.9)),
  }
}

// ---- chain -----------------------------------------------------------------

// Node order, input trim first and the limiter last, always.
export function chainOrder() {
  return ['inputGain', ...BANDS.map((b) => BAND_NODES[b].node), 'limiter']
}

// Structured chain description for the UI / the real master chain. Band nodes
// stay present but `active: false` when eqBypass is on; a whole-chain bypass
// additionally drops the input trim. The limiter is never dropped and never
// moves off the end.
export function buildChainFrom(state) {
  const s = clampState(state)
  const gains = effectiveGains(s)
  const bandsLive = !s.bypass && !s.eqBypass
  const chain = [
    { node: 'inputGain', gainDb: s.bypass ? 0 : round3(s.inputGain), active: !s.bypass },
  ]
  for (const band of BANDS) {
    chain.push({ ...BAND_NODES[band], gainDb: bandsLive ? gains[band] : 0, active: bandsLive })
  }
  chain.push({ node: 'limiter', ceilingDb: LIMITER_CEILING_DB, active: true })
  return chain
}
