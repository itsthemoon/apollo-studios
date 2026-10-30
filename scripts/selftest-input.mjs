// scripts/selftest-input.mjs — self-test for the input node modules:
// js/pitch.js and js/capture.js.
//
// Run from the project root:
//   node scripts/selftest-input.mjs
// Expected final line: ALL CHECKS PASSED

import { test, testAsync, near, ok, eq, report } from './lib/assert.mjs'
import { detectPitch, detectNotes } from '../js/pitch.js'
import { isSupported, startRecording } from '../js/capture.js'

const SR = 44100
const DB6 = Math.pow(10, -6 / 20) // -6 dBFS peak amplitude ≈ 0.5012

function sine(hz, seconds, sampleRate = SR, amp = DB6) {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return out
}

function noise(seconds, sampleRate = SR) {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.random() * 2 - 1
  return out
}

// Buffer of `seconds` with a `toneDur`-second tone of `hz` starting at
// `toneStart`; silence everywhere else.
function toneIn(seconds, hz, toneStart, toneDur, sampleRate = SR, amp = DB6) {
  const buf = new Float32Array(Math.round(sampleRate * seconds))
  const a = Math.round(toneStart * sampleRate)
  const b = Math.min(buf.length, Math.round((toneStart + toneDur) * sampleRate))
  for (let i = a; i < b; i++) buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate)
  return buf
}

// ---------------------------------------------------------------- detectPitch

test('pitch: 440 Hz sine at -6 dBFS detects within 3% and clear', () => {
  const r = detectPitch(sine(440, 0.25), SR)
  near(r.hz, 440, 440 * 0.03)
  ok(r.clarity > 0.5, `clarity ${r.clarity}`)
})

test('pitch: 220 Hz sine within 3% and clear', () => {
  const r = detectPitch(sine(220, 0.25), SR)
  near(r.hz, 220, 220 * 0.03)
  ok(r.clarity > 0.5, `clarity ${r.clarity}`)
})

test('pitch: 880 Hz sine within 3% and clear', () => {
  const r = detectPitch(sine(880, 0.25), SR)
  near(r.hz, 880, 880 * 0.03)
  ok(r.clarity > 0.5, `clarity ${r.clarity}`)
})

test('pitch: white noise has low clarity and hz 0', () => {
  const r = detectPitch(noise(0.25), SR)
  ok(r.clarity < 0.5, `clarity ${r.clarity}`)
  eq(r.hz, 0)
})

test('pitch: silence returns hz 0', () => {
  const r = detectPitch(new Float32Array(2048), SR)
  eq(r.hz, 0)
  eq(r.clarity, 0)
})

test('pitch: empty buffer returns hz 0', () => {
  const r = detectPitch(new Float32Array(0), SR)
  eq(r.hz, 0)
  eq(r.clarity, 0)
})

test('pitch: non-finite samples return hz 0', () => {
  const buf = sine(440, 0.1)
  buf[100] = NaN
  const r = detectPitch(buf, SR)
  eq(r.hz, 0)
  eq(r.clarity, 0)
})

test('pitch: sample rate is respected, not hardcoded', () => {
  const sr48 = 48000
  const r = detectPitch(sine(440, 0.25, sr48), sr48)
  near(r.hz, 440, 440 * 0.03)
  ok(r.clarity > 0.5, `clarity ${r.clarity}`)
})

test('pitch: detectPitch does not mutate its input', () => {
  const buf = sine(440, 0.25)
  const copy = Float32Array.from(buf)
  detectPitch(buf, SR)
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== copy[i]) throw new Error('input buffer was mutated')
  }
  ok(true, 'buffer unchanged')
})

// --------------------------------------------------------------- detectNotes

const note330 = toneIn(1, 330, 0, 0.4)

test('notes: 0.4 s of 330 Hz in 1 s yields exactly one note', () => {
  const notes = detectNotes(note330, SR)
  eq(notes.length, 1)
  const n0 = notes[0]
  // 330 Hz = E4. Contract pitch standard: 69 = A4 = 440, so
  // midi = 69 + 12*log2(330/440) = 64.02.
  // NOTE: the task brief said "midi near 53"; that does not match 330 Hz
  // under the contract formula — see .handoff/l1a.md.
  near(n0.midi, 64.02, 0.5)
  near(n0.hz, 330, 330 * 0.03)
  near(n0.start, 0, 0.05)
  near(n0.dur, 0.4, 0.07)
})

test('notes: silence yields no notes', () => {
  const notes = detectNotes(new Float32Array(SR), SR)
  eq(notes.length, 0)
})

test('notes: two tones yield two notes sorted by start', () => {
  const buf = toneIn(1.5, 440, 0, 0.4)
  const buf2 = toneIn(1.5, 220, 0.6, 0.5)
  for (let i = 0; i < buf2.length; i++) buf[i] += buf2[i]
  const notes = detectNotes(buf, SR)
  eq(notes.length, 2)
  ok(notes[0].start < notes[1].start, 'sorted by start')
  near(notes[0].midi, 69, 0.5)
  near(notes[0].start, 0, 0.05)
  near(notes[1].midi, 57, 0.5)
  near(notes[1].start, 0.6, 0.07)
  near(notes[1].dur, 0.5, 0.07)
})

test('notes: notes shorter than minDur are dropped', () => {
  const short = toneIn(1, 330, 0, 0.02)
  eq(detectNotes(short, SR).length, 0)
})

test('notes: minDur option is respected', () => {
  eq(detectNotes(note330, SR, { minDur: 0.45 }).length, 0)
  eq(detectNotes(note330, SR, { minDur: 0.2 }).length, 1)
})

test('notes: invalid sample rate yields no notes', () => {
  eq(detectNotes(note330, NaN).length, 0)
})

// ---------------------------------------------------------- capture.js (Node)

test('capture: isSupported() is false outside a browser', () => {
  eq(isSupported(), false)
})

testAsync('capture: startRecording rejects with a readable error in node', async () => {
  try {
    await startRecording()
  } catch (err) {
    ok(err instanceof Error, 'rejects with an Error')
    eq(err.message, 'unsupported')
    return
  }
  throw new Error('expected startRecording to reject')
})

report()
