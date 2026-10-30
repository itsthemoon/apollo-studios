// scripts/selftest-tune.mjs — self-test for js/tune.js.
// Run from the project root:  node scripts/selftest-tune.mjs
import {
  hzToMidi,
  midiToHz,
  centsBetween,
  SCALES,
  scaleNames,
  nearestInScale,
  snapNotes,
  snapStrength,
  quantizeStarts,
  speedCurve,
} from '../js/tune.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

test('hz/midi round-trip near 69 (A4 = 440)', () => {
  near(hzToMidi(440), 69, 1e-9)
  eq(midiToHz(69), 440)
  near(midiToHz(hzToMidi(440)), 440, 1e-9)
})

test('hz/midi round-trip near 57 (A3 = 220)', () => {
  near(hzToMidi(220), 57, 1e-9)
  eq(midiToHz(57), 220)
  near(midiToHz(hzToMidi(220)), 220, 1e-9)
})

test('hz/midi round-trip for an arbitrary frequency', () => {
  near(midiToHz(hzToMidi(437)), 437, 1e-6)
  near(hzToMidi(midiToHz(60.5)), 60.5, 1e-9)
})

test('hzToMidi guards silence', () => {
  eq(hzToMidi(0), 0)
  eq(hzToMidi(-5), 0)
})

test('centsBetween(447, 69) ≈ 27', () => {
  near(centsBetween(447, 69), 27.3, 0.5)
})

test('centsBetween is signed and zero at the reference', () => {
  eq(centsBetween(midiToHz(69), 69), 0)
  ok(centsBetween(midiToHz(70), 69) > 0, 'sharp note must be positive')
  ok(centsBetween(midiToHz(68), 69) < 0, 'flat note must be negative')
})

test('SCALES has every required scale, valid offsets, spanning an octave', () => {
  const required = [
    'chromatic', 'major', 'natural_minor', 'harmonic_minor', 'dorian',
    'mixolydian', 'pentatonic_major', 'pentatonic_minor', 'blues',
  ]
  const names = scaleNames()
  ok(Array.isArray(names) && names.every((n) => typeof n === 'string'))
  for (const n of required) ok(names.includes(n), `missing scale ${n}`)
  for (const [n, offsets] of Object.entries(SCALES)) {
    eq(offsets[0], 0, `${n} must start at 0`)
    ok(offsets.every((o) => Number.isInteger(o) && o >= 0), `${n} offsets must be ints >= 0`)
    ok(offsets.includes(12), `${n} must span an octave`)
  }
})

test('SCALES keeps js/presets.js camelCase names available', () => {
  ok(SCALES.minor === SCALES.natural_minor, 'minor must alias natural_minor')
  ok(SCALES.harmonicMinor === SCALES.harmonic_minor)
  ok(SCALES.pentatonicMajor === SCALES.pentatonic_major)
  ok(SCALES.pentatonicMinor === SCALES.pentatonic_minor)
  for (const n of ['phrygian', 'lydian', 'locrian']) ok(n in SCALES, `missing ${n}`)
})

test('nearestInScale: 61 snaps to 60 in C major', () => {
  eq(nearestInScale(61, 60, 'major'), 60)
})

test('nearestInScale: 66 snaps to 67 in C major', () => {
  eq(nearestInScale(66, 60, 'major'), 67)
})

test('nearestInScale: in-scale notes stay put', () => {
  eq(nearestInScale(64, 60, 'major'), 64)
  eq(nearestInScale(60, 60, 'major'), 60)
  eq(nearestInScale(71, 60, 'major'), 71)
})

test('nearestInScale: negative midi and negative root', () => {
  eq(nearestInScale(-100, 0, 'chromatic'), -100)
  eq(nearestInScale(-5, -5, 'major'), -5, 'root itself stays')
  eq(nearestInScale(-4, -5, 'major'), -5, 'tie resolves toward the root')
})

test('nearestInScale: offsets are root-relative (D major, root 62)', () => {
  eq(nearestInScale(61, 62, 'major'), 61, '61 is the leading tone of D major')
  eq(nearestInScale(63, 62, 'major'), 62, 'C# pulls to the root D')
  eq(nearestInScale(66, 62, 'major'), 66, 'F# is diatonic in D major')
})

test('nearestInScale: pentatonic skips non-scale degrees', () => {
  eq(nearestInScale(65, 60, 'pentatonic_major'), 64, 'F is not in C pentatonic major')
  eq(nearestInScale(66, 60, 'pentatonic_major'), 67, 'F# lands on G, not F')
  const snapped = nearestInScale(63, 60, 'pentatonic_major')
  ok(snapped !== 63 && [62, 64].includes(snapped), 'D# must leave D#')
  eq(nearestInScale(61, 60, 'pentatonic_minor'), 60)
})

test('snapNotes: corrected integer midi, cents, snappedFrom, hz', () => {
  const out = snapNotes([{ start: 0.1, dur: 0.2, hz: midiToHz(61.4), midi: 61.4 }], { root: 60, scale: 'major' })
  eq(out[0].midi, 62, '61.4 is nearer D than C')
  ok(Number.isInteger(out[0].midi), 'midi must be integer')
  eq(out[0].snappedFrom, 61.4)
  near(out[0].cents, -60, 1e-6, 'original was 60 cents flat of the snapped midi')
  near(out[0].hz, midiToHz(62), 1e-9, 'hz follows corrected midi')
})

test('snapNotes: already in-scale note gets cents 0', () => {
  const out = snapNotes([{ start: 0, dur: 0.1, midi: 60.2, hz: midiToHz(60.2) }], { root: 60, scale: 'major' })
  eq(out[0].midi, 60)
  near(out[0].cents, 20, 1e-6)
})

test('snapNotes: does not mutate the input and returns new objects', () => {
  const input = [
    { start: 0.1, dur: 0.2, hz: midiToHz(61.4), midi: 61.4, tag: 'a' },
    { start: 0.4, dur: 0.3, hz: midiToHz(58.8), midi: 58.8, tag: 'b' },
  ]
  const before = JSON.stringify(input)
  const out = snapNotes(input, { root: 60, scale: 'major' })
  eq(JSON.stringify(input), before, 'input array and objects untouched')
  ok(out !== input && out[0] !== input[0] && out[1] !== input[1], 'new array, new objects')
  eq(out[0].tag, 'a', 'extra fields preserved')
  eq(out[1].midi, 59, '58.8 snaps to the leading tone 59')
})

test('snapStrength: amount 0 is identity', () => {
  const input = [{ start: 0, dur: 0.2, midi: 61.4, hz: midiToHz(61.4) }]
  const before = JSON.stringify(input)
  const out = snapStrength(input, { root: 60, scale: 'major', amount: 0 })
  eq(JSON.stringify(input), before, 'input untouched')
  eq(out[0].midi, 61.4, 'midi unchanged')
  eq(out[0].hz, midiToHz(61.4), 'hz unchanged')
  ok(out[0] !== input[0], 'still a new object')
})

test('snapStrength: 0.5 lands midway in cents', () => {
  const input = [{ start: 0, dur: 0.1, midi: 61, hz: midiToHz(61) }]
  const before = JSON.stringify(input)
  const out = snapStrength(input, { root: 60, scale: 'major', amount: 0.5 })
  eq(JSON.stringify(input), before, 'input untouched')
  near(out[0].midi, 60.5, 1e-9, 'fractional midi halfway')
  near(out[0].cents, 50, 1e-6)
  eq(out[0].snappedFrom, 61)
})

test('snapStrength: amount 1 fully snaps', () => {
  const out = snapStrength([{ start: 0, dur: 0.1, midi: 61, hz: midiToHz(61) }], { root: 60, scale: 'major', amount: 1 })
  eq(out[0].midi, 60)
  near(out[0].cents, 0, 1e-6)
})

test('quantizeStarts: 0.13 s lands on 0.125 s at 120 bpm / division 4', () => {
  const out = quantizeStarts([{ start: 0.13, dur: 0.2, midi: 60 }], { bpm: 120, division: 4 })
  near(out[0].start, 0.125, 1e-12)
  eq(out[0].dur, 0.2, 'durations kept')
})

test('quantizeStarts: clamps at 0, re-sorts, does not mutate', () => {
  const input = [
    { start: 0.13, dur: 0.2, midi: 60, tag: 'a' },
    { start: 0.03, dur: 0.4, midi: 62, tag: 'b' },
    { start: -0.05, dur: 0.1, midi: 64, tag: 'c' },
  ]
  const before = JSON.stringify(input)
  const out = quantizeStarts(input, { bpm: 120, division: 4 })
  eq(JSON.stringify(input), before, 'input untouched')
  eq(out[0].tag, 'b', 'sorted by start')
  near(out[0].start, 0, 1e-12)
  eq(out[1].tag, 'c')
  near(out[1].start, 0, 1e-12, 'negative start clamps to 0')
  eq(out[2].tag, 'a')
  near(out[2].start, 0.125, 1e-12)
})

test('quantizeStarts: guards zero/negative bpm and division', () => {
  throws(() => quantizeStarts([], { bpm: 0, division: 4 }), 'bpm 0 must throw')
  throws(() => quantizeStarts([], { bpm: -120, division: 4 }), 'negative bpm must throw')
  throws(() => quantizeStarts([], { bpm: 120, division: 0 }), 'division 0 must throw')
  throws(() => quantizeStarts([], { bpm: 120, division: -4 }), 'negative division must throw')
})

test('speedCurve: length matches request, all 1.0 for empty notes', () => {
  const curve = speedCurve([], 44100, 1000)
  eq(curve.length, 1000)
  ok(curve instanceof Float32Array)
  eq(curve.every((v) => v === 1.0), true)
})

test('speedCurve: flat note snapped up exceeds 1.0, gaps stay 1.0', () => {
  // Sung 59.6 (flat), snapped to 60: multiplier 2 ** (0.4 / 12) ≈ 1.0234
  const sr = 44100
  const curve = speedCurve([{ start: 0, dur: 0.1, midi: 60, snappedFrom: 59.6 }], sr, 8000)
  eq(curve.length, 8000)
  near(curve[2205], Math.pow(2, 0.4 / 12), 1e-6, 'mid-note multiplier is the snap ratio')
  ok(curve[2205] > 1.0, 'flat note corrected up must exceed 1.0')
  eq(curve[0], Math.fround(Math.pow(2, 0.4 / 12)), 'note onset is fully corrected')
  eq(curve[7000], 1.0, 'gap after the note stays exactly 1.0')
  near(curve[4409], 1.0, 1e-3, 'tail eases back to 1.0')
})

test('speedCurve: sharp note snapped down is below 1.0', () => {
  const curve = speedCurve([{ start: 0, dur: 0.1, midi: 60, snappedFrom: 60.4 }], 44100, 8000)
  near(curve[2205], Math.pow(2, -0.4 / 12), 1e-6)
  ok(curve[2205] < 1.0)
})

test('speedCurve: note without snappedFrom is not corrected', () => {
  const curve = speedCurve([{ start: 0, dur: 0.05, midi: 60 }], 44100, 1000)
  eq(curve.every((v) => v === 1.0), true)
})

test('speedCurve: guards bad sample rate and clamps length', () => {
  throws(() => speedCurve([], 0, 10), 'sampleRate 0 must throw')
  eq(speedCurve([], 44100, -5).length, 0, 'negative length clamps to 0')
})

test('end-to-end: snapNotes feeds speedCurve', () => {
  const snapped = snapNotes([{ start: 0, dur: 0.1, midi: 59.6, hz: midiToHz(59.6) }], { root: 60, scale: 'major' })
  eq(snapped[0].midi, 60)
  near(snapped[0].cents, -40, 1e-6, 'sung flat, so cents is negative')
  near(snapped[0].snappedFrom, 59.6, 1e-12)
  const curve = speedCurve(snapped, 44100, 4410)
  eq(curve.length, 4410)
  near(curve[2205], Math.pow(2, 0.4 / 12), 1e-6)
})

report()
