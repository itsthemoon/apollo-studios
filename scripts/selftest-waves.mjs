// scripts/selftest-waves.mjs — the region waveform peaks module.
import { test, ok, eq, near, report } from './lib/assert.mjs'
import * as waves from '../js/waves.js'

const RATE = 48000
/* one second: loud sine, then silence, then a quiet sine */
const buf = new Float32Array(RATE * 3)
for (let i = 0; i < RATE; i++) buf[i] = 0.8 * Math.sin((2 * Math.PI * 220 * i) / RATE)
for (let i = RATE * 2; i < RATE * 3; i++) buf[i] = 0.02 * Math.sin((2 * Math.PI * 440 * i) / RATE)

const cache = waves.buildCache(buf, RATE)

test('cache covers the buffer in order', () => {
  ok(cache.count > 0, 'buckets built')
  ok(cache.bucketSize >= 1, 'bucket size is at least one sample')
  eq(cache.len, buf.length, 'length recorded')
  near(cache.bucketSize * cache.count, buf.length, cache.bucketSize, 'buckets cover every sample')
  // the window sits 2.9 dB under the true peak so limited material keeps shape
  ok(cache.ref > 0.5 && cache.ref <= 0.81, `ref sits just under the loudest sample (${cache.ref})`)
})

test('bucket count is capped, not the bucket size', () => {
  const huge = new Float32Array(4_000_000)
  const big = waves.buildCache(huge, RATE)
  ok(big.count <= waves.MAX_BUCKETS, `count ${big.count} under the cap`)
  ok(big.bucketSize > 1, 'a long take gets coarser buckets instead of more of them')
  ok(waves.buildCache(new Float32Array(0), RATE).count === 0, 'empty buffer builds no buckets')
})

test('a window follows the region beats, not the screen', () => {
  const bufLen = buf.length
  const span = waves.spanOf(bufLen / RATE, 120) // the take laid over its own beats
  near(span, 6, 1e-9, 'three seconds at 120 bpm is six beats')
  const region = { startBeat: 2, lengthBeats: 2 }
  const win = waves.windowOf(region, span, bufLen)
  near(win.from, RATE, 1, 'everything before the region is skipped')
  near(win.to, RATE * 2, 1, 'and it stops at the region end')
  eq(win.full, false, 'a slice is not the whole take')

  const whole = waves.windowOf({ startBeat: 0, lengthBeats: span }, span, bufLen)
  eq(whole.full, true, 'a region over the whole span is the whole take')
  // a stretched clip says the take spans more beats than tempo would: the same
  // pixel fraction must still give the same sample fraction
  const stretched = waves.windowOf({ startBeat: 0, lengthBeats: span * 2 }, span * 2, bufLen)
  eq(stretched.full, true, 'a doubled span still covers the take exactly once')
})

test('windows clamp at both ends of the take', () => {
  const span = 6
  const after = waves.windowOf({ startBeat: 40, lengthBeats: 4 }, span, buf.length)
  eq(after.from, buf.length, 'starts past the end clamps')
  eq(after.to, buf.length, 'and does not invert')
  const before = waves.windowOf({ startBeat: -4, lengthBeats: 2 }, span, buf.length)
  eq(before.from, 0, 'negative start clamps to zero')
  const zero = waves.windowOf({ startBeat: 0, lengthBeats: 2 }, 0, buf.length)
  eq(zero.from, 0, 'a missing span falls back to one beat')
  eq(Number.isFinite(zero.to), true, 'the window stays finite')
})

test('rms and peaks follow the audio under each column', () => {
  const loud = waves.columns(cache, 0, RATE, 10)
  const quiet = waves.columns(cache, RATE * 2, RATE * 3, 10)
  const gap = waves.columns(cache, RATE, RATE * 2, 10)
  ok(loud.peak.every((v) => v > 0.6), 'the loud second is loud in every column')
  ok(quiet.peak.every((v) => v > 0.01 && v < 0.05), 'the quiet second stays quiet')
  ok(gap.peak.every((v) => v === 0), 'the silent second is flat')
  for (let x = 0; x < loud.cols; x++) ok(loud.rms[x] <= loud.peak[x] + 1e-6, 'rms never exceeds peak')
})

test('columns are capped and never empty', () => {
  const many = waves.columns(cache, 0, buf.length, 5000)
  eq(many.cols, waves.MAX_COLUMNS, 'decimated to the cap')
  const one = waves.columns(cache, 0, buf.length, 0)
  eq(one.cols, 1, 'a zero width still yields one column')
  const past = waves.columns(cache, buf.length + 10, buf.length + 99, 4)
  eq(past.empty, true, 'a window outside the take is empty')
})

test('fades are a brightness ramp, gain scales it', () => {
  const region = { fadeIn: 2, fadeOut: 2, lengthBeats: 8, gain: 0.5 }
  near(waves.envAt(region, 0, 41).amp, 0, 1e-6, 'fade in starts at silence')
  near(waves.envAt(region, 20, 41).amp, 0.5, 1e-6, 'middle is full gain')
  near(waves.envAt(region, 40, 41).amp, 0, 1e-6, 'fade out ends at silence')
  const plain = { fadeIn: 0, fadeOut: 0, lengthBeats: 8, gain: 2 }
  near(waves.envAt(plain, 0, 11).amp, 2, 1e-6, 'no fades means the gain alone')
  eq(waves.envAt({}, 0, 1).gain, 1, 'a region without gain reads as unity')
  near(waves.envAt({ fadeIn: 4, lengthBeats: 8 }, 10, 41).ramp, 0.5, 1e-6, 'the in ramp is linear over its beats')
})

report()
