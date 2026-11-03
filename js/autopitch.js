// js/autopitch.js — AutoPitch panel model (pitch node, preset variant).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and
// in the browser.
//
// A preset is a correction character plus an optional harmony voice. Presets
// carry a tier: the free three ship with the app, the membership three are
// locked until the account says otherwise. `detectKey` reads a note list's
// pitch-class histogram and proposes a key; `applyToNotes` pulls notes toward
// that key by strength × the preset's correction bias.
//
// Snap distance, tie-breaking and cents rounding all come from js/tune.js so
// this module can never disagree with the tune node. Nothing here mutates its
// input; every setter returns a NEW state.

import { hzToMidi, midiToHz, nearestInScale } from './tune.js'

const FORMANT_LIMIT = 12
const DEFAULT_STRENGTH = 1

// Same rounding as js/tune.js `round6`: cents are kept to six decimals so
// repeated passes over a note list are stable.
const round6 = (x) => Math.round(x * 1e6) / 1e6

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const clean = (v) => (Number.isFinite(v) ? v : 0)
const clamp01 = (v) => clamp(clean(v), 0, 1)
const mod12 = (n) => ((n % 12) + 12) % 12

// correctionBias scales the dial: below 1 is looser than the dial says, above
// 1 is harder. Harmony voices are offsets in semitones, 0 = no extra voice.
export const PRESETS = Object.freeze([
  Object.freeze({ slug: 'classic', name: 'Classic', tier: 'free', duet: false, harmonySemitones: 0, correctionBias: 1 }),
  Object.freeze({ slug: 'duet', name: 'Duet', tier: 'free', duet: true, harmonySemitones: 0, correctionBias: 0.85 }),
  Object.freeze({ slug: 'big-harmony', name: 'Big Harmony', tier: 'free', duet: false, harmonySemitones: 12, correctionBias: 0.9 }),
  Object.freeze({ slug: 'natural', name: 'Natural', tier: 'membership', duet: false, harmonySemitones: 0, correctionBias: 0.55 }),
  Object.freeze({ slug: 'third', name: 'Third', tier: 'membership', duet: false, harmonySemitones: 4, correctionBias: 0.8 }),
  Object.freeze({ slug: 'chip', name: 'Chip', tier: 'membership', duet: false, harmonySemitones: 12, correctionBias: 1.15 }),
])

// Twelve tonic buttons, C first.
export const TONIC_GRID = Object.freeze(
  ['C', 'C\u266F D\u266D', 'D', 'D\u266F E\u266D', 'E', 'F', 'F\u266F G\u266D', 'G', 'G\u266F A\u266D', 'A', 'A\u266F B\u266D', 'B'].map((name, pitchClass) =>
    Object.freeze({ name, pitchClass })
  )
)

// Semitone offsets from the tonic, one octave. Chromatic is the default so an
// untouched panel does not silently retune anything.
export const SCALES = Object.freeze({
  chromatic: Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
  major: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
  minor: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  mixolydian: Object.freeze([0, 2, 4, 5, 7, 9, 10]),
  pentatonic: Object.freeze([0, 2, 4, 7, 9]),
})

export const SCALE_NAMES = Object.freeze(Object.keys(SCALES))

// Detection preference order. Pentatonic sits late and chromatic last: the
// denser the scale, the bigger the coverage penalty it carries.
const DETECT_ORDER = Object.freeze(['major', 'minor', 'dorian', 'mixolydian', 'pentatonic', 'chromatic'])
const COVERAGE_PENALTY = 0.02

export function presetBySlug(slug) {
  return PRESETS.find((p) => p.slug === slug) ?? null
}

export function isMembership(preset) {
  return (presetBySlug(preset)?.tier ?? 'free') === 'membership'
}

export function createState(init = {}) {
  const o = init ?? {}
  const preset = presetBySlug(o.preset) ? o.preset : 'classic'
  return clampState({
    preset,
    strength: o.strength ?? DEFAULT_STRENGTH,
    scale: o.scale ?? 'chromatic',
    tonic: o.tonic ?? 0,
    autoDetect: o.autoDetect ?? true,
    formant: o.formant ?? 0,
    humanise: o.humanise ?? 0.5,
  })
}

// Never throws. Fresh object, every field inside bounds, preset and scale
// coerced to something known.
export function clampState(state) {
  const s = state ?? {}
  const tonic = Number.isInteger(s.tonic) ? mod12(s.tonic) : 0
  return {
    preset: presetBySlug(s.preset) ? s.preset : 'classic',
    strength: clamp01(s.strength ?? DEFAULT_STRENGTH),
    scale: Object.hasOwn(SCALES, s.scale) ? s.scale : 'chromatic',
    tonic,
    autoDetect: Boolean(s.autoDetect),
    formant: clamp(clean(s.formant), -FORMANT_LIMIT, FORMANT_LIMIT),
    humanise: clamp01(s.humanise ?? 0.5),
  }
}

// ---- setters ---------------------------------------------------------------

export function setPreset(state, slug) {
  if (!presetBySlug(slug)) throw new Error('unknown autopitch preset')
  return assign(state, clampState({ ...clampState(state), preset: slug }))
}

// Setters write through to the object the caller holds *and* return it: the
// panels keep a long-lived state and only some call sites reassign, so a pure
// copy here leaves the UI silently inert.
function assign(state, next) {
  for (const k of Object.keys(next)) state[k] = next[k]
  return state
}

export function setStrength(state, value) {
  return assign(state, clampState({ ...clampState(state), strength: value }))
}

export function setScale(state, scale) {
  if (!Object.hasOwn(SCALES, scale)) throw new Error('unknown scale')
  return assign(state, clampState({ ...clampState(state), scale }))
}

export function setTonic(state, tonic) {
  if (!Number.isInteger(tonic)) throw new Error('tonic must be an integer')
  return assign(state, clampState({ ...clampState(state), tonic }))
}

export function setAutoDetect(state, on) {
  return assign(state, clampState({ ...clampState(state), autoDetect: Boolean(on) }))
}

// Partial merge: only the keys present are touched.
export function setAdvanced(state, opts = {}) {
  const s = clampState(state)
  const o = opts ?? {}
  return assign(state, clampState({
    ...s,
    formant: o.formant === undefined ? s.formant : o.formant,
    humanise: o.humanise === undefined ? s.humanise : o.humanise,
  }))
}

// ---- key detection ---------------------------------------------------------

function noteMidi(note) {
  if (Number.isFinite(note.midi)) return note.midi
  if (Number.isFinite(note.hz) && note.hz > 0) return hzToMidi(note.hz)
  return null
}

// Pitch-class histogram from midi numbers (fractions allowed). Returns
// { tonic, scale, confidence } — confidence is the winning coverage 0..1 and
// is 0 for an empty list. Tonic notes weigh 1.5 so a key's own root wins ties.
export function detectKey(midiNotes) {
  if (!Array.isArray(midiNotes)) throw new Error('midiNotes must be an array')
  const weights = new Array(12).fill(0)
  let total = 0
  let distinct = 0
  for (const raw of midiNotes) {
    if (!Number.isFinite(raw)) continue
    const pc = mod12(Math.round(raw))
    if (weights[pc] === 0) distinct++
    weights[pc] += 1
    total += 1
  }
  if (total === 0) return { tonic: 0, scale: 'chromatic', confidence: 0 }
  let best = { tonic: 0, scale: 'major', score: -Infinity }
  for (const scale of DETECT_ORDER) {
    const offsets = SCALES[scale]
    const penalty = 1 - COVERAGE_PENALTY * (offsets.length - 1)
    for (let tonic = 0; tonic < 12; tonic++) {
      let hit = 0
      for (const offset of offsets) {
        const pc = mod12(tonic + offset)
        hit += weights[pc] * (pc === tonic ? 1.5 : 1)
      }
      const score = (hit / total) * penalty
      if (score > best.score) best = { tonic, scale, score }
    }
  }
  // A key found from two notes is a guess, so confidence is scaled by how much
  // of the chromatic set the material actually visits.
  const density = Math.min(1, distinct / 5)
  const confidence = Math.round(clamp01(best.score) * density * 1e3) / 1e3
  return { tonic: best.tonic, scale: best.scale, confidence }
}

// ---- application -----------------------------------------------------------

// How far one note moves under the current state, in semitones. Playback asks
// this every frame while a parameter is dragged, so it must stay cheap and
// total (never throws on a bare note).
export function liveShift(note, state) {
  if (!note) return 0
  try {
    return applyToNotes([note], state)[0].shift ?? 0
  } catch {
    return 0
  }
}

// Tuned copies of `notes`. `strength` × the preset's bias is how far each note
// travels toward the nearest in-scale tone; 0 leaves the pitch untouched.
// Adds `.cents` (offset of the result from the target), `.shift` (semitones of
// transposition playback must apply), `.snappedFrom`, and
// `.harmonyMidi`/`.harmonyHz` when the preset carries a harmony voice.
export function applyToNotes(notes, state) {
  if (!Array.isArray(notes)) throw new Error('notes must be an array')
  const s = clampState(state)
  const preset = presetBySlug(s.preset)
  const amount = clamp01(s.strength * preset.correctionBias)
  return notes.map((note) => {
    // The recorded take pitch, not whatever a previous pass left in `hz`, so
    // tuning twice lands in the same place instead of stacking.
    // `origMidi` is the pitch as recorded; `snappedFrom` may already be a
    // previous pass's result once the editor has moved the note.
    const orig = Number.isFinite(note.origMidi) ? note.origMidi
      : Number.isFinite(note.snappedFrom) ? note.snappedFrom : noteMidi(note)
    if (orig === null) return { ...note }
    const target = nearestInScale(orig, s.tonic, s.scale)
    const midi = orig + amount * (target - orig)
    const out = {
      ...note,
      midi,
      hz: midiToHz(midi),
      cents: round6((midi - target) * 100),
      shift: round6(midi - orig),
      snappedFrom: orig,
    }
    if (preset.harmonySemitones !== 0) {
      out.harmonyMidi = midi + preset.harmonySemitones
      out.harmonyHz = midiToHz(out.harmonyMidi)
    }
    return out
  })
}
