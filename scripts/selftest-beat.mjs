// scripts/selftest-beat.mjs — self-test for js/beat.js.
// Run from the project root:  node scripts/selftest-beat.mjs
import { GENRES, renderBeat, genreNames } from '../js/beat.js'
import { test, eq, ok, near, throws, report } from './lib/assert.mjs'

const RATE = 48000
const BARS = 2

const stats = (buf) => {
  let peak = 0
  let sum = 0
  for (const s of buf) {
    peak = Math.max(peak, Math.abs(s))
    sum += s * s
  }
  return { peak, rms: Math.sqrt(sum / (buf.length || 1)) }
}

// Goertzel magnitude of one bin, over a window of the buffer.
function tone(buf, from, len, hz, sampleRate) {
  const k = 2 * Math.cos((2 * Math.PI * hz) / sampleRate)
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < len; i++) {
    const s0 = buf[from + i] + k * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - k * s1 * s2))
}

// Sign changes per second across a window — a crude pitch proxy.
function crossings(buf, from, len, sampleRate) {
  let count = 0
  let prev = buf[from]
  for (let i = 1; i < len; i++) {
    const s = buf[from + i]
    if ((s >= 0) !== (prev >= 0)) count++
    prev = s
  }
  return (count / len) * sampleRate
}

test('GENRES: at least four, all required names present', () => {
  ok(Array.isArray(GENRES))
  ok(GENRES.length >= 4, `need >= 4 genres, got ${GENRES.length}`)
  for (const name of ['boom bap', 'trap', 'drill', 'house']) {
    ok(genreNames().includes(name), `missing genre ${name}`)
  }
})

test('GENRES: tempo, swing and pattern shape are sane', () => {
  for (const g of GENRES) {
    ok(Number.isFinite(g.bpm) && g.bpm > 0, `${g.name} bpm`)
    ok(Number.isFinite(g.swing) && g.swing >= 0 && g.swing <= 1, `${g.name} swing`)
    for (const voice of ['kick', 'snare', 'hat']) {
      eq(g.pattern[voice].length, 16, `${g.name} ${voice} pattern is one bar`)
      ok(/^[x.]{16}$/.test(g.pattern[voice]), `${g.name} ${voice} pattern characters`)
    }
  }
})

test('GENRES: every voice carries finite numbers', () => {
  for (const g of GENRES) {
    for (const voice of ['kick', 'snare', 'hat']) {
      const v = g.voices[voice]
      ok(v && typeof v === 'object', `${g.name} ${voice} params`)
      for (const [key, value] of Object.entries(v)) {
        ok(Number.isFinite(value), `${g.name} ${voice}.${key} must be finite`)
      }
    }
    ok(g.voices.kick.startHz > g.voices.kick.endHz, `${g.name} kick must sweep down`)
    ok(g.voices.hat.hp > g.voices.snare.hp, `${g.name} hat must sit above the snare`)
  }
})

test('GENRES: kick and hat numbers differ between genres', () => {
  const kicks = GENRES.map((g) => `${g.voices.kick.startHz}/${g.voices.kick.decay}`)
  eq(new Set(kicks).size, GENRES.length, 'kick tunings must be distinct')
  const hats = GENRES.map((g) => `${g.voices.hat.hp}/${g.voices.hat.gain}`)
  eq(new Set(hats).size, GENRES.length, 'hat voicings must be distinct')
})

test('every genre renders the exact requested length at its tempo', () => {
  for (const g of GENRES) {
    const buf = renderBeat(g.name, BARS, RATE)
    const expected = Math.round(BARS * 4 * (60 / g.bpm) * RATE)
    ok(buf instanceof Float32Array, 'mono Float32Array')
    eq(buf.length, expected, `${g.name} length follows bars and bpm`)
  }
})

test('every genre renders finite samples at a safe peak, and is not silent', () => {
  for (const g of GENRES) {
    const out = stats(renderBeat(g.name, BARS, RATE))
    ok(Number.isFinite(out.peak) && out.peak > 0.5, `${g.name} peak ${out.peak}`)
    ok(out.peak <= 1, `${g.name} peak ${out.peak} must stay <= 1`)
    ok(out.rms > 0.02, `${g.name} rms ${out.rms} must be audible`)
  }
})

test('renderBeat is sample-identical on repeat renders', () => {
  for (const g of GENRES) {
    const a = renderBeat(g.name, BARS, 44100)
    const b = renderBeat(g.name, BARS, 44100)
    eq(a.length, b.length, `${g.name} repeat length`)
    let same = true
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { same = false; break }
    }
    ok(same, `${g.name} repeat render must be identical`)
  }
})

test('genres render different grooves at the same bar count', () => {
  const house = renderBeat('house', 1, RATE)
  for (const name of ['boom bap', 'trap', 'drill']) {
    const other = renderBeat(name, 1, RATE)
    const len = Math.min(house.length, other.length)
    let diff = 0
    for (let i = 0; i < len; i++) diff = Math.max(diff, Math.abs(house[i] - other[i]))
    ok(diff > 0.1, `${name} must differ from house`)
  }
})

// First-difference RMS: a cheap 6 dB/oct highpass, so a 46 Hz kick tail reads near zero
// while hat and snare noise read full. Use it to prove the noise voices are highpassed.
function highBand(buf, from, len) {
  let sum = 0
  for (let i = from + 1; i < from + len; i++) {
    const d = buf[i] - buf[i - 1]
    sum += d * d
  }
  return Math.sqrt(sum / len)
}

test('kick pitch sweeps down over its first 40 ms', () => {
  // House puts a bare kick on step 0 (96.8 ms step at 124 bpm, hat lands on step 2).
  const buf = renderBeat('house', 1, RATE)
  const early = crossings(buf, 0, Math.round(0.016 * RATE), RATE)
  const late = crossings(buf, Math.round(0.024 * RATE), Math.round(0.016 * RATE), RATE)
  ok(early > late * 1.5, `sweep must move down: early ${early.toFixed(0)} vs late ${late.toFixed(0)} crossings/s`)
  ok(late < 90, `tail settles low, got ${late.toFixed(0)} crossings/s`)
  const win = Math.round(0.016 * RATE)
  ok(tone(buf, 0, win, 100, RATE) > tone(buf, Math.round(0.024 * RATE), win, 100, RATE), '100 Hz energy falls')
  ok(tone(buf, Math.round(0.024 * RATE), win, 45, RATE) > tone(buf, 0, win, 45, RATE), '45 Hz energy rises')
})

test('kick energy is low, snare energy is highpassed', () => {
  const buf = renderBeat('house', 1, RATE)
  const step = RATE * (60 / 124 / 4)
  const win = Math.round(0.03 * RATE)
  const kickLow = tone(buf, 0, win, 50, RATE)
  const kickHigh = highBand(buf, 0, win)
  const snareHigh = highBand(buf, Math.round(step * 4), win)
  ok(kickLow > 0, 'kick has 50 Hz energy')
  ok(snareHigh > kickHigh * 20, `snare high band ${snareHigh.toFixed(4)} vs kick ${kickHigh.toFixed(4)}`)
})

test('hats are short: a hit is spent inside 30 ms', () => {
  const buf = renderBeat('house', 1, RATE)
  const step = RATE * (60 / 124 / 4)
  const at = Math.round(step * 2) // first hat
  const win = Math.round(0.01 * RATE)
  const head = highBand(buf, at, win)
  const tail = highBand(buf, at + Math.round(0.04 * RATE), win)
  ok(head > tail * 20, `hat head ${head.toFixed(4)} vs tail ${tail.toFixed(4)}`)
  ok(tail < highBand(buf, 0, win) * 3, 'nothing of the hat survives past its tail')
})

test('house is the spec reference: 110 -> 45 Hz kick, 180 Hz snare body', () => {
  const house = GENRES.find((g) => g.name === 'house')
  eq(house.voices.kick.startHz, 110, 'kick starts at 110 Hz')
  eq(house.voices.kick.endHz, 45, 'kick lands on 45 Hz')
  eq(house.voices.snare.body, 180, 'snare body is 180 Hz')
  ok(house.voices.snare.hp > 1000, 'snare noise is highpassed')
  ok(house.voices.hat.hp > 5000, 'hat noise is highpassed')
})

test('unknown genre throws', () => {
  throws(() => renderBeat('polka', 1, RATE), 'unknown genre must throw')
  throws(() => renderBeat(undefined, 1, RATE), 'missing genre must throw')
  throws(() => renderBeat('jazz', 1, RATE), 'near-miss genre must throw')
})

test('bad bars and sample rates are guarded', () => {
  throws(() => renderBeat('house', 0, RATE), 'zero bars')
  throws(() => renderBeat('house', -1, RATE), 'negative bars')
  throws(() => renderBeat('house', 1.5, RATE), 'fractional bars')
  throws(() => renderBeat('house', Number.NaN, RATE), 'NaN bars')
  throws(() => renderBeat('house', 1, 0), 'zero sample rate')
  throws(() => renderBeat('house', 1, -48000), 'negative sample rate')
})

test('one bar is exactly one bar of audio, not more', () => {
  near(renderBeat('boom bap', 1, 44100).length, Math.round(4 * (60 / 90) * 44100), 0)
})

report()
