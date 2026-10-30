// js/compose.js — seeded melody and chord generation for apollo-studios.
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and in the
// browser. See js/contract-appendix.md.
//
// Everything is driven by an explicit seed: the same arguments always produce the same
// notes, so a take can be regenerated exactly. Melodies walk the scale by one or two
// degrees at a time and never leave the octave they start in; chords are plain
// scale-degree triads, one per bar.

import { SCALES, midiToHz } from './tune.js'

// ---- PRNG ---------------------------------------------------------------------

// mulberry32: 32-bit state, returns floats in [0, 1), reproducible from the seed.
export function mulberry32(seed) {
  let a = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- shared guards ------------------------------------------------------------

const DEGREES_PER_OCTAVE = 12

function oneOctave(scale) {
  const offsets = SCALES[scale]
  if (!offsets) throw new Error('unknown scale')
  const oct = offsets.filter((o) => o >= 0 && o < DEGREES_PER_OCTAVE)
  if (oct.length < 3) throw new Error('scale too small')
  return oct
}

function guardPositiveInteger(value, label) {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) throw new Error(`bad ${label}`)
  return value
}

function guardBpm(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('bad bpm')
  return bpm
}

function guardRoot(value, label) {
  if (!Number.isFinite(value)) throw new Error(`bad ${label}`)
  return Math.round(value)
}

// ---- melody -------------------------------------------------------------------

// Seeded walk over the scale across exactly `steps` notes. Each move is one or two
// degrees up or down; edges bounce instead of wrapping, so pitch always stays within
// one octave of root + octave * 12. Durations are one beat or half a beat.
export function generateMelody(opts = {}) {
  const root = guardRoot(opts.root ?? 60, 'root')
  const octave = guardRoot(opts.octave ?? 0, 'octave')
  const steps = guardPositiveInteger(opts.steps, 'steps')
  const bpm = guardBpm(opts.bpm)
  const scale = opts.scale ?? 'major'
  const oct = oneOctave(scale)
  const base = root + octave * DEGREES_PER_OCTAVE
  const beat = 60 / bpm
  const rnd = mulberry32(opts.seed)

  const notes = []
  let index = 0
  let t = 0
  for (let i = 0; i < steps; i++) {
    if (i > 0) {
      const dir = rnd() < 0.5 ? -1 : 1
      const mag = rnd() < 0.5 ? 1 : 2
      const prev = index
      index += dir * mag
      const last = oct.length - 1
      if (index < 0) index = -index
      if (index > last) index = 2 * last - index
      index = Math.min(last, Math.max(0, index))
      // A bounce off either edge can reflect straight back onto the same degree;
      // nudge one degree away so every move really is one or two steps.
      if (index === prev) {
        const alt = prev + dir
        index = alt >= 0 && alt <= last ? alt : prev - dir
      }
    }
    const dur = rnd() < 0.5 ? beat / 2 : beat
    const midi = base + oct[index]
    notes.push({ start: t, dur, hz: midiToHz(midi), midi })
    t += dur
  }
  return notes
}

// ---- chords -------------------------------------------------------------------

// One scale-degree triad per bar, each lasting the whole bar. Triads stack degrees
// 1-3-5 from the chosen degree, so every chord tone is diatonic. Inverse stacks stay
// inside the scale by carrying extra octaves.
export function generateChords(opts = {}) {
  const root = guardRoot(opts.root ?? 60, 'root')
  const bars = guardPositiveInteger(opts.bars, 'bars')
  const bpm = guardBpm(opts.bpm)
  const scale = opts.scale ?? 'major'
  const oct = oneOctave(scale)
  const rnd = mulberry32(opts.seed)

  // Three stacked octaves: a triad from any degree index is always in range.
  const ladder = [...oct, ...oct.map((o) => o + 12), ...oct.map((o) => o + 24)]
  const barDur = (60 / bpm) * 4

  const chords = []
  for (let bar = 0; bar < bars; bar++) {
    const degree = Math.floor(rnd() * oct.length) % oct.length
    const midis = [0, 2, 4].map((step) => root + ladder[degree + step])
    chords.push({ start: bar * barDur, dur: barDur, midis })
  }
  return chords
}

// ---- notes -> flat events ------------------------------------------------------

// Convenience for playback wiring: chord event -> one note object per chord tone.
export function chordNotes(chords) {
  const out = []
  for (const chord of chords) {
    for (const midi of chord.midis) {
      out.push({ start: chord.start, dur: chord.dur, midi, hz: midiToHz(midi) })
    }
  }
  return out
}
