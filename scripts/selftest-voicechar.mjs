// scripts/selftest-voicechar.mjs — self-test for js/voicechar.js.
// Run from the project root:  node scripts/selftest-voicechar.mjs
import { CHARACTERS, applyCharacter, characterNames } from '../js/voicechar.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const SR = 48000
const TAU = Math.PI * 2

function sine(len, hz, amp = 0.5) {
  const buf = new Float32Array(len)
  for (let i = 0; i < len; i++) buf[i] = Math.sin((TAU * hz * i) / SR) * amp
  return buf
}

function square(len, hz, amp = 1) {
  const buf = new Float32Array(len)
  for (let i = 0; i < len; i++) buf[i] = (i % Math.round(SR / hz) < SR / hz / 2 ? 1 : -1) * amp
  return buf
}

function peak(buf) {
  let p = 0
  for (const v of buf) p = Math.max(p, Math.abs(v))
  return p
}

function rms(buf) {
  let sum = 0
  for (const v of buf) sum += v * v
  return buf.length ? Math.sqrt(sum / buf.length) : 0
}

// Positive-slope crossings per second, with hysteresis so breath noise cannot
// retrigger on a wobble around zero.
function crossRate(buf) {
  let armed = false
  let count = 0
  for (const v of buf) {
    if (v < -0.1) armed = true
    else if (armed && v > 0.1) {
      count++
      armed = false
    }
  }
  return count / (buf.length / SR)
}

const names = () => CHARACTERS.map((c) => c.name)
const byName = (n) => CHARACTERS.find((c) => c.name === n)

test('exports exist and CHARACTERS is an array', () => {
  ok(Array.isArray(CHARACTERS))
  eq(typeof applyCharacter, 'function')
  eq(typeof characterNames, 'function')
})

test('at least four characters with unique string names', () => {
  ok(CHARACTERS.length >= 4, `need >= 4 characters, got ${CHARACTERS.length}`)
  const ns = names()
  ok(ns.every((n) => typeof n === 'string' && n.length > 0))
  eq(new Set(ns).size, ns.length, 'names unique')
})

test('every character stays inside the contract bounds', () => {
  for (const c of CHARACTERS) {
    ok(Number.isFinite(c.pitchSemis) && c.pitchSemis >= -7 && c.pitchSemis <= 7, `${c.name}: pitchSemis`)
    ok(Number.isFinite(c.tiltDb) && c.tiltDb >= -9 && c.tiltDb <= 9, `${c.name}: tiltDb`)
    ok(Number.isFinite(c.driveDb) && c.driveDb >= 0 && c.driveDb <= 12, `${c.name}: driveDb`)
    ok(Number.isFinite(c.breathMix) && c.breathMix >= 0 && c.breathMix <= 0.3, `${c.name}: breathMix`)
  }
})

test('characters are frozen so callers cannot corrupt the table', () => {
  ok(Object.isFrozen(CHARACTERS))
})

test('characterNames mirrors the table', () => {
  eq(characterNames().join(','), names().join(','))
})

test('throws `unknown character` on a bad name', () => {
  let err = null
  try {
    applyCharacter(sine(64, 200), 'nope', SR)
  } catch (e) {
    err = e
  }
  ok(err instanceof Error, 'must throw an Error')
  eq(err.message, 'unknown character')
  throws(() => applyCharacter(sine(64, 200), undefined, SR))
})

test('rejects a bad take and a bad sample rate', () => {
  throws(() => applyCharacter([0, 0.1], 'natural', SR))
  throws(() => applyCharacter(sine(64, 200), 'natural', 0))
  throws(() => applyCharacter(sine(64, 200), 'natural', NaN))
  throws(() => applyCharacter(sine(64, 200), 'natural', -48000))
})

test('empty input gives empty output', () => {
  const out = applyCharacter(new Float32Array(0), 'phone-radio', SR)
  ok(out instanceof Float32Array)
  eq(out.length, 0)
})

test('natural is a transparent pass with the same length', () => {
  const input = sine(1024, 220)
  const out = applyCharacter(input, 'natural', SR)
  eq(out.length, input.length)
  ok(out !== input, 'new buffer')
  let diff = 0
  for (let i = 0; i < input.length; i++) diff = Math.max(diff, Math.abs(out[i] - input[i]))
  eq(diff, 0, 'sample-exact')
})

test('natural on silence stays exactly silent', () => {
  const out = applyCharacter(new Float32Array(256), 'natural', SR)
  eq(peak(out), 0)
})

test('output never aliases the input and the input is not mutated', () => {
  const input = sine(2048, 180)
  const before = Array.from(input)
  const out = applyCharacter(input, 'bright-air', SR)
  ok(out !== input, 'new object')
  ok(out.buffer !== input.buffer, 'new backing buffer')
  eq(Array.from(input).join(','), before.join(','), 'input unchanged')
})

test('length direction follows the pitch ratio', () => {
  const input = sine(SR, 200)
  const up = applyCharacter(input, 'chipmunk', SR)
  const down = applyCharacter(input, 'deep-monster', SR)
  const upRatio = 2 ** (byName('chipmunk').pitchSemis / 12)
  const downRatio = 2 ** (byName('deep-monster').pitchSemis / 12)
  ok(up.length < input.length, 'pitch up must shorten')
  ok(down.length > input.length, 'pitch down must lengthen')
  ok(Math.abs(up.length - Math.round(input.length / upRatio)) <= 1, 'up length ~ len / ratio')
  ok(Math.abs(down.length - Math.round(input.length / downRatio)) <= 1, 'down length ~ len / ratio')
})

test('pitch up raises the measured frequency by the ratio', () => {
  const input = sine(SR, 200, 0.8)
  const out = applyCharacter(input, 'chipmunk', SR)
  const want = 200 * 2 ** (byName('chipmunk').pitchSemis / 12)
  near(crossRate(out), want, want * 0.06)
})

test('pitch down lowers the measured frequency by the ratio', () => {
  const input = sine(SR, 400, 0.8)
  const out = applyCharacter(input, 'deep-monster', SR)
  const want = 400 * 2 ** (byName('deep-monster').pitchSemis / 12)
  near(crossRate(out), want, want * 0.06)
})

test('a DC take survives resampling flat', () => {
  const input = new Float32Array(20000).fill(0.5)
  const out = applyCharacter(input, 'chipmunk', SR)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 3000; i < out.length; i++) {
    if (out[i] < lo) lo = out[i]
    if (out[i] > hi) hi = out[i]
  }
  ok(hi - lo < 0.03, `plateau must stay flat, spread ${hi - lo}`)
})

test('every character returns finite samples', () => {
  const input = sine(4096, 330, 0.9)
  for (const c of CHARACTERS) {
    const out = applyCharacter(input, c.name, SR)
    ok(out.length > 0, `${c.name}: produced samples`)
    ok(out.every((v) => Number.isFinite(v)), `${c.name}: non-finite sample`)
  }
})

test('peak stays <= 1 on full-scale material', () => {
  const hot = square(SR, 220, 1)
  for (const c of CHARACTERS) {
    const out = applyCharacter(hot, c.name, SR)
    ok(peak(out) <= 1, `${c.name}: peak ${peak(out)}`)
  }
})

test('peak stays <= 1 even for over-unity input', () => {
  const over = sine(8192, 210, 1.4)
  for (const c of CHARACTERS) {
    ok(peak(applyCharacter(over, c.name, SR)) <= 1, `${c.name}: hot input escapes`)
  }
})

test('positive tilt brightens, negative tilt darkens', () => {
  const hf = sine(SR, 7000, 0.4)
  const flat = rms(applyCharacter(hf, 'natural', SR))
  const bright = rms(applyCharacter(hf, 'phone-radio', SR))
  const dark = rms(applyCharacter(hf, 'whisper', SR))
  ok(bright > flat * 1.5, `positive tilt must raise treble (${bright} vs ${flat})`)
  ok(dark < flat, `negative tilt must lower treble (${dark} vs ${flat})`)
})

test('drive compresses the crest factor', () => {
  const input = sine(SR, 300, 0.5)
  const clean = applyCharacter(input, 'natural', SR)
  const hot = applyCharacter(input, 'phone-radio', SR)
  ok(peak(hot) / rms(hot) < peak(clean) / rms(clean), 'drive must squash peaks relative to rms')
})

test('breath noise is deterministic and audible on silence', () => {
  const silent = new Float32Array(4096)
  const a = applyCharacter(silent, 'whisper', SR)
  const b = applyCharacter(silent, 'whisper', SR)
  eq(a.join(','), b.join(','), 'same input, same output')
  ok(rms(a) > 0.01, 'breath must add audible noise')
  ok(peak(a) <= 1)
})

test('breath noise scales with breathMix', () => {
  const silent = new Float32Array(8192)
  const low = rms(applyCharacter(silent, 'chipmunk', SR)) // 0.02
  const high = rms(applyCharacter(silent, 'whisper', SR)) // 0.30
  ok(high > low * 5, `higher breathMix must be louder (${high} vs ${low})`)
})

report()
