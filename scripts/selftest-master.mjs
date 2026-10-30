#!/usr/bin/env node
// Self-test for js/master.js + js/wav.js (master node, level 1d).
// Run from the project root:  node scripts/selftest-master.mjs

import { readFileSync } from 'node:fs'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

// js/*.js modules are ESM, but the repo has no package.json ("type":"module"),
// so Node would parse them as CommonJS. Load via data: URLs to force ESM
// parsing without creating any file outside this task's scope.
const importEsm = async (rel) => {
  const url = new URL(rel, import.meta.url)
  const src = readFileSync(url, 'utf8')
  return import(`data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`)
}

const master = await importEsm('../js/master.js')
const wav = await importEsm('../js/wav.js')
const { analyze, biquadCoeffs, applyEQ, compress, limit, normalizeRms, masterChain } = master
const { encodeWav, wavHeaderBytes } = wav

const SR = 44100
const EQ_KINDS = ['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass']

// ---- helpers ---------------------------------------------------------------

function makeSine(n, freq, peakDb, sr = SR) {
  const amp = 10 ** (peakDb / 20)
  const left = new Float32Array(n)
  for (let i = 0; i < n; i++) left[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  return { left, right: left.slice() }
}

// sine whose RMS (not peak) sits at rmsDb dBFS
function makeSineAtRms(n, freq, rmsDb, sr = SR) {
  const amp = (10 ** (rmsDb / 20)) * Math.SQRT2
  const left = new Float32Array(n)
  for (let i = 0; i < n; i++) left[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  return { left, right: left.slice() }
}

function makeSilence(n = 44100) {
  return { left: new Float32Array(n), right: new Float32Array(n) }
}

function allFinite(buf) {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i])) return false
  return true
}

function maxAbsDiff(a, b) {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

const allFiniteStereo = (st) => allFinite(st.left) && allFinite(st.right)

// ---- biquadCoeffs ----------------------------------------------------------

test('biquadCoeffs: finite for every kind at 20 Hz and at 0.49*sr', () => {
  for (const kind of EQ_KINDS) {
    for (const [freq, gainDb] of [[20, 6], [0.49 * SR, 6], [0.49 * SR, -6]]) {
      const c = biquadCoeffs(kind, freq, 0.7071, gainDb, SR)
      ok(['b0', 'b1', 'b2', 'a1', 'a2'].every((k) => Number.isFinite(c[k])), `${kind} @ ${freq.toFixed(1)} Hz finite`)
    }
  }
})

test('biquadCoeffs: survives q = 0 and out-of-range freq', () => {
  for (const kind of EQ_KINDS) {
    const c1 = biquadCoeffs(kind, 200, 0, 6, SR)
    ok(['b0', 'b1', 'b2', 'a1', 'a2'].every((k) => Number.isFinite(c1[k])), `${kind} q=0 finite`)
    const c2 = biquadCoeffs(kind, SR * 2, 0.7, 6, SR) // above Nyquist
    ok(['b0', 'b1', 'b2', 'a1', 'a2'].every((k) => Number.isFinite(c2[k])), `${kind} freq>nyquist finite`)
    const c3 = biquadCoeffs(kind, 1000, 0.7071, 48, SR) // extreme gain
    ok(['b0', 'b1', 'b2', 'a1', 'a2'].every((k) => Number.isFinite(c3[k])), `${kind} +48 dB finite`)
  }
})

test('biquadCoeffs: throws on unknown kind', () => {
  throws(() => biquadCoeffs('bandpass', 1000, 0.7, 0, SR), 'unknown kind throws')
})

// ---- applyEQ ----------------------------------------------------------------

test('applyEQ returns new, non-aliased buffers and never mutates input', () => {
  const input = makeSine(8192, 200, -12)
  const savedL = input.left.slice()
  const savedR = input.right.slice()
  const out = applyEQ(input, [{ kind: 'peaking', freq: 1000, q: 1, gainDb: 3 }], SR)
  ok(out !== input && out.left !== input.left && out.right !== input.right, 'no aliasing')
  ok(out.left instanceof Float32Array && out.right instanceof Float32Array, 'Float32Array out')
  eq(out.left.length, input.left.length, 'length preserved')
  ok(allFiniteStereo(out), 'output finite')
  eq(maxAbsDiff(input.left, savedL), 0, 'left input untouched')
  eq(maxAbsDiff(input.right, savedR), 0, 'right input untouched')

  const empty = applyEQ(input, [], SR) // empty band list still returns copies
  ok(empty.left !== input.left && empty.right !== input.right, 'empty bands still copy')
})

test('+6 dB lowshelf at 500 Hz makes a -30 dBFS 200 Hz tone louder', () => {
  // RBJ lowshelf boosts BELOW its corner: 200 Hz sits in the boosted region of
  // a 500 Hz shelf, so the tone must come out louder.
  const input = makeSine(44100, 200, -30)
  const before = analyze(input).rmsDb
  const out = applyEQ(input, [{ kind: 'lowshelf', freq: 500, q: 0.7071, gainDb: 6 }], SR)
  const after = analyze(out).rmsDb
  ok(after > before + 4, `lowshelf boost ${(after - before).toFixed(2)} dB > 4 dB`)
})

test('peaking +6 dB at 1 kHz boosts a 1 kHz tone', () => {
  const input = makeSine(44100, 1000, -20)
  const before = analyze(input).rmsDb
  const out = applyEQ(input, [{ kind: 'peaking', freq: 1000, q: 1, gainDb: 6 }], SR)
  ok(analyze(out).rmsDb > before + 4.5, 'peaking boost')
})

test('highpass 500 Hz attenuates a 100 Hz tone', () => {
  const input = makeSine(44100, 100, -20)
  const before = analyze(input).rmsDb
  const out = applyEQ(input, [{ kind: 'highpass', freq: 500, q: 0.7071, gainDb: 0 }], SR)
  ok(analyze(out).rmsDb < before - 10, 'highpass attenuation')
})

test('applyEQ: two bands in series stay finite', () => {
  const out = applyEQ(
    makeSine(44100, 1000, -6),
    [
      { kind: 'highpass', freq: 80, q: 0.7071, gainDb: 0 },
      { kind: 'peaking', freq: 1000, q: 2, gainDb: 6 },
    ],
    SR
  )
  ok(allFiniteStereo(out), 'finite')
  ok(analyze(out).rmsDb > -Infinity, 'audible output')
})

// ---- compress ---------------------------------------------------------------

test('compressor is bitwise unity well below threshold', () => {
  const input = makeSineAtRms(44100, 1000, -40)
  const out = compress(input, { thresholdDb: -12, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0 }, SR)
  eq(maxAbsDiff(out.left, input.left), 0, 'left identical below threshold')
  eq(maxAbsDiff(out.right, input.right), 0, 'right identical below threshold')
})

test('compressor reduces a hot signal', () => {
  const input = makeSine(44100, 1000, -3)
  const before = analyze(input).rmsDb
  const out = compress(input, { thresholdDb: -20, ratio: 4, attackMs: 10, releaseMs: 120, makeupDb: 0 }, SR)
  ok(analyze(out).rmsDb < before - 1, 'rms reduced')
  ok(allFiniteStereo(out), 'finite')
})

test('compressor stays finite on silence (no NaN)', () => {
  const out = compress(makeSilence(4096), { thresholdDb: -12, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0 }, SR)
  ok(allFiniteStereo(out), 'finite')
  eq(maxAbsDiff(out.left, makeSilence(4096).left), 0, 'silence stays silence')
})

// ---- limit ------------------------------------------------------------------

test('limit holds the ceiling and is transparent below it', () => {
  const hot = makeSine(44100, 1000, 0) // 0 dBFS peaks
  const limited = limit(hot, -6)
  const ceiling = 10 ** (-6 / 20)
  let maxPeak = 0
  for (let i = 0; i < limited.left.length; i++) {
    maxPeak = Math.max(maxPeak, Math.abs(limited.left[i]), Math.abs(limited.right[i]))
  }
  ok(maxPeak <= ceiling, `peak ${(20 * Math.log10(maxPeak)).toFixed(2)} dB <= ceiling -6 dB`)
  near(maxPeak, ceiling, 1e-5, 'limiter actually engaged')
  ok(allFiniteStereo(limited), 'finite')

  const quiet = makeSine(8192, 1000, -12)
  const untouched = limit(quiet, 0)
  eq(maxAbsDiff(untouched.left, quiet.left), 0, 'below-ceiling signal bitwise unchanged')
})

// ---- normalizeRms -----------------------------------------------------------

test('normalizeRms: -40 dBFS RMS to -14 dB target nears -14 within ±2 dB (24 dB cap)', () => {
  const input = makeSineAtRms(44100, 440, -40)
  const { stereo, gainDb } = normalizeRms(input, -14)
  const after = analyze(stereo).rmsDb
  // Needed gain is +26 dB, so the +24 dB cap binds: output lands at -16 dB,
  // exactly the edge of the ±2 dB window — allow float32 measurement slack.
  near(after, -16, 0.01, 'rms at the capped value')
  ok(Math.abs(after - -14) <= 2.01, 'within ±2 dB of target')
  near(gainDb, 24, 0.001, 'gain capped at +24 dB')
  ok(stereo !== input && stereo.left !== input.left, 'new buffers')
  ok(allFiniteStereo(stereo), 'finite')
})

test('normalizeRms: silence gets gain 0', () => {
  const { stereo, gainDb } = normalizeRms(makeSilence(4096), -14)
  eq(gainDb, 0, 'gain 0')
  eq(analyze(stereo).rmsDb, -Infinity, 'still silent')
})

// ---- analyze ----------------------------------------------------------------

test('analyze: silence gives -Infinity, not NaN', () => {
  const { peakDb, rmsDb } = analyze(makeSilence(1024))
  eq(peakDb, -Infinity, 'peak -Infinity')
  eq(rmsDb, -Infinity, 'rms -Infinity')
})

test('analyze: full-scale sine reads 0 dBFS peak and ≈ -3 dBFS RMS', () => {
  const { peakDb, rmsDb } = analyze(makeSine(44100, 1000, 0))
  near(peakDb, 0, 0.05, 'peak ≈ 0 dBFS')
  near(rmsDb, -3.0103, 0.05, 'rms ≈ -3.01 dBFS')
})

// ---- masterChain ------------------------------------------------------------

test('masterChain: silent input survives with all-finite samples', () => {
  const { stereo, report } = masterChain(
    makeSilence(44100),
    {
      eq: [{ kind: 'highpass', freq: 80, q: 0.7071, gainDb: 0 }],
      comp: { thresholdDb: -12, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0 },
      limitDb: -0.3,
      targetRmsDb: -14,
    },
    SR
  )
  ok(allFiniteStereo(stereo), 'all samples finite')
  eq(maxAbsDiff(stereo.left, new Float32Array(44100)), 0, 'left still silent')
  eq(maxAbsDiff(stereo.right, new Float32Array(44100)), 0, 'right still silent')
  eq(report.peakDb, -Infinity, 'report peak -Infinity')
  eq(report.rmsDb, -Infinity, 'report rms -Infinity')
  eq(report.gainDb, 0, 'report gain 0')
})

test('masterChain: -3 dBFS 1 kHz tone peaks at or below 0 dBFS', () => {
  const { stereo, report } = masterChain(
    makeSine(44100, 1000, -3),
    {
      eq: [],
      comp: { thresholdDb: -12, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0 },
      limitDb: 0,
      targetRmsDb: -14,
    },
    SR
  )
  ok(report.peakDb <= 0.001, `peak ${report.peakDb.toFixed(3)} dB ≤ 0 dBFS`)
  ok(allFiniteStereo(stereo), 'finite')
})

test('masterChain: quiet in-range signal passes through essentially untouched', () => {
  const input = makeSineAtRms(44100, 500, -20)
  const { stereo, report } = masterChain(
    input,
    {
      eq: [],
      comp: { thresholdDb: -12, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0 },
      limitDb: 0,
      targetRmsDb: -20,
    },
    SR
  )
  ok(maxAbsDiff(stereo.left, input.left) < 1e-6, 'left essentially unchanged')
  ok(maxAbsDiff(stereo.right, input.right) < 1e-6, 'right essentially unchanged')
  near(report.rmsDb, -20, 0.05, 'rms unchanged')
  near(report.peakDb, analyze(input).peakDb, 0.05, 'peak unchanged')
  near(report.gainDb, 0, 0.01, 'gain ≈ 0')
})

test('masterChain: reports true post-chain values and applied gain', () => {
  const input = makeSineAtRms(44100, 440, -26)
  const { report } = masterChain(
    input,
    {
      eq: [],
      comp: { thresholdDb: -10, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0 },
      limitDb: -0.5,
      targetRmsDb: -14,
    },
    SR
  )
  near(report.gainDb, 12, 0.5, 'gain reported')
  near(report.rmsDb, -14, 1, 'post rms at target')
  ok(report.peakDb <= 0.001, 'post peak within 0 dBFS')
})

test('masterChain: does not mutate its input', () => {
  const input = makeSine(8192, 300, -12)
  const savedL = input.left.slice()
  const savedR = input.right.slice()
  const { stereo } = masterChain(
    input,
    { eq: [{ kind: 'highpass', freq: 60, q: 0.7, gainDb: 0 }], comp: {}, limitDb: -0.3, targetRmsDb: -16 },
    SR
  )
  ok(stereo.left !== input.left && stereo.right !== input.right, 'new buffers')
  eq(maxAbsDiff(input.left, savedL), 0, 'left input untouched')
  eq(maxAbsDiff(input.right, savedR), 0, 'right input untouched')
})

test('masterChain: rejects unequal channels', () => {
  throws(
    () => masterChain({ left: new Float32Array(8), right: new Float32Array(4) }, {}, SR),
    'throws on channel mismatch'
  )
})

// ---- wav --------------------------------------------------------------------

test('encodeWav: RIFF/WAVE header bytes are exact', () => {
  const input = makeSine(1000, 440, -6)
  input.left[0] = 1
  input.right[0] = -1
  input.left[2] = 0.5
  input.left[3] = 1.5 // clips to 32767
  const bytes = encodeWav(input, SR)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (off, len) => String.fromCharCode(...bytes.subarray(off, off + len))
  eq(ascii(0, 4), 'RIFF', 'RIFF magic at byte 0')
  eq(ascii(8, 4), 'WAVE', 'WAVE at byte 8')
  eq(ascii(12, 4), 'fmt ', 'fmt chunk at byte 12')
  eq(ascii(36, 4), 'data', 'data chunk at byte 36')
  eq(view.getUint16(20, true), 1, 'PCM format')
  eq(view.getUint16(22, true), 2, '2 channels at byte 22')
  eq(view.getUint32(24, true), SR, 'sample rate')
  eq(view.getUint32(28, true), SR * 4, 'byte rate')
  eq(view.getUint16(32, true), 4, 'block align 4')
  eq(view.getUint16(34, true), 16, 'bits 16')
  eq(view.getUint32(40, true), 1000 * 4, 'data size')
  eq(view.getUint32(4, true), 36 + 1000 * 4, 'riff size')
  eq(bytes.length, 44 + 1000 * 4, 'total length 44 + samples*4')
  eq(view.getInt16(44, true), 32767, '1.0 -> 32767')
  eq(view.getInt16(46, true), -32767, '-1.0 -> -32767')
  eq(view.getInt16(52, true), 16384, '0.5 -> Math.round(16383.5) = 16384')
  eq(view.getInt16(56, true), 32767, '1.5 clipped -> 32767')
  eq(wavHeaderBytes(), 44, 'wavHeaderBytes() = 44')
})

test('encodeWav: rejects unequal buffers, bad rates, bad types', () => {
  throws(() => encodeWav({ left: new Float32Array(4), right: new Float32Array(8) }, SR), 'unequal buffers throw')
  throws(() => encodeWav(makeSilence(8), NaN), 'NaN sample rate throws')
  throws(() => encodeWav(makeSilence(8), Infinity), 'infinite sample rate throws')
  throws(() => encodeWav(makeSilence(8), 0), 'zero sample rate throws')
  throws(() => encodeWav({ left: [1, 2], right: [1, 2] }, SR), 'non-Float32Array throws')
})

test('encodeWav: does not mutate input', () => {
  const input = makeSine(64, 440, -6)
  const savedL = input.left.slice()
  const savedR = input.right.slice()
  encodeWav(input, SR)
  eq(maxAbsDiff(input.left, savedL), 0, 'left untouched')
  eq(maxAbsDiff(input.right, savedR), 0, 'right untouched')
})

report()
