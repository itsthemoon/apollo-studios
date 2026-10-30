// js/tune.js — pitch correction for apollo-studios (tune node).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22
// and in the browser. See js/contract.md for the module contract.
//
// All pitch work is 12-TET: A4 = 440 Hz at midi note 69, so
//   f  = 440 * 2 ** ((m - 69) / 12)
//   m  = 69 + 12 * log2(f / 440)
// Midi is fractional-friendly: 1.0 = one semitone, 0.01 = one cent.

// --- 12-TET helpers -----------------------------------------------------

export function hzToMidi(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return 0
  return 69 + 12 * Math.log2(hz / 440)
}

export function midiToHz(m) {
  if (!Number.isFinite(m)) return 0
  return 440 * Math.pow(2, (m - 69) / 12)
}

// Signed cents of `hz` relative to the given midi note: positive = sharp.
export function centsBetween(hz, midi) {
  if (!Number.isFinite(hz) || hz <= 0) return 0
  return 1200 * Math.log2(hz / midiToHz(midi))
}

// --- Scale table --------------------------------------------------------
// Semitone offsets from the root, starting at 0 and blending upward for two
// octaves. The task-required snake_case names come first; the camelCase
// entries are aliases of them plus the extra modes js/presets.js already
// ships, so presets.js can replace its local copy with
// `import { SCALES } from './tune.js'` without breaking its builtins.

const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24]
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24]
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11, 12, 14, 15, 17, 19, 20, 23, 24]
const DORIAN = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19, 21, 22, 24]
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 24]
const PENTATONIC_MAJOR = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
const PENTATONIC_MINOR = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24]
const BLUES = [0, 3, 5, 6, 7, 10, 12, 15, 17, 18, 19, 22, 24]
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10, 12, 13, 15, 17, 19, 20, 22, 24]
const LYDIAN = [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24]
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10, 12, 13, 15, 17, 18, 20, 22, 24]

export const SCALES = {
  chromatic: CHROMATIC,
  major: MAJOR,
  natural_minor: NATURAL_MINOR,
  harmonic_minor: HARMONIC_MINOR,
  dorian: DORIAN,
  mixolydian: MIXOLYDIAN,
  pentatonic_major: PENTATONIC_MAJOR,
  pentatonic_minor: PENTATONIC_MINOR,
  blues: BLUES,
  // camelCase aliases + extra modes, kept in sync with js/presets.js
  minor: NATURAL_MINOR,
  harmonicMinor: HARMONIC_MINOR,
  pentatonicMajor: PENTATONIC_MAJOR,
  pentatonicMinor: PENTATONIC_MINOR,
  phrygian: PHRYGIAN,
  lydian: LYDIAN,
  locrian: LOCRIAN,
}

export function scaleNames() {
  return Object.keys(SCALES)
}

// --- Scale snapping -------------------------------------------------------

const mod12 = (n) => ((n % 12) + 12) % 12

// When a midi sits exactly halfway between two scale degrees, prefer the
// degree whose interval with the root is more consonant, ordered
// unison/octave > perfect fifth > perfect fourth > third > sixth > second >
// seventh > tritone. Ambiguous notes glue to stable tones: 61 over C snaps
// down to C, while 66 over C snaps up to G. Equal rank (same pitch class,
// an octave apart) settles on the lower note.
const CONSONANCE_RANK = [0, 7, 5, 4, 3, 9, 2, 8, 10, 1, 11, 6]

function tieRank(pc) {
  const i = CONSONANCE_RANK.indexOf(pc)
  return i === -1 ? CONSONANCE_RANK.length : i
}

// Nearest midi note in the given scale, root-relative (offsets are mod 12
// on `midi - root`). Works for any real midi — negative values included —
// and any integer root. Ties resolve per CONSONANCE_RANK, then lower note.
export function nearestInScale(midi, root, scale) {
  if (!Number.isFinite(midi)) return 0
  if (!Number.isFinite(root)) root = 0
  const offsets = SCALES[scale] ?? SCALES.chromatic
  const pcs = new Set(offsets.map(mod12))
  let best = null
  let bestDist = Infinity
  let bestRank = Infinity
  // Any scale degree lies within 6 semitones of midi, so scanning the
  // integers from floor-12 to ceil+12 covers every candidate.
  const lo = Math.floor(midi) - 12
  const hi = Math.ceil(midi) + 12
  for (let m = lo; m <= hi; m++) {
    if (!pcs.has(mod12(m - root))) continue
    const dist = Math.abs(m - midi)
    const rank = tieRank(mod12(m - root))
    if (dist < bestDist || (dist === bestDist && rank < bestRank)) {
      best = m
      bestDist = dist
      bestRank = rank
    }
  }
  return best ?? Math.round(midi)
}

function noteMidi(note) {
  if (Number.isFinite(note.midi)) return note.midi
  if (Number.isFinite(note.hz) && note.hz > 0) return hzToMidi(note.hz)
  return null
}

const round6 = (x) => Math.round(x * 1e6) / 1e6

// Full snap. Returns NEW note objects (input never mutated): midi corrected
// to the nearest in-scale integer, hz re-derived from it, `.cents` = signed
// offset of the original pitch from the snapped midi (positive = sharp),
// `.snappedFrom` = original (possibly fractional) midi.
export function snapNotes(notes, opts = {}) {
  const root = opts.root ?? 60
  const scale = opts.scale ?? 'chromatic'
  return notes.map((note) => {
    const orig = noteMidi(note)
    if (orig === null) return { ...note }
    const snapped = nearestInScale(orig, root, scale)
    return {
      ...note,
      midi: snapped,
      hz: midiToHz(snapped),
      cents: round6((orig - snapped) * 100),
      snappedFrom: orig,
    }
  })
}

// Partial snap. Blends the original and snapped midi by `amount`
// (0 = untouched, 1 = fully snapped), interpolating in cents so intermediate
// amounts yield fractional midi. `.cents` = signed offset of the blended
// midi from the snapped target. Always returns new objects.
export function snapStrength(notes, opts = {}) {
  const root = opts.root ?? 60
  const scale = opts.scale ?? 'chromatic'
  const amount = Number.isFinite(opts.amount) ? Math.min(1, Math.max(0, opts.amount)) : 1
  return notes.map((note) => {
    const orig = noteMidi(note)
    if (orig === null) return { ...note }
    const snapped = nearestInScale(orig, root, scale)
    if (amount === 0) {
      // Identity: pitch untouched, only correction metadata added.
      return { ...note, snappedFrom: orig, cents: round6((orig - snapped) * 100) }
    }
    const blended = orig + amount * (snapped - orig)
    return {
      ...note,
      midi: blended,
      hz: midiToHz(blended),
      cents: round6((blended - snapped) * 100),
      snappedFrom: orig,
    }
  })
}

// Moves each note start to the nearest multiple of (60 / bpm / division)
// seconds, clamps at 0, keeps durations, then re-sorts by start. Returns a
// new array of new objects. Throws on bpm or division <= 0 / non-finite.
export function quantizeStarts(notes, opts = {}) {
  const bpm = opts.bpm
  const division = opts.division
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('bad bpm')
  if (!Number.isFinite(division) || division <= 0) throw new Error('bad division')
  const grid = 60 / bpm / division
  const out = notes.map((note) => ({
    ...note,
    start: Math.max(0, Math.round((Number.isFinite(note.start) ? note.start : 0) / grid) * grid),
  }))
  out.sort((a, b) => a.start - b.start)
  return out
}

// --- Playback speed curve -------------------------------------------------

// Fraction of the note after which the multiplier eases back to 1.0, so the
// corrected tail hands off cleanly to whatever follows (smooth cosine).
const TAIL_START = 0.7

// Per-sample playback multipliers (~1.0). For every sample covered by a
// note the multiplier is 2 ** ((snappedMidi - originalMidi) / 12) — the
// ratio that pulls the note onto its snapped pitch — with the tail eased
// back to 1.0; samples outside notes stay exactly 1.0. Notes need `.midi`
// (snapped/blended) and `.snappedFrom` (original); without `.snappedFrom`
// the multiplier is 1.0. Overlapping notes: the later note in the array
// wins. Returns a new Float32Array of `lengthSamples`.
export function speedCurve(notes, sampleRate, lengthSamples) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('bad sample rate')
  const len = Math.max(0, Math.floor(lengthSamples))
  const curve = new Float32Array(len).fill(1)
  if (len === 0) return curve
  for (const note of notes) {
    const snapped = note.midi
    const orig = Number.isFinite(note.snappedFrom) ? note.snappedFrom : snapped
    if (!Number.isFinite(snapped) || !Number.isFinite(orig) ||
        !Number.isFinite(note.start) || !Number.isFinite(note.dur)) continue
    const base = Math.pow(2, (snapped - orig) / 12)
    const startIdx = Math.max(0, Math.floor(note.start * sampleRate))
    const endIdx = Math.min(len, Math.ceil((note.start + note.dur) * sampleRate))
    if (endIdx <= startIdx) continue
    const span = endIdx - startIdx
    for (let i = startIdx; i < endIdx; i++) {
      const p = (i - startIdx) / span // 0..1 within the note
      let env = 1
      if (p >= TAIL_START) {
        env = 0.5 * (1 + Math.cos((Math.PI * (p - TAIL_START)) / (1 - TAIL_START)))
      }
      curve[i] = 1 + (base - 1) * env
    }
  }
  return curve
}
