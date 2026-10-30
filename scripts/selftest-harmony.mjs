// scripts/selftest-harmony.mjs — self-test for js/harmony.js.
// Run from the project root:  node scripts/selftest-harmony.mjs
import { HARMONY_PRESETS, shiftNotes, buildHarmonies, harmonyNames } from '../js/harmony.js'
import { midiToHz, hzToMidi } from '../js/tune.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const notes = () => [
  { start: 0, dur: 0.4, hz: midiToHz(60), midi: 60, tag: 'a' },
  { start: 0.5, dur: 0.2, hz: midiToHz(67), midi: 67, tag: 'b' },
]

const names = () => HARMONY_PRESETS.map((p) => p.name)
const byName = (n) => HARMONY_PRESETS.find((p) => p.name === n)

test('exports exist and HARMONY_PRESETS is an array', () => {
  ok(Array.isArray(HARMONY_PRESETS))
  eq(typeof shiftNotes, 'function')
  eq(typeof buildHarmonies, 'function')
  eq(typeof harmonyNames, 'function')
})

test('at least four presets with unique string names', () => {
  ok(HARMONY_PRESETS.length >= 4, `need >= 4 presets, got ${HARMONY_PRESETS.length}`)
  const ns = names()
  ok(ns.every((n) => typeof n === 'string' && n.length > 0), 'names must be non-empty strings')
  eq(new Set(ns).size, ns.length, 'names must be unique')
})

test('the required stacks exist: thirds, fifths, octave-down, wide', () => {
  for (const n of ['thirds', 'fifths', 'octave-down', 'wide']) {
    ok(ns_has(n), `missing preset ${n}`)
  }
  ok(byName('thirds').intervals.includes(3), 'thirds must include a minor third')
  ok(byName('fifths').intervals.includes(7), 'fifths must include a fifth')
  ok(byName('octave-down').intervals.includes(-12), 'octave-down must drop an octave')
  ok(byName('wide').intervals.length >= 2, 'wide must be a stack')
})

function ns_has(n) {
  return names().includes(n)
}

test('every preset stays inside the contract bounds', () => {
  for (const p of HARMONY_PRESETS) {
    ok(Array.isArray(p.intervals) && p.intervals.length >= 1, `${p.name}: empty intervals`)
    ok(p.intervals.length <= 3, `${p.name}: more than 3 intervals`)
    for (const iv of p.intervals) {
      ok(Number.isInteger(iv), `${p.name}: non-integer interval ${iv}`)
      ok(iv >= -12 && iv <= 12, `${p.name}: interval ${iv} outside -12..12`)
    }
    ok(Number.isFinite(p.gainDb) && p.gainDb < 0, `${p.name}: gainDb must be negative`)
    ok(Number.isFinite(p.spreadMs) && p.spreadMs >= 0 && p.spreadMs <= 40, `${p.name}: spreadMs out of 0..40`)
  }
})

test('shiftNotes(+3): midi 60 -> 63 and hz is the exact new frequency', () => {
  const out = shiftNotes([{ start: 0, dur: 1, midi: 60, hz: midiToHz(60) }], 3)
  eq(out[0].midi, 63)
  eq(out[0].hz, midiToHz(63))
  near(out[0].hz, 311.126984, 1e-5, 'C4 up a minor third is E-flat 4')
  eq(midiToHz(63), out[0].hz, 'hz must come from midiToHz(midi) identically')
})

test('shiftNotes(-12) drops a full octave', () => {
  const out = shiftNotes([{ start: 0, dur: 1, midi: 60, hz: midiToHz(60) }], -12)
  eq(out[0].midi, 48)
  eq(out[0].hz, midiToHz(48))
  near(out[0].hz, midiToHz(60) / 2, 1e-9)
})

test('shiftNotes keeps fractional midi fractional', () => {
  const out = shiftNotes([{ start: 0, dur: 1, midi: 60.5, hz: midiToHz(60.5) }], 2)
  eq(out[0].midi, 62.5)
  eq(out[0].hz, midiToHz(62.5))
})

test('shiftNotes never mutates the input and returns new objects', () => {
  const input = notes()
  const before = JSON.stringify(input)
  const out = shiftNotes(input, 5)
  eq(JSON.stringify(input), before, 'input unchanged')
  ok(out !== input && out[0] !== input[0] && out[1] !== input[1], 'new array and objects')
  eq(out[0].tag, 'a', 'extra fields preserved')
  eq(out[0].start, 0)
  eq(out[0].dur, 0.4)
  eq(out[1].midi, 72)
})

test('shiftNotes derives midi from hz when midi is absent', () => {
  const out = shiftNotes([{ start: 0, dur: 1, hz: 220 }], 12)
  near(out[0].midi, hzToMidi(220) + 12, 1e-9, '57 + 12')
  eq(out[0].hz, 440)
})

test('shiftNotes passes through notes with neither midi nor hz', () => {
  const out = shiftNotes([{ start: 0.2, dur: 0.1, tag: 'x' }], 7)
  eq(out[0].tag, 'x')
  eq(out[0].start, 0.2)
  eq(out[0].midi, undefined)
  eq(out[0].hz, undefined)
})

test('shiftNotes returns [] for [] and treats a non-finite offset as 0', () => {
  eq(shiftNotes([], 3).length, 0)
  const out = shiftNotes([{ start: 0, dur: 1, midi: 60, hz: midiToHz(60) }], NaN)
  eq(out[0].midi, 60)
  eq(out[0].hz, midiToHz(60))
})

test('shiftNotes rejects a non-array', () => {
  throws(() => shiftNotes(null, 3))
  throws(() => shiftNotes('x', 3))
})

test('buildHarmonies fans exactly one entry per preset interval', () => {
  for (const p of HARMONY_PRESETS) {
    const voices = buildHarmonies(notes(), p.name)
    eq(voices.length, p.intervals.length, `${p.name}: one voice per interval`)
    voices.forEach((v, i) => {
      eq(v.notes[0].midi, 60 + p.intervals[i], `${p.name}[${i}]: semitone shift applied`)
      eq(v.notes[0].hz, midiToHz(60 + p.intervals[i]), 'hz follows the shift')
      eq(v.gainDb, p.gainDb)
      eq(v.spreadMs, p.spreadMs)
      ok(typeof v.label === 'string' && v.label.length > 0, 'label is a non-empty string')
    })
  }
})

test('buildHarmonies labels are distinct within a preset', () => {
  for (const p of HARMONY_PRESETS) {
    const labels = buildHarmonies(notes(), p.name).map((v) => v.label)
    eq(new Set(labels).size, labels.length, `${p.name}: duplicate labels`)
  }
})

test('buildHarmonies labels name the interval and direction', () => {
  const fifths = buildHarmonies(notes(), 'fifths')
  ok(/5/.test(fifths[0].label) && /perfect 5th/i.test(fifths[0].label), fifths[0].label)
  const down = buildHarmonies(notes(), 'octave-down')
  ok(/down/i.test(down[0].label) && /octave/i.test(down[0].label), down[0].label)
})

test('buildHarmonies does not mutate the input', () => {
  const input = notes()
  const before = JSON.stringify(input)
  for (const n of names()) buildHarmonies(input, n)
  eq(JSON.stringify(input), before, 'input untouched by every preset')
})

test('buildHarmonies throws `unknown harmony preset` on a bad name', () => {
  let err = null
  try {
    buildHarmonies(notes(), 'nope')
  } catch (e) {
    err = e
  }
  ok(err instanceof Error, 'must throw an Error')
  eq(err.message, 'unknown harmony preset')
  throws(() => buildHarmonies(notes(), undefined))
  throws(() => buildHarmonies(notes(), 'constructor'))
})

test('buildHarmonies with no notes still returns labelled empty lanes', () => {
  const voices = buildHarmonies([], 'wide')
  eq(voices.length, byName('wide').intervals.length)
  ok(voices.every((v) => Array.isArray(v.notes) && v.notes.length === 0))
})

test('harmonyNames mirrors the preset table', () => {
  eq(harmonyNames().join(','), names().join(','))
})

test('presets are frozen so callers cannot corrupt the table', () => {
  ok(Object.isFrozen(HARMONY_PRESETS))
  ok(Object.isFrozen(HARMONY_PRESETS[0].intervals))
})

report()
