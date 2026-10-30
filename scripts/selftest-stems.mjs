// scripts/selftest-stems.mjs — self-test for js/stems.js.
// Run from the project root:  node scripts/selftest-stems.mjs
import { splitStems, recombine } from '../js/stems.js'
import { biquadCoeffs } from '../js/master.js'
import { test, ok, eq, throws, report } from './lib/assert.mjs'

const SR = 44100

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function rms(buf) {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return buf.length ? Math.sqrt(sum / buf.length) : 0
}

function allFinite(buf) {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) return false
  return true
}

// Hann-windowed single-bin DFT magnitude, enough for a band-presence check.
function binMagnitude(buf, hz) {
  let re = 0
  let im = 0
  const n = buf.length
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    const a = (2 * Math.PI * hz * i) / SR
    re += buf[i] * w * Math.cos(a)
    im -= buf[i] * w * Math.sin(a)
  }
  return Math.hypot(re, im)
}

function highpass(buf, hz) {
  const c = biquadCoeffs('highpass', hz, 0.71, 0, SR)
  const out = new Float32Array(buf.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    out[i] = y
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
  }
  return out
}

// Steady low tone plus short high-frequency noise bursts.
function mixedSignal(seconds) {
  const n = Math.round(seconds * SR)
  const rand = mulberry32(1234)
  const noise = new Float32Array(n)
  const burstLen = Math.round(0.015 * SR)
  const gapLen = Math.round(0.06 * SR)
  for (let start = 0; start < n; start += burstLen + gapLen) {
    for (let i = start; i < Math.min(n, start + burstLen); i++) noise[i] = rand() * 2 - 1
  }
  const bright = highpass(noise, 5000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * 110 * i) / SR) + 0.4 * bright[i]
  return out
}

test('length is preserved for every input length', () => {
  for (const n of [0, 1, 511, 777, 2048, 44100, 44101]) {
    const input = new Float32Array(n)
    for (let i = 0; i < n; i++) input[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / SR)
    const stems = splitStems(input, SR)
    eq(stems.leads.length, n, `leads length for n=${n}`)
    eq(stems.bed.length, n, `bed length for n=${n}`)
    ok(stems.leads instanceof Float32Array, 'leads must be a Float32Array')
    ok(stems.bed instanceof Float32Array, 'bed must be a Float32Array')
    ok(!allFinite(input) === false, 'input stays finite')
  }
})

test('returned buffers are new, never aliases of the input', () => {
  const input = mixedSignal(0.5)
  const stems = splitStems(input, SR)
  ok(stems.leads.buffer !== input.buffer, 'leads must not alias the input')
  ok(stems.bed.buffer !== input.buffer, 'bed must not alias the input')
  const before = Float32Array.from(input)
  splitStems(input, SR)
  for (let i = 0; i < input.length; i++) eq(input[i], before[i], `input sample ${i} unchanged`)
})

test('every output sample is finite on a mixed signal', () => {
  const input = mixedSignal(1)
  input[0] = 0
  const stems = splitStems(input, SR)
  ok(allFinite(stems.leads), 'leads must be finite')
  ok(allFinite(stems.bed), 'bed must be finite')
})

test('recombine sums back to the input under 1e-3 RMS error', () => {
  const input = mixedSignal(1)
  const fused = recombine(splitStems(input, SR))
  eq(fused.length, input.length, 'recombined length')
  let err = 0
  for (let i = 0; i < input.length; i++) {
    const d = fused[i] - input[i]
    err += d * d
  }
  const errRms = Math.sqrt(err / input.length)
  ok(errRms < 1e-3, `recombine RMS error ${errRms} must be < 1e-3`)
  eq(rms(fused) > 0.05, true, 'recombined signal must carry energy')
})

test('silence stays silent and never produces NaN', () => {
  const input = new Float32Array(8192)
  const stems = splitStems(input, SR)
  ok(allFinite(stems.leads), 'silent leads must be finite')
  ok(allFinite(stems.bed), 'silent bed must be finite')
  for (let i = 0; i < input.length; i++) {
    eq(stems.leads[i], 0, `lead sample ${i} must be 0`)
    eq(stems.bed[i], 0, `bed sample ${i} must be 0`)
  }
  eq(rms(recombine(stems)), 0, 'recombined silence must be 0')
})

test('high-frequency bursts land in leads, the low sine stays in bed', () => {
  const input = mixedSignal(1)
  const { leads, bed } = splitStems(input, SR)
  const leadHigh = binMagnitude(leads, 6500)
  const bedHigh = binMagnitude(bed, 6500)
  const leadLow = binMagnitude(leads, 110)
  const bedLow = binMagnitude(bed, 110)
  console.log(
    `    ratios — high ${(leadHigh / bedHigh).toFixed(1)}x to leads, low ${(bedLow / leadLow).toFixed(1)}x to bed`,
  )
  ok(leadHigh > 3 * bedHigh, `high band belongs to leads (${leadHigh} vs ${bedHigh})`)
  ok(bedLow > 3 * leadLow, `low tone belongs to bed (${bedLow} vs ${leadLow})`)
  ok(rms(leads) > 0.01, 'leads must carry the transient energy')
  ok(rms(bed) > 0.05, 'bed must carry the sustained energy')
})

test('rejects bad arguments', () => {
  throws(() => splitStems([0, 1, 2], SR), 'array is not enough')
  throws(() => splitStems(new Float32Array(16), 0), 'sample rate must be positive')
  throws(() => splitStems(new Float32Array(16), NaN), 'sample rate must be finite')
  throws(() => recombine({ leads: new Float32Array(4) }), 'bed is required')
  throws(() => recombine({ leads: new Float32Array(4), bed: new Float32Array(5) }), 'lengths must match')
})

report()
