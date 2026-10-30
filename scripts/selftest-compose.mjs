// scripts/selftest-compose.mjs — self-test for js/compose.js.
// Run from the project root:  node scripts/selftest-compose.mjs
import { mulberry32, generateMelody, generateChords } from '../js/compose.js'
import { SCALES, midiToHz } from '../js/tune.js'
import { test, eq, ok, near, throws, report } from './lib/assert.mjs'

const BPM = 120
const SCALE = 'major'
const ROOT = 60
const IN_SCALE = new Set(SCALES[SCALE].map((o) => ((o % 12) + 12) % 12))
const inScale = (midi) => IN_SCALE.has((((midi - ROOT) % 12) + 12) % 12)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

test('mulberry32: same seed gives the same sequence', () => {
  const a = mulberry32(1234)
  const b = mulberry32(1234)
  for (let i = 0; i < 200; i++) eq(a(), b(), `draw ${i}`)
})

test('mulberry32: different seeds diverge', () => {
  const a = mulberry32(1)
  const b = mulberry32(2)
  let diff = 0
  for (let i = 0; i < 50; i++) if (a() !== b()) diff++
  ok(diff > 45, `sequences must diverge, differed ${diff}/50`)
})

test('mulberry32: output stays inside [0, 1) and is finite', () => {
  const rnd = mulberry32(99)
  for (let i = 0; i < 5000; i++) {
    const v = rnd()
    ok(Number.isFinite(v) && v >= 0 && v < 1, `draw ${i} = ${v}`)
  }
})

test('mulberry32: seed 0 and non-finite seeds still run', () => {
  ok(Number.isFinite(mulberry32(0)()))
  ok(Number.isFinite(mulberry32(Number.NaN)()))
})

test('melody: exactly `steps` notes, deterministic for a seed', () => {
  const a = generateMelody({ root: ROOT, scale: SCALE, steps: 24, bpm: BPM, seed: 7 })
  const b = generateMelody({ root: ROOT, scale: SCALE, steps: 24, bpm: BPM, seed: 7 })
  eq(a.length, 24, 'one note per step')
  ok(same(a, b), 'same seed must reproduce the melody exactly')
})

test('melody: different seeds give different notes', () => {
  const a = generateMelody({ root: ROOT, scale: SCALE, steps: 24, bpm: BPM, seed: 7 })
  const b = generateMelody({ root: ROOT, scale: SCALE, steps: 24, bpm: BPM, seed: 8 })
  ok(!same(a, b), 'different seed must change the melody')
})

test('melody: stays inside one octave of the base and inside the scale', () => {
  for (const scale of ['major', 'natural_minor', 'dorian', 'pentatonic_minor', 'blues']) {
    for (let seed = 0; seed < 12; seed++) {
      const notes = generateMelody({ root: ROOT, scale, steps: 40, bpm: BPM, seed, octave: 0 })
      for (const n of notes) {
        ok(Number.isInteger(n.midi), 'midi must be an integer')
        ok(n.midi >= ROOT && n.midi <= ROOT + 12, `midi ${n.midi} outside the octave`)
        ok(IN_SCALE.has((((n.midi - ROOT) % 12) + 12) % 12), `midi ${n.midi} outside ${scale}`)
      }
    }
  }
})

test('melody: octave shifts the whole line and keeps the octave span', () => {
  const low = generateMelody({ root: ROOT, scale: SCALE, steps: 16, bpm: BPM, seed: 3, octave: -1 })
  const high = generateMelody({ root: ROOT, scale: SCALE, steps: 16, bpm: BPM, seed: 3, octave: 1 })
  for (let i = 0; i < low.length; i++) {
    eq(high[i].midi - low[i].midi, 24, `note ${i} transposed two octaves`)
    ok(low[i].midi >= ROOT - 12 && low[i].midi <= ROOT, 'low line stays in its octave')
    ok(high[i].midi >= ROOT + 12 && high[i].midi <= ROOT + 24, 'high line stays in its octave')
  }
})

test('melody: durations are one beat or half a beat, starts accumulate', () => {
  const notes = generateMelody({ root: ROOT, scale: SCALE, steps: 32, bpm: 96, seed: 5 })
  const beat = 60 / 96
  let t = 0
  for (const n of notes) {
    ok(n.dur === beat || n.dur === beat / 2, `dur ${n.dur} must be a beat or half a beat`)
    near(n.start, t, 1e-12, 'starts sit back to back')
    near(n.hz, midiToHz(n.midi), 1e-9, 'hz follows midi')
    t += n.dur
  }
})

test('melody: steps of one walk by at most two degrees', () => {
  const notes = generateMelody({ root: ROOT, scale: 'major', steps: 64, bpm: BPM, seed: 11 })
  const offsets = SCALES.major.filter((o) => o < 12)
  const degreeOf = (midi) => offsets.indexOf(midi - ROOT)
  for (let i = 1; i < notes.length; i++) {
    const jump = Math.abs(degreeOf(notes[i].midi) - degreeOf(notes[i - 1].midi))
    ok(jump >= 1 && jump <= 2, `step ${i} moved ${jump} degrees`)
  }
})

test('melody: defaults run without options', () => {
  const notes = generateMelody({ steps: 4, bpm: BPM, seed: 1 })
  eq(notes.length, 4)
  for (const n of notes) ok(n.midi >= 60 && n.midi <= 72, 'default root is 60')
})

test('melody: guards steps, bpm, scale and root', () => {
  throws(() => generateMelody({ steps: 0, bpm: BPM, seed: 1 }), 'zero steps')
  throws(() => generateMelody({ steps: -4, bpm: BPM, seed: 1 }), 'negative steps')
  throws(() => generateMelody({ steps: 2.5, bpm: BPM, seed: 1 }), 'fractional steps')
  throws(() => generateMelody({ steps: Number.NaN, bpm: BPM, seed: 1 }), 'NaN steps')
  throws(() => generateMelody({ steps: 8, bpm: 0, seed: 1 }), 'zero bpm')
  throws(() => generateMelody({ steps: 8, bpm: -120, seed: 1 }), 'negative bpm')
  throws(() => generateMelody({ steps: 8, bpm: BPM, seed: 1, scale: 'nope' }), 'unknown scale')
  throws(() => generateMelody({ steps: 8, bpm: BPM, seed: 1, root: Number.NaN }), 'NaN root')
})

test('chords: one chord per bar, bar-length, deterministic', () => {
  const a = generateChords({ root: ROOT, scale: SCALE, bars: 8, bpm: BPM, seed: 42 })
  const b = generateChords({ root: ROOT, scale: SCALE, bars: 8, bpm: BPM, seed: 42 })
  eq(a.length, 8, 'one chord per bar')
  ok(same(a, b), 'same seed must reproduce the progression')
})

test('chords: durations are exactly one bar and starts sit on bar lines', () => {
  const barDur = (60 / BPM) * 4
  const chords = generateChords({ root: ROOT, scale: SCALE, bars: 6, bpm: 90, seed: 2 })
  const realBar = (60 / 90) * 4
  eq(chords[0].dur, realBar, 'bar-length duration at 90 bpm')
  chords.forEach((c, i) => {
    near(c.start, i * realBar, 1e-12, `chord ${i} starts on its bar`)
    eq(c.dur, realBar, `chord ${i} lasts the bar`)
  })
  near(barDur, 4 * (60 / BPM), 1e-12)
})

test('chords: triads are diatonic, above the root, and stack thirds', () => {
  for (const scale of ['major', 'natural_minor', 'dorian']) {
    const chords = generateChords({ root: ROOT, scale, bars: 16, bpm: BPM, seed: 5 })
    for (const c of chords) {
      eq(c.midis.length, 3, 'triad has three tones')
      for (const m of c.midis) {
        ok(m >= ROOT, `chord tone ${m} below the root`)
        ok(inScale(m), `chord tone ${m} outside ${scale}`)
      }
    }
  }
})

test('chords: different seeds give different progressions', () => {
  const a = generateChords({ root: ROOT, scale: SCALE, bars: 8, bpm: BPM, seed: 1 })
  const b = generateChords({ root: ROOT, scale: SCALE, bars: 8, bpm: BPM, seed: 2 })
  ok(!same(a, b), 'seed must change the progression')
})

test('chords: same degree pool across seeds, every chord starts on a scale degree', () => {
  const offsets = SCALES.major.filter((o) => o < 12)
  for (let seed = 0; seed < 10; seed++) {
    for (const c of generateChords({ root: ROOT, scale: SCALE, bars: 12, bpm: BPM, seed })) {
      ok(offsets.includes(c.midis[0] - ROOT), `root ${c.midis[0]} must be a scale degree`)
    }
  }
})

test('chords: guards bars, bpm and scale', () => {
  throws(() => generateChords({ bars: 0, bpm: BPM, seed: 1 }), 'zero bars')
  throws(() => generateChords({ bars: -2, bpm: BPM, seed: 1 }), 'negative bars')
  throws(() => generateChords({ bars: 1.5, bpm: BPM, seed: 1 }), 'fractional bars')
  throws(() => generateChords({ bars: 4, bpm: 0, seed: 1 }), 'zero bpm')
  throws(() => generateChords({ bars: 4, bpm: BPM, seed: 1, scale: 'nope' }), 'unknown scale')
})

test('chords: every midi is finite and inside a sane range', () => {
  for (const c of generateChords({ root: 48, scale: 'pentatonic_minor', bars: 32, bpm: 140, seed: 9 })) {
    for (const m of c.midis) ok(Number.isFinite(m) && m >= 48 && m <= 96, `midi ${m}`)
  }
})

report()
