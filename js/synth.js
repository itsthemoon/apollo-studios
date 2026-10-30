// js/synth.js — polyphonic subtractive voice engine for apollo-studios.
// Pure ESM, dependency-free, no browser globals at import time. Runs under plain
// Node 22 and in the browser; every function that needs audio takes the
// AudioContext as its first argument.
//
// A voice is: two detuned oscillators plus a noise bed -> lowpass filter ->
// amp envelope -> per-voice output gain. Nothing is sampled; the noise bed is a
// deterministic buffer built once per context and reused.
//
// The filter envelope is summed onto `filter.detune`, which the Web Audio spec
// adds to `filter.frequency` in cents. An env of 1.0 slams the filter four
// octaves open and decays back to the patch cutoff, so it tracks the amp
// envelope without a second Hz ramp fighting the cutoff value.
//
// makeVoice owns its nodes; stop(when) is idempotent and releases at `when`
// (default: as soon as possible). stopAll() releases every live voice — call it
// on transport stop, patch change and page teardown.

const WAVES = new Set(['sawtooth', 'square', 'triangle', 'sine'])

const MIN_DUR = 0.02               // seconds; a shorter note would just click
const MIN_RELEASE = 0.01
const VOICE_LEVEL = 0.22           // nominal peak gain before velocity
const FILTER_ENV_CENTS = 4800      // filterEnv 1.0 = 4 octaves of sweep
const MAX_VOICES = 32              // oldest voice is stolen past this
const NOISE_SECONDS = 1
const MIN_CUTOFF = 40
const MAX_CUTOFF = 18000
const MIN_Q = 0.1
const MAX_Q = 30
const MIN_GLIDE = 0
const MAX_GLIDE = 2

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback)
const freeze = (o) => Object.freeze(o)

export const SYNTH_DEFAULTS = freeze({
  osc1: 'sawtooth',
  osc2: 'square',
  detuneCents: 7,
  osc2Gain: 0.35,
  noise: 0.05,
  cutoff: 2400,
  resonance: 1.2,
  env: freeze({ a: 0.01, d: 0.18, s: 0.6, r: 0.22 }),
  filterEnv: 0.5,
  glide: 0,
})

// Factory patches. Each one is a full override of SYNTH_DEFAULTS so a preset
// never inherits a stray value from the default patch; resolveParams still lets
// callers override individual fields on top of any of them.
export const VOICE_PRESETS = freeze({
  keys: freeze({
    osc1: 'triangle',
    osc2: 'sine',
    detuneCents: 3,
    osc2Gain: 0.22,
    noise: 0.02,
    cutoff: 3200,
    resonance: 0.8,
    env: freeze({ a: 0.005, d: 0.5, s: 0.7, r: 0.5 }),
    filterEnv: 0.35,
    glide: 0,
  }),
  pad: freeze({
    osc1: 'sawtooth',
    osc2: 'sawtooth',
    detuneCents: 11,
    osc2Gain: 0.4,
    noise: 0.12,
    cutoff: 1400,
    resonance: 0.9,
    env: freeze({ a: 0.6, d: 1.2, s: 0.8, r: 1.1 }),
    filterEnv: 0.7,
    glide: 0,
  }),
  bass: freeze({
    osc1: 'sawtooth',
    osc2: 'square',
    detuneCents: 0,
    osc2Gain: 0.5,
    noise: 0.01,
    cutoff: 420,
    resonance: 2.4,
    env: freeze({ a: 0.006, d: 0.12, s: 0.5, r: 0.08 }),
    filterEnv: 1,
    glide: 0.04,
  }),
  pluck: freeze({
    osc1: 'square',
    osc2: 'sawtooth',
    detuneCents: 5,
    osc2Gain: 0.25,
    noise: 0.06,
    cutoff: 3600,
    resonance: 1.8,
    env: freeze({ a: 0.002, d: 0.09, s: 0.05, r: 0.09 }),
    filterEnv: 0.9,
    glide: 0,
  }),
  strings: freeze({
    osc1: 'sawtooth',
    osc2: 'sawtooth',
    detuneCents: 14,
    osc2Gain: 0.45,
    noise: 0.1,
    cutoff: 1800,
    resonance: 0.7,
    env: freeze({ a: 0.35, d: 0.6, s: 0.85, r: 0.7 }),
    filterEnv: 0.4,
    glide: 0,
  }),
  lead: freeze({
    osc1: 'square',
    osc2: 'sawtooth',
    detuneCents: 8,
    osc2Gain: 0.4,
    noise: 0.02,
    cutoff: 2800,
    resonance: 1.6,
    env: freeze({ a: 0.01, d: 0.15, s: 0.65, r: 0.18 }),
    filterEnv: 0.6,
    glide: 0.06,
  }),
})

export function presetNames() {
  return Object.keys(VOICE_PRESETS)
}

// --- pitch -----------------------------------------------------------------

export function midiToHz(m) {
  if (!Number.isFinite(m)) return 0
  return 440 * Math.pow(2, (m - 69) / 12)
}

// Typing keyboard: home row plays C4..C5 chromatically, z/x shift octaves.
const NOTE_KEYS = [
  ['a', 60], ['w', 61], ['s', 62], ['e', 63], ['d', 64], ['f', 65], ['t', 66],
  ['g', 67], ['y', 68], ['h', 69], ['u', 70], ['j', 71], ['k', 72],
]

export const MUSICAL_TYPING = freeze({
  ...Object.fromEntries(NOTE_KEYS),
  z: -12,
  x: 12,
})

export const OCTAVE_KEYS = freeze({ z: -1, x: 1 })

// Resolves a typing key to a midi note at `octave` (0 = the C4..C5 row).
// z/x answer null because they shift rather than sound. Out-of-range results
// clamp to 0..127. Unknown keys answer null.
export function typingMidi(key, octave = 0) {
  const base = MUSICAL_TYPING[key]
  if (!Number.isFinite(base) || key in OCTAVE_KEYS) return null
  const shift = Number.isFinite(octave) ? Math.trunc(octave) * 12 : 0
  return clamp(base + shift, 0, 127)
}

// --- params ----------------------------------------------------------------

function paramOverrides(params) {
  if (typeof params === 'string') return { preset: params, rest: {} }
  if (!params || typeof params !== 'object') return {}
  const { preset, dest, ...rest } = params
  return { preset, dest, rest }
}

// Merges a preset (name or `{ preset }`) and any per-call overrides onto the
// defaults, then clamps every number into range. Returns a fresh object with a
// fresh env. Throws `unknown voice preset`.
export function resolveParams(params = {}) {
  const { preset, dest, rest } = paramOverrides(params)
  if (preset !== undefined && !VOICE_PRESETS[preset]) throw new Error('unknown voice preset')
  const base = preset ? VOICE_PRESETS[preset] : {}
  const src = { ...base, ...rest }
  const env = { ...SYNTH_DEFAULTS.env, ...(base.env ?? {}), ...(rest.env ?? {}) }
  return {
    osc1: WAVES.has(src.osc1) ? src.osc1 : SYNTH_DEFAULTS.osc1,
    osc2: WAVES.has(src.osc2) ? src.osc2 : SYNTH_DEFAULTS.osc2,
    detuneCents: clamp(finite(src.detuneCents, SYNTH_DEFAULTS.detuneCents), -1200, 1200),
    osc2Gain: clamp(finite(src.osc2Gain, SYNTH_DEFAULTS.osc2Gain), 0, 1),
    noise: clamp(finite(src.noise, SYNTH_DEFAULTS.noise), 0, 1),
    cutoff: clamp(finite(src.cutoff, SYNTH_DEFAULTS.cutoff), MIN_CUTOFF, MAX_CUTOFF),
    resonance: clamp(finite(src.resonance, SYNTH_DEFAULTS.resonance), MIN_Q, MAX_Q),
    env: {
      a: clamp(finite(env.a, 0), 0, 4),
      d: clamp(finite(env.d, 0), 0, 8),
      s: clamp(finite(env.s, 1), 0, 1),
      r: Math.max(MIN_RELEASE, clamp(finite(env.r, MIN_RELEASE), 0, 8)),
    },
    filterEnv: clamp(finite(src.filterEnv, SYNTH_DEFAULTS.filterEnv), 0, 1),
    glide: clamp(finite(src.glide, 0), MIN_GLIDE, MAX_GLIDE),
    velocity: clamp(finite(src.velocity, 100), 0, 127),
    dest: dest ?? null,
  }
}

// --- noise -----------------------------------------------------------------

const noiseCache = new WeakMap()

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

// One deterministic 1 s noise buffer per context, reused by every voice.
function noiseBuffer(ctx) {
  const cached = noiseCache.get(ctx)
  if (cached) return cached
  const rate = finite(ctx.sampleRate, 44100) || 44100
  const data = ctx.createBuffer(1, Math.ceil(rate * NOISE_SECONDS), rate)
  const channel = data.getChannelData(0)
  const rand = mulberry32(0x9e3779b9)
  for (let i = 0; i < channel.length; i++) channel[i] = rand() * 2 - 1
  noiseCache.set(ctx, data)
  return data
}

// --- voice tracking --------------------------------------------------------

const live = new Set()
const lastMidi = new WeakMap()

function track(voice, ctx) {
  while (live.size >= MAX_VOICES) {
    const oldest = live.values().next().value
    if (!oldest) break
    oldest.stop()
    live.delete(oldest)
  }
  live.add(voice)
  return voice
}

export function liveVoiceCount() {
  return live.size
}

export function stopAll(when) {
  for (const voice of [...live]) {
    voice.stop(when)
    live.delete(voice)
  }
}

// --- voice -----------------------------------------------------------------

// Envelope value at time `t`, for re-scheduling a release mid-note.
function levelAt(p, t0, peak, t) {
  const { a, d, s } = p.env
  if (t <= t0) return 0
  const attack = Math.max(0.001, Math.min(a, p.dur * 0.4))
  if (t < t0 + attack) return peak * ((t - t0) / attack)
  const decay = Math.max(0.001, Math.min(d, Math.max(0.001, p.dur - attack)))
  if (t < t0 + attack + decay) {
    const k = (t - t0 - attack) / decay
    return peak * (1 - k * (1 - s))
  }
  return peak * s
}

// Builds and starts one voice. `when` and `dur` are in context seconds.
// Returns { gain, filter, sources, stop } — `gain` is the voice's output node
// so callers can ride it. `stop(when)` releases at that time (default now) and
// is a no-op the second time.
export function makeVoice(ctx, midi, when = 0, dur = 0.5, params = {}) {
  if (!ctx) throw new Error('missing audio context')
  if (!Number.isFinite(midi)) throw new Error('bad midi')
  const note = clamp(Math.round(midi), 0, 127)
  const p = resolveParams(params)
  const t0 = Math.max(0, finite(when, 0))
  p.dur = Number.isFinite(dur) ? Math.max(MIN_DUR, dur) : MIN_DUR

  const velGain = 0.15 + 0.85 * (p.velocity / 127)
  const peak = VOICE_LEVEL * velGain
  const end = t0 + p.dur
  const releaseEnd = end + p.env.r

  const out = ctx.createGain()
  const amp = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  const osc1 = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const osc2Level = ctx.createGain()
  const noise = ctx.createBufferSource()
  const noiseLevel = ctx.createGain()

  out.gain.value = 1
  amp.gain.value = 0
  filter.type = 'lowpass'
  filter.frequency.value = p.cutoff
  filter.Q.value = p.resonance
  filter.detune.value = p.filterEnv * FILTER_ENV_CENTS

  osc1.type = p.osc1
  osc2.type = p.osc2
  osc2Level.gain.value = p.osc2Gain
  noiseLevel.gain.value = p.noise
  noise.buffer = noiseBuffer(ctx)
  noise.loop = true

  // Pitch, with an optional glide from the previous note on this context.
  const target = midiToHz(note)
  const from = lastMidi.get(ctx)
  lastMidi.set(ctx, note)
  for (const osc of [osc1, osc2]) {
    if (p.glide > 0 && Number.isFinite(from) && from !== note) {
      osc.frequency.setValueAtTime(midiToHz(from), t0)
      osc.frequency.exponentialRampToValueAtTime(target, t0 + p.glide)
    } else {
      osc.frequency.setValueAtTime(target, t0)
    }
    osc.detune.value = osc === osc2 ? p.detuneCents : 0
  }

  osc1.connect(amp)
  osc2.connect(osc2Level)
  osc2Level.connect(amp)
  noise.connect(noiseLevel)
  noiseLevel.connect(amp)
  amp.connect(filter)
  filter.connect(out)
  out.connect(p.dest ?? ctx.destination)

  // Amp ADSR.
  const attack = Math.max(0.001, Math.min(p.env.a, p.dur * 0.4))
  const decay = Math.max(0.001, Math.min(p.env.d, Math.max(0.001, p.dur - attack)))
  const sustain = peak * p.env.s
  amp.gain.setValueAtTime(0, t0)
  amp.gain.linearRampToValueAtTime(peak, t0 + attack)
  amp.gain.linearRampToValueAtTime(sustain, t0 + attack + decay)
  amp.gain.linearRampToValueAtTime(sustain, end)
  amp.gain.linearRampToValueAtTime(0.0001, releaseEnd)

  // Filter env: open, then fall back to the patch cutoff over attack + decay.
  filter.detune.setValueAtTime(p.filterEnv * FILTER_ENV_CENTS, t0)
  filter.detune.linearRampToValueAtTime(0, t0 + attack + decay)
  filter.detune.setValueAtTime(0, end)

  const sources = [osc1, osc2, noise]
  for (const source of sources) {
    source.start(t0)
    source.stop(releaseEnd + 0.02)
  }

  let released = false
  const voice = {
    gain: out,
    filter,
    sources,
    midi: note,
    stop(when) {
      if (released) return
      released = true
      const at = Math.max(t0, finite(when, ctx.currentTime ?? t0))
      const level = levelAt(p, t0, peak, at)
      amp.gain.cancelScheduledValues(at)
      amp.gain.setValueAtTime(level, at)
      amp.gain.linearRampToValueAtTime(0.0001, at + p.env.r)
      filter.detune.cancelScheduledValues(at)
      filter.detune.setValueAtTime(filter.detune.value, at)
      filter.detune.linearRampToValueAtTime(0, at + p.env.r)
      for (const source of sources) {
        try { source.stop(at + p.env.r + 0.02) } catch { /* already stopped */ }
      }
      live.delete(voice)
    },
    disconnect() {
      out.disconnect()
      amp.disconnect()
      filter.disconnect()
      for (const source of sources) source.disconnect()
      osc2Level.disconnect()
      noiseLevel.disconnect()
    },
  }

  for (const source of sources) source.onended = () => { live.delete(voice) }
  return track(voice, ctx)
}

// --- scheduling -------------------------------------------------------------

// Schedules [{ midi, start, dur, velocity }] relative to `ctx.currentTime`.
// Notes are visited in start order; returns the voices so callers can stop them.
// Bad entries are skipped rather than throwing mid-sequence.
export function renderNotes(ctx, notes, params = {}) {
  if (!Array.isArray(notes)) throw new Error('notes must be an array')
  const now = ctx?.currentTime ?? 0
  const ordered = notes
    .filter((n) => n && Number.isFinite(n.midi) && Number.isFinite(n.start) && Number.isFinite(n.dur) && n.dur > 0)
    .sort((a, b) => a.start - b.start)
  const shared = typeof params === 'object' && params !== null ? params : { preset: params }
  return ordered.map((note) => makeVoice(ctx, note.midi, now + Math.max(0, note.start), note.dur, {
    ...shared,
    velocity: Number.isFinite(note.velocity) ? note.velocity : 100,
  }))
}
