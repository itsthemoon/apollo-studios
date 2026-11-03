#!/usr/bin/env node
// Self-test for js/autopitch.js (AutoPitch panel model).
// Run from the project root:  node scripts/selftest-autopitch.mjs

import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const a = await import('../js/autopitch.js')
const {
  PRESETS,
  TONIC_GRID,
  SCALES,
  SCALE_NAMES,
  CATEGORIES,
  presetsFor,
  presetBySlug,
  isMembership,
  createState,
  clampState,
  setPreset,
  setStrength,
  setScale,
  setTonic,
  setAutoDetect,
  setAdvanced,
  detectKey,
  applyToNotes,
  liveShift,
  setEnabled,
  setCategory,
  setAlgorithm,
  setHarmonyMix,
  setProjectKey,
} = a

const ESSENTIALS = ['classic', 'duet', 'big-harmony', 'natural', 'third', 'chip']
const BANDS = ['low', 'mid', 'high']

const on = (o = {}) => createState({ enabled: true, ...o })
const note = (midi) => ({ start: 0, dur: 1, hz: 440 * 2 ** ((midi - 69) / 12), midi })

// ---- PRESETS ---------------------------------------------------------------

test('PRESETS carries every category, six tiles each, in product order', () => {
  eq(CATEGORIES.map((c) => c.slug).join(','), 'essentials,hip-hop,hyperpop,sci-fi,custom')
  eq(presetsFor('essentials').map((p) => p.slug).join(','), ESSENTIALS.join(','))
  eq(presetsFor('hip-hop').map((p) => p.name).join(','), 'Modern Rap,Stone,Yummy,Play Card,Ocean,Telephone')
  eq(presetsFor('hyperpop').map((p) => p.name).join(','), 'Simulacrum,Ultrashift,Hyper,Bitz,Amped,AppleX')
  eq(presetsFor('sci-fi').map((p) => p.name).join(','), 'Robot,Futurescape,Krafty,Gorgon,Halo,Drone')
  eq(presetsFor('custom').length, 6)
  eq(PRESETS.length, 30)
  for (const category of CATEGORIES) {
    ok(presetsFor(category.slug).filter((p) => p.tier === 'free').length >= 2, `${category.slug} has a free tier`)
  }
})

test('every preset is complete, frozen and in bounds', () => {
  ok(Object.isFrozen(PRESETS), 'list frozen')
  for (const preset of PRESETS) {
    ok(Object.isFrozen(preset), `${preset.slug} frozen`)
    ok(typeof preset.name === 'string' && preset.name.length > 1, `${preset.slug} has a name`)
    ok(preset.tier === 'free' || preset.tier === 'membership', `${preset.slug} tier valid`)
    eq(typeof preset.duet, 'boolean', `${preset.slug} duet is boolean`)
    ok(Number.isInteger(preset.harmonySemitones) && Math.abs(preset.harmonySemitones) <= 12, `${preset.slug} harmony in ±12`)
    ok(Number.isFinite(preset.correctionBias) && preset.correctionBias > 0.3 && preset.correctionBias <= 1.5, `${preset.slug} bias sane`)
  }
})

test('only the duet preset sets duet, only harmony presets shift', () => {
  eq(PRESETS.filter((p) => p.duet).map((p) => p.slug).join(','), 'duet')
  eq(PRESETS.filter((p) => p.harmonySemitones !== 0).map((p) => p.slug).join(','), 'big-harmony,third,chip')
  eq(presetBySlug('third').harmonySemitones, 4, 'third is a major third up')
  eq(presetBySlug('chip').harmonySemitones, 12, 'chip doubles an octave up')
})

test('correction bias ordering inside Essentials: Natural loosest, Chip hardest', () => {
  const biases = presetsFor('essentials').map((p) => p.correctionBias)
  eq(Math.min(...biases), presetBySlug('natural').correctionBias)
  eq(Math.max(...biases), presetBySlug('chip').correctionBias)
  ok(presetBySlug('natural').correctionBias < presetBySlug('classic').correctionBias, 'natural looser than classic')
  ok(presetBySlug('chip').correctionBias > presetBySlug('classic').correctionBias, 'chip harder than classic')
})

test('presetBySlug and isMembership behave', () => {
  eq(presetBySlug('classic').name, 'Classic')
  eq(presetBySlug('zzz'), null)
  eq(isMembership('third'), true)
  eq(isMembership('duet'), false)
  eq(isMembership('nope'), false)
})

// ---- TONIC_GRID ------------------------------------------------------------

test('TONIC_GRID is twelve buttons, C first, C# second', () => {
  eq(TONIC_GRID.length, 12)
  ok(Object.isFrozen(TONIC_GRID), 'frozen')
  eq(TONIC_GRID[0].name, 'C')
  eq(TONIC_GRID[0].pitchClass, 0)
  eq(TONIC_GRID[1].name, 'C\u266F D\u266D')
  eq(TONIC_GRID[1].pitchClass, 1)
  eq(TONIC_GRID[11].name, 'B')
  eq(TONIC_GRID[11].pitchClass, 11)
})

test('TONIC_GRID order is index === pitchClass with unique names', () => {
  const names = new Set()
  TONIC_GRID.forEach((entry, i) => {
    eq(entry.pitchClass, i, `${entry.name} pitch class`)
    ok(!names.has(entry.name), `${entry.name} unique`)
    names.add(entry.name)
    ok(Object.isFrozen(entry), `${entry.name} frozen`)
  })
  eq(names.size, 12)
})

// ---- SCALES ----------------------------------------------------------------

test('SCALES exposes exactly the six product options', () => {
  eq(SCALE_NAMES.join(','), 'chromatic,major,minor,majorPentatonic,minorPentatonic,project')
  eq(Object.keys(SCALES).join(','), SCALE_NAMES.join(','))
  ok(Object.isFrozen(SCALES), 'frozen')
})

test('SCALES start at the tonic and stay inside the octave', () => {
  for (const name of SCALE_NAMES) {
    const offsets = SCALES[name]
    ok(Object.isFrozen(offsets), `${name} frozen`)
    eq(offsets[0], 0, `${name} starts on the tonic`)
    for (const offset of offsets) {
      ok(offset >= 0 && offset < 12, `${name} offset ${offset} in octave`)
    }
    const unique = new Set(offsets)
    eq(unique.size, offsets.length, `${name} has no duplicate degrees`)
  }
})

test('scale contents are musically correct', () => {
  eq(SCALES.chromatic.length, 12)
  eq(SCALES.major.join(','), '0,2,4,5,7,9,11')
  eq(SCALES.minor.join(','), '0,2,3,5,7,8,10')
  eq(SCALES.majorPentatonic.join(','), '0,2,4,7,9')
  eq(SCALES.minorPentatonic.join(','), '0,3,5,7,10')
  eq(SCALES.project.length, 12, 'project key defers to the project scale')
  ok(!SCALES.major.includes(3), 'major has a major third')
  ok(SCALES.minor.includes(3), 'minor has a minor third')
})

// ---- createState -----------------------------------------------------------

test('createState defaults', () => {
  const s = createState()
  eq(s.preset, 'classic')
  eq(s.strength, 1)
  eq(s.scale, 'chromatic')
  eq(s.tonic, 0)
  eq(s.autoDetect, true)
  eq(s.enabled, true, "on as soon as the panel opens on a take")
  eq(s.algorithm, 'original')
  eq(s.harmonyMix, 1)
  eq(s.category, 'essentials')
  eq(s.formant, 0)
  eq(s.humanise, 0.5)
})

test('createState clamps overrides', () => {
  const s = on({ preset: 'chip', strength: 4, formant: 40, humanise: -2, tonic: 15 })
  eq(s.preset, 'chip')
  eq(s.strength, 1)
  eq(s.formant, 12)
  eq(s.humanise, 0)
  eq(s.tonic, 3, '15 wraps to 3')
})

test('createState falls back on unknown preset, scale and null', () => {
  eq(on({ preset: 'x' }).preset, 'classic')
  eq(on({ scale: 'lydian' }).scale, 'chromatic')
  eq(createState(null).preset, 'classic')
})

test('createState never shares objects', () => {
  const x = createState()
  const y = createState()
  x.strength = 1
  eq(y.strength, 1)
  ok(x !== y)
})

// ---- setters ---------------------------------------------------------------

test('setPreset switches and rejects unknown slugs', () => {
  eq(setPreset(createState(), 'natural').preset, 'natural')
  throws(() => setPreset(createState(), 'autotune'), 'unknown preset throws')
})

test('setStrength clamps 0..1 and swallows non-finite', () => {
  eq(setStrength(createState(), 0.25).strength, 0.25)
  eq(setStrength(createState(), 3).strength, 1)
  eq(setStrength(createState(), -3).strength, 0)
  eq(setStrength(createState(), NaN).strength, 0)
})

test('setScale accepts known scales and rejects unknown and inherited keys', () => {
  for (const name of SCALE_NAMES) eq(setScale(createState(), name).scale, name)
  throws(() => setScale(createState(), 'blues'), 'unknown scale throws')
  throws(() => setScale(createState(), 'Major'), 'case matters')
  throws(() => setScale(createState(), 'toString'), 'inherited Object key throws')
  throws(() => setScale(createState(), '__proto__'), '__proto__ throws')
})

test('clampState drops inherited scale names', () => {
  eq(clampState({ scale: 'toString' }).scale, 'chromatic')
  eq(clampState({ scale: '__proto__' }).scale, 'chromatic')
  eq(applyToNotes([note(61)], on({ scale: 'toString', strength: 1 }))[0].midi, 61)
})

test('setTonic wraps into 0..11 and rejects non-integers', () => {
  eq(setTonic(createState(), 3).tonic, 3)
  eq(setTonic(createState(), 12).tonic, 0)
  eq(setTonic(createState(), -1).tonic, 11)
  eq(setTonic(createState(), 25).tonic, 1)
  throws(() => setTonic(createState(), 4.5), 'fractional throws')
  throws(() => setTonic(createState(), NaN), 'NaN throws')
})

test('setAutoDetect coerces', () => {
  eq(setAutoDetect(createState(), false).autoDetect, false)
  eq(setAutoDetect(createState(), 1).autoDetect, true)
})

test('setAdvanced merges only the keys given and clamps', () => {
  const s = setAdvanced(createState(), { formant: -5 })
  eq(s.formant, -5)
  eq(s.humanise, 0.5, 'humanise untouched')
  eq(setAdvanced(createState(), { humanise: 9 }).humanise, 1)
  eq(setAdvanced(createState(), { formant: 99 }).formant, 12)
  eq(setAdvanced(createState(), {}).formant, 0, 'empty merge is a no-op')
  eq(setAdvanced(createState(), null).humanise, 0.5, 'null merge is a no-op')
})

test('setters write through, and still return the new state', () => {
  // the panels hold one long-lived state and only some call sites reassign, so
  // a pure copy here leaves every control silently inert
  const s = on({ preset: 'third', strength: 0.4 })
  eq(setPreset(s, 'chip'), s)
  setStrength(s, 0.9)
  setScale(s, 'major')
  setTonic(s, 7)
  eq(s.preset, 'chip')
  eq(s.strength, 0.9)
  eq(s.scale, 'major')
  eq(s.tonic, 7)
})

// ---- detectKey -------------------------------------------------------------

test('detectKey: empty and non-finite input', () => {
  eq(detectKey([]).confidence, 0)
  eq(detectKey([]).scale, 'chromatic')
  eq(detectKey([NaN, Infinity, -Infinity]).confidence, 0)
  eq(detectKey([NaN, Infinity]).tonic, 0)
  throws(() => detectKey('nope'), 'non-array throws')
})

test('detectKey finds C major from a C major scale run', () => {
  const r = detectKey([60, 62, 64, 65, 67, 69, 71, 72])
  eq(r.tonic, 0, 'C')
  eq(r.scale, 'major')
  ok(r.confidence > 0.8, `confident, got ${r.confidence}`)
})

test('detectKey finds G major from a G major run', () => {
  const r = detectKey([55, 57, 59, 60, 62, 64, 66, 67])
  eq(r.tonic, 7, 'G')
  eq(r.scale, 'major')
})

test('detectKey finds A minor from an A minor run', () => {
  const r = detectKey([57, 59, 60, 62, 64, 65, 67, 69])
  eq(r.tonic, 9, 'A')
  eq(r.scale, 'minor')
  ok(r.confidence > 0.8, `confident, got ${r.confidence}`)
})

test('detectKey stays on a known scale for a dorian run', () => {
  const r = detectKey([62, 64, 65, 67, 69, 71, 72, 74])
  ok(SCALE_NAMES.includes(r.scale), `known scale, got ${r.scale}`)
  ok(r.confidence >= 0 && r.confidence <= 1)
})

test('detectKey prefers a pentatonic scale for pentatonic material', () => {
  const r = detectKey([60, 62, 64, 67, 69, 72, 74, 76])
  eq(r.tonic, 0)
  ok(['majorPentatonic', 'minorPentatonic'].includes(r.scale), `pentatonic, got ${r.scale}`)
})

test('detectKey finds F# major from an F# major run', () => {
  const r = detectKey([54, 56, 58, 59, 61, 63, 65, 66])
  eq(r.tonic, 6, 'F#')
  eq(r.scale, 'major')
  ok(r.confidence > 0.8, `confident, got ${r.confidence}`)
})

test('detectKey on a bare triad stays on the right tonic', () => {
  const r = detectKey([66, 70, 73])
  eq(r.tonic, 6, 'F#')
  ok(['major', 'majorPentatonic', 'minor'].includes(r.scale), `a triad is ambiguous, got ${r.scale}`)
  ok(r.confidence > 0.4, `triad carries some weight, got ${r.confidence}`)
})

test('detectKey confidence is bounded and rises with more notes', () => {
  const one = detectKey([60])
  const five = detectKey([60, 62, 64, 67, 69, 72, 74, 76])
  ok(one.confidence >= 0 && one.confidence <= 1, 'single bounded')
  ok(five.confidence >= 0 && five.confidence <= 1, 'run bounded')
  ok(one.confidence < 1, `one note is a guess, got ${one.confidence}`)
  ok(five.confidence > one.confidence, 'more notes, more confidence')
})

test('detectKey is deterministic regardless of octave', () => {
  const low = detectKey([48, 50, 52, 53, 55, 57, 59, 60])
  const high = detectKey([84, 86, 88, 89, 91, 93, 95, 96])
  eq(low.tonic, high.tonic)
  eq(low.scale, high.scale)
  eq(low.confidence, high.confidence)
})

test('detectKey output is always a known scale and tonic', () => {
  const cases = [[60], [61, 63], [66, 68, 70], [59, 60, 61, 62], [72, 71, 70, 69, 68]]
  for (const notes of cases) {
    const r = detectKey(notes)
    ok(Object.hasOwn(SCALES, r.scale), `scale ${r.scale} known`)
    ok(Number.isInteger(r.tonic) && r.tonic >= 0 && r.tonic <= 11, `tonic ${r.tonic} in range`)
  }
})

// ---- applyToNotes ----------------------------------------------------------

test('applyToNotes at strength 0 leaves the pitch exactly alone', () => {
  const out = applyToNotes([note(60.4)], on({ strength: 0, scale: 'major' }))
  eq(out[0].midi, 60.4)
  eq(out[0].snappedFrom, 60.4)
  eq(out[0].cents, 40, '40 cents sharp of C')
})

test('applyToNotes reports the transposition playback needs', () => {
  const out = applyToNotes([note(60.4)], on({ strength: 1, scale: 'major' }))
  near(out[0].shift, -0.4, 1e-6, 'a 40 cent sharp note is pulled down 0.4 semitones')
  const none = applyToNotes([note(60.4)], on({ strength: 0, scale: 'major' }))
  near(none[0].shift, 0, 1e-6, 'strength 0 shifts nothing')
})

test('liveShift matches what applyToNotes would bake', () => {
  const st = on({ strength: 1, scale: 'major' })
  const n = note(60.4)
  near(liveShift(n, st), applyToNotes([n], st)[0].shift, 1e-9)
  near(liveShift(n, on({ strength: 0 })), 0, 1e-9, 'silent when strength is 0')
  near(liveShift(null, st), 0, 1e-9, 'no note, no shift')
})

test('applyToNotes at strength 1 snaps to the scale', () => {
  const out = applyToNotes([note(60.4), note(61.2)], on({ strength: 1, scale: 'major' }))
  eq(out[0].midi, 60)
  eq(out[1].midi, 62, '61.2 is nearer D than C')
  eq(out[0].cents, 0)
})

test('applyToNotes at half strength blends halfway', () => {
  const out = applyToNotes([note(60.4)], on({ strength: 0.5, scale: 'major' }))
  near(out[0].midi, 60.2, 1e-9, 'halfway to C')
  near(out[0].cents, 20, 1e-9, 'half of the 40 cents')
})

test('applyToNotes honours the preset correction bias', () => {
  const hard = applyToNotes([note(60.4)], on({ preset: 'chip', strength: 0.5, scale: 'major' }))
  const soft = applyToNotes([note(60.4)], on({ preset: 'natural', strength: 0.5, scale: 'major' }))
  near(hard[0].midi, 60.4 + Math.min(1, 0.5 * 1.15) * -0.4 - 0.4 * 0, 1e-9, 'chip overshoots the dial')
  near(soft[0].midi, 60.29, 1e-9, 'natural undershoots it')
})

test('applyToNotes derives hz from the tuned midi', () => {
  const out = applyToNotes([note(61.2)], on({ strength: 1, scale: 'major' }))
  near(out[0].hz, 440 * 2 ** ((out[0].midi - 69) / 12), 1e-9)
  near(out[0].hz, 440 * 2 ** ((62 - 69) / 12), 1e-9, 'D4')
})

test('applyToNotes rounds cents to six decimals like js/tune.js', () => {
  const out = applyToNotes([note(60 + 1 / 3)], on({ strength: 1, scale: 'major' }))
  const cents = out[0].cents
  eq(Math.round(cents * 1e6) / 1e6, cents, 'no more than six decimals')
  ok(Math.abs(cents * 1e6 - Math.round(cents * 1e6)) < 1e-6)
})

test('applyToNotes adds a harmony voice only for harmony presets', () => {
  const withHarmony = applyToNotes([note(60)], on({ preset: 'third', strength: 1, scale: 'major', algorithm: 'harmony' }))
  eq(withHarmony[0].harmonyMidi, 64, 'third up from the tuned note')
  near(withHarmony[0].harmonyHz, 440 * 2 ** ((64 - 69) / 12), 1e-9)
  const octave = applyToNotes([note(60)], on({ preset: 'chip', strength: 1, algorithm: 'harmony' }))
  eq(octave[0].harmonyMidi, 72)
  const plain = applyToNotes([note(60)], on({ preset: 'classic', strength: 1 }))
  ok(!Object.hasOwn(plain[0], 'harmonyMidi'), 'classic adds no voice')
  const original = applyToNotes([note(60)], on({ preset: 'third', strength: 1, algorithm: 'original' }))
  ok(!Object.hasOwn(original[0], 'harmonyMidi'), 'algorithm Original keeps one voice')
  const muted = applyToNotes([note(60)], on({ preset: 'third', strength: 1, algorithm: 'harmony', harmonyMix: 0 }))
  ok(!Object.hasOwn(muted[0], 'harmonyMidi'), 'mix at 0 silences the voice')
})

test('duet keeps the pitch close while staying under full correction', () => {
  const out = applyToNotes([note(62.3)], on({ preset: 'duet', strength: 1, scale: 'major' }))
  near(out[0].midi, 62.045, 1e-9, 'bias 0.85 of the way to D')
  ok(!Object.hasOwn(out[0], 'harmonyMidi'))
})

test('applyToNotes returns new objects and keeps unrelated fields', () => {
  const input = [{ start: 1, dur: 0.25, midi: 64, velocity: 100 }]
  const out = applyToNotes(input, on({ strength: 1 }))
  ok(out[0] !== input[0], 'new object')
  eq(out[0].start, 1)
  eq(out[0].velocity, 100)
  eq(input[0].midi, 64, 'input untouched')
  ok(!Object.hasOwn(input[0], 'snappedFrom'))
})

test('applyToNotes passes through notes without pitch', () => {
  const out = applyToNotes([{ start: 0, dur: 1 }, { start: 1, dur: 1, midi: NaN }], on({ strength: 1 }))
  eq(out[0].midi, undefined)
  ok(Number.isNaN(out[1].midi), 'NaN midi stays NaN')
  ok(out[0] !== undefined && out[1] !== undefined, 'still returns entries')
})

test('applyToNotes reads hz when midi is absent', () => {
  const out = applyToNotes([{ start: 0, dur: 1, hz: 440 }], on({ strength: 1, scale: 'major' }))
  eq(out[0].midi, 69, 'A4 lands on A4')
  eq(out[0].snappedFrom, 69)
})

test('applyToNotes rejects non-arrays and tolerates empty lists', () => {
  throws(() => applyToNotes(null, createState()), 'null throws')
  throws(() => applyToNotes(undefined, createState()), 'undefined throws')
  eq(applyToNotes([], createState()).length, 0)
})

test('applyToNotes with a missing state still works', () => {
  const out = applyToNotes([note(61)], undefined)
  eq(out.length, 1)
  eq(out[0].midi, 61, 'chromatic at default strength is a no-op')
})

test('applyToNotes uses the state tonic', () => {
  const sharp = applyToNotes([note(60.2)], on({ strength: 1, scale: 'major', tonic: 7 }))
  const flat = applyToNotes([note(60.2)], on({ strength: 1, scale: 'major', tonic: 0 }))
  eq(flat[0].midi, 60)
  eq(sharp[0].midi, 60, 'G major also has C')
  const off = applyToNotes([note(61.4)], on({ strength: 1, scale: 'major', tonic: 2 }))
  eq(off[0].midi, 61, 'D major pulls 61.4 down to C#, 0.4 away')
  const other = applyToNotes([note(62.4)], on({ strength: 1, scale: 'major', tonic: 0 }))
  eq(other[0].midi, 62, 'C major lifts 62.4 to D, 0.4 away')
})

// ---- clampState ------------------------------------------------------------

test('clampState is idempotent and fresh', () => {
  const once = clampState({ preset: 'chip', strength: 0.7, tonic: 4, formant: -3 })
  eq(JSON.stringify(clampState(once)), JSON.stringify(once))
  ok(clampState(once) !== once, 'new object')
})

test('clampState never throws on junk', () => {
  for (const input of [undefined, null, {}, { strength: 'x' }, { tonic: 'C' }]) {
    let threw = false
    try {
      clampState(input)
    } catch {
      threw = true
    }
    ok(!threw, `clampState(${JSON.stringify(input)})`)
  }
})

test('every state field stays in bounds through clampState', () => {
  const s = clampState({ strength: 9, tonic: 99, formant: 99, humanise: 9 })
  ok(s.strength <= 1 && s.strength >= 0, 'strength')
  ok(s.tonic >= 0 && s.tonic <= 11, 'tonic')
  ok(s.formant >= -12 && s.formant <= 12, 'formant')
  ok(s.humanise >= 0 && s.humanise <= 1, 'humanise')
  eq(BANDS.length, 3) // keep the band vocabulary visible
})

report()
