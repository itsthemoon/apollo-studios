// js/harmony.js — harmony stacks for voice-studio (harmony node).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and
// in the browser. See js/contract.md and js/contract-appendix.md.
//
// A preset is a named stack of semitone offsets. `shiftNotes` moves a note
// array by a fixed interval and `buildHarmonies` fans one entry out per
// interval, so the UI can render one lane per voice. Every function returns
// new note objects; nothing here mutates its input.

import { hzToMidi, midiToHz } from './tune.js'

const DEGREE_NAMES = {
  0: 'unison',
  1: 'minor 2nd',
  2: 'major 2nd',
  3: 'minor 3rd',
  4: 'major 3rd',
  5: 'perfect 4th',
  6: 'tritone',
  7: 'perfect 5th',
  8: 'minor 6th',
  9: 'major 6th',
  10: 'minor 7th',
  11: 'major 7th',
  12: 'octave',
}

// Kept in a fixed, musically useful order. gainDb is always a trim down (a
// stack adds energy, never level); spreadMs is the suggested onset delay so
// stacked takes do not flam exactly. Both stay inside the contract bounds.
export const HARMONY_PRESETS = Object.freeze([
  Object.freeze({ name: 'thirds', intervals: Object.freeze([3, 4]), gainDb: -9, spreadMs: 14 }),
  Object.freeze({ name: 'fourths', intervals: Object.freeze([5]), gainDb: -9, spreadMs: 10 }),
  Object.freeze({ name: 'fifths', intervals: Object.freeze([7]), gainDb: -8, spreadMs: 8 }),
  Object.freeze({ name: 'octave-down', intervals: Object.freeze([-12]), gainDb: -6, spreadMs: 0 }),
  Object.freeze({ name: 'octave-up', intervals: Object.freeze([12]), gainDb: -10, spreadMs: 0 }),
  Object.freeze({ name: 'wide', intervals: Object.freeze([-12, 7, 12]), gainDb: -12, spreadMs: 34 }),
])

function presetByName(name) {
  const preset = HARMONY_PRESETS.find((p) => p.name === name)
  if (!preset) throw new Error('unknown harmony preset')
  return preset
}

function labelFor(semitones) {
  if (semitones === 0) return 'unison'
  const name = DEGREE_NAMES[Math.abs(semitones)] ?? 'interval'
  const dir = semitones > 0 ? 'up' : 'down'
  const sign = semitones > 0 ? '+' : ''
  return `${sign}${semitones} (${name} ${dir})`
}

function noteMidi(note) {
  if (Number.isFinite(note.midi)) return note.midi
  if (Number.isFinite(note.hz) && note.hz > 0) return hzToMidi(note.hz)
  return null
}

// Every note moved by `semitones`: new array, new objects, midi shifted and
// hz re-derived from the shifted midi. Notes with neither midi nor a positive
// hz pass through as a copy. Non-finite offsets count as 0.
export function shiftNotes(notes, semitones) {
  if (!Array.isArray(notes)) throw new Error('notes must be an array')
  const step = Number.isFinite(semitones) ? semitones : 0
  return notes.map((note) => {
    const base = noteMidi(note)
    if (base === null) return { ...note }
    const midi = base + step
    return { ...note, midi, hz: midiToHz(midi) }
  })
}

// One entry per preset interval, in preset order: { label, notes, gainDb,
// spreadMs }. The input notes are shared read-only; each entry gets its own
// shifted copies. Throws `unknown harmony preset`.
export function buildHarmonies(notes, presetName) {
  if (!Array.isArray(notes)) throw new Error('notes must be an array')
  const preset = presetByName(presetName)
  return preset.intervals.map((semitones) => ({
    label: labelFor(semitones),
    notes: shiftNotes(notes, semitones),
    gainDb: preset.gainDb,
    spreadMs: preset.spreadMs,
  }))
}

// Names in preset order, for dropdowns.
export function harmonyNames() {
  return HARMONY_PRESETS.map((p) => p.name)
}
