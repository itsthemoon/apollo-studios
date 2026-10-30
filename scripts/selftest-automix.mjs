// scripts/selftest-automix.mjs — self-test for js/automix.js.
// Run from the project root:  node scripts/selftest-automix.mjs
import {
  suggestFromGenre,
  balance,
  INSTRUMENTS,
  renderNote,
} from '../js/automix.js'
import { masterChain, analyze } from '../js/master.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const SR = 44100
const KINDS = new Set(['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass'])
const WAVES = new Set(['saw', 'sine', 'square'])

const GENRE_NAMES = ['ambient', 'lofi', 'boom bap', 'drill', 'trap', 'acoustic', 'house', 'pop', 'edm']

function peak(buf) {
  let p = 0
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i])
    if (a > p) p = a
  }
  return p
}

function allFinite(buf) {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) return false
  return true
}

function stereo(n) {
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    left[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR)
    right[i] = 0.25 * Math.sin((2 * Math.PI * 330 * i) / SR)
  }
  return { left, right }
}

test('instrument bank is usable', () => {
  ok(INSTRUMENTS.length >= 4, `expected >= 4 instruments, got ${INSTRUMENTS.length}`)
  const names = new Set()
  const waves = new Set()
  for (const instrument of INSTRUMENTS) {
    ok(typeof instrument.name === 'string' && instrument.name.length > 0, 'instrument needs a name')
    ok(!names.has(instrument.name), `duplicate instrument ${instrument.name}`)
    names.add(instrument.name)
    ok(WAVES.has(instrument.wave), `bad wave ${instrument.wave}`)
    waves.add(instrument.wave)
    ok(Number.isFinite(instrument.attack) && instrument.attack > 0, `${instrument.name} attack`)
    ok(Number.isFinite(instrument.release) && instrument.release > 0, `${instrument.name} release`)
  }
  ok(waves.size >= 2, 'instruments must not all use one wave')
})

test('renderNote keeps length, stays finite and never clips', () => {
  for (const instrument of INSTRUMENTS) {
    const note = renderNote(instrument.name, 220, 0.25, SR)
    eq(note.length, Math.round(0.25 * SR), `length for ${instrument.name}`)
    ok(note instanceof Float32Array, 'renderNote must return a Float32Array')
    ok(allFinite(note), `${instrument.name} must be finite`)
    const p = peak(note)
    ok(p > 0, `${instrument.name} must make sound`)
    ok(p <= 1, `${instrument.name} peak ${p} must be <= 1`)
  }
})

test('renderNote is deterministic and instruments are distinct', () => {
  const first = renderNote('bell', 330, 0.2, SR)
  const second = renderNote('bell', 330, 0.2, SR)
  eq(first.length, second.length)
  for (let i = 0; i < first.length; i++) eq(first[i], second[i], `sample ${i} must repeat`)

  const rendered = INSTRUMENTS.map((i) => renderNote(i.name, 220, 0.15, SR))
  for (let a = 0; a < rendered.length; a++) {
    for (let b = a + 1; b < rendered.length; b++) {
      let diff = 0
      for (let i = 0; i < rendered[a].length; i++) diff += Math.abs(rendered[a][i] - rendered[b][i])
      ok(diff > 1, `${INSTRUMENTS[a].name} and ${INSTRUMENTS[b].name} must differ`)
    }
  }
})

test('renderNote handles edges and rejects bad arguments', () => {
  eq(renderNote('pad', 220, 0, SR).length, 0, 'zero duration')
  eq(renderNote('glass', 220, 0.01, 8000).length, 80, 'length follows the sample rate')
  throws(() => renderNote('nope', 220, 0.1, SR), 'unknown instrument')
  throws(() => renderNote('pad', 0, 0.1, SR), 'hz must be positive')
  throws(() => renderNote('pad', 220, -1, SR), 'dur cannot be negative')
  throws(() => renderNote('pad', 220, 0.1, 0), 'sample rate must be positive')
})

test('suggestFromGenre returns a well-formed setting for every genre', () => {
  for (const name of GENRE_NAMES) {
    const suggestion = suggestFromGenre(name)
    ok(Array.isArray(suggestion.eq), `${name} eq must be an array`)
    ok(suggestion.eq.length >= 1 && suggestion.eq.length <= 8, `${name} band count`)
    for (const band of suggestion.eq) {
      ok(KINDS.has(band.kind), `${name} bad band kind ${band.kind}`)
      ok(Number.isFinite(band.freq) && band.freq > 0 && band.freq < SR / 2, `${name} band freq ${band.freq}`)
      ok(Number.isFinite(band.q) && band.q > 0, `${name} band q ${band.q}`)
      ok(Number.isFinite(band.gainDb) && Math.abs(band.gainDb) <= 12, `${name} band gain ${band.gainDb}`)
    }
    const { comp } = suggestion
    ok(Number.isFinite(comp.thresholdDb) && comp.thresholdDb < 0, `${name} threshold`)
    ok(Number.isFinite(comp.ratio) && comp.ratio >= 1, `${name} ratio`)
    ok(Number.isFinite(comp.attackMs) && comp.attackMs >= 0, `${name} attack`)
    ok(Number.isFinite(comp.releaseMs) && comp.releaseMs >= 0, `${name} release`)
    ok(Number.isFinite(comp.makeupDb), `${name} makeup`)
    ok(
      Number.isFinite(suggestion.targetRmsDb) && suggestion.targetRmsDb >= -20 && suggestion.targetRmsDb <= -8,
      `${name} target ${suggestion.targetRmsDb}`,
    )
  }
})

test('dark genres shelf the highs down and target -16 dB', () => {
  for (const name of ['ambient', 'lofi', 'boom bap']) {
    const suggestion = suggestFromGenre(name)
    const shelf = suggestion.eq.find((b) => b.kind === 'highshelf')
    ok(shelf, `${name} needs a high shelf`)
    ok(shelf.gainDb < 0, `${name} high shelf ${shelf.gainDb} must cut`)
    eq(suggestion.targetRmsDb, -16, `${name} target`)
  }
})

test('bright genres lift 3 kHz and target -12 dB', () => {
  for (const name of ['house', 'pop', 'edm']) {
    const suggestion = suggestFromGenre(name)
    const presence = suggestion.eq.find((b) => b.kind === 'peaking' && b.freq === 3000)
    ok(presence, `${name} needs a 3 kHz band`)
    ok(presence.gainDb > 0, `${name} presence ${presence.gainDb} must lift`)
    eq(suggestion.targetRmsDb, -12, `${name} target`)
  }
})

test('genre spelling is flexible and unknown genres throw', () => {
  const first = suggestFromGenre('Boom_Bap')
  const second = suggestFromGenre('boom bap')
  eq(first.targetRmsDb, second.targetRmsDb, 'spelling must not change the suggestion')
  eq(first.eq.length, second.eq.length)
  throws(() => suggestFromGenre('polka'), 'unknown genre')
  throws(() => suggestFromGenre(''), 'empty genre')
  throws(() => suggestFromGenre(undefined), 'missing genre')
})

test('suggestions are fresh objects each call', () => {
  const a = suggestFromGenre('trap')
  a.eq.push({ kind: 'peaking', freq: 5000, q: 1, gainDb: 6 })
  a.comp.ratio = 99
  const b = suggestFromGenre('trap')
  ok(b.eq.length < a.eq.length, 'band array must not be shared')
  ok(b.comp.ratio !== 99, 'comp must not be shared')
})

test('suggestions run through the master chain cleanly', () => {
  const input = stereo(22050)
  for (const name of ['ambient', 'house']) {
    const suggestion = suggestFromGenre(name)
    const { stereo: out, report: r } = masterChain(input, { ...suggestion, limitDb: -1 }, SR)
    ok(allFinite(out.left) && allFinite(out.right), `${name} output must be finite`)
    ok(r.peakDb <= 0, `${name} peak ${r.peakDb} must respect 0 dBFS`)
    near(r.rmsDb, suggestion.targetRmsDb, 1.5, `${name} loudness should land near target`)
    const measured = analyze(out)
    ok(measured.peakDb <= 0, 'independent measure stays under 0 dBFS')
  }
})

test('balance trims toward the median', () => {
  eq(JSON.stringify(balance([-10, -12, -30])), JSON.stringify([-2, 0, 12]))
  eq(JSON.stringify(balance([-20, -20, -20])), JSON.stringify([0, 0, 0]))
  eq(JSON.stringify(balance([-6])), JSON.stringify([0]))
  eq(JSON.stringify(balance([])), JSON.stringify([]))
  eq(JSON.stringify(balance([-12, NaN, -12])), JSON.stringify([0, -12, 0]))
})

test('balance clamps to -24..+12 and never boosts the loudest track', () => {
  for (const levels of [
    [-60, 0],
    [-40, -2, -3, -1],
    [12, -40, -40],
    [0, 0, -0.5, -30, -30],
    [-3, -3, -3, -3, -3, -3, -3, -3, -3, -30],
  ]) {
    const trims = balance(levels)
    eq(trims.length, levels.length, 'one trim per track')
    for (const trim of trims) {
      ok(Number.isFinite(trim), 'trims must be finite')
      ok(trim >= -24 && trim <= 12, `trim ${trim} outside -24..12`)
    }
    const loudest = Math.max(...levels)
    const loudestIndex = levels.indexOf(loudest)
    ok(trims[loudestIndex] <= 0, `loudest track boosted by ${trims[loudestIndex]}`)
  }
  throws(() => balance('nope'), 'levels must be an array')
})

report()
