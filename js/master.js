// master.js — apollo-studios master bus: EQ -> compressor -> RMS normalise -> limiter.
// Pure ESM, dependency-free, runs under plain Node 22 and in the browser.
// Stereo is { left: Float32Array, right: Float32Array } with equal lengths and
// samples in [-1, 1]. No exported function mutates or aliases its inputs.

const KNEE_DB = 6                    // soft-knee width above the compressor threshold
const NORMALIZE_GAIN_CAP_DB = 24     // maximum boost normalizeRms will apply (+24 dB)
const LIMITER_RELEASE_SAMPLES = 1024 // limiter one-pole release time constant (samples)
const LIMITER_RELEASE = 1 - Math.exp(-1 / LIMITER_RELEASE_SAMPLES)
const DEFAULT_Q = Math.SQRT1_2       // 0.7071...
const EQ_KINDS = new Set(['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass'])

const dbToLin = (db) => 10 ** (db / 20)
const clean = (v) => (Number.isFinite(v) ? v : 0)

function validateStereo(stereo) {
  if (!stereo || !(stereo.left instanceof Float32Array) || !(stereo.right instanceof Float32Array)) {
    throw new Error('stereo must be { left, right } Float32Arrays')
  }
  if (stereo.left.length !== stereo.right.length) {
    throw new Error('stereo channels must have equal length')
  }
}

function validateRate(sampleRate, fn) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`${fn}: sample rate must be a positive finite number`)
  }
  return sampleRate
}

// ---- analysis ---------------------------------------------------------------

// Peak and RMS in dBFS over both channels. -Infinity (never NaN) when silent.
export function analyze(stereo) {
  validateStereo(stereo)
  let peak = 0
  let sumSquares = 0
  for (let i = 0; i < stereo.left.length; i++) {
    const l = Math.abs(clean(stereo.left[i]))
    const r = Math.abs(clean(stereo.right[i]))
    if (l > peak) peak = l
    if (r > peak) peak = r
    sumSquares += l * l + r * r
  }
  const frames = stereo.left.length
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity
  const rmsDb = frames > 0 && sumSquares > 0 ? 20 * Math.log10(Math.sqrt(sumSquares / (2 * frames))) : -Infinity
  return { peakDb, rmsDb }
}

// ---- EQ ---------------------------------------------------------------------

// RBJ audio-EQ-cookbook coefficients, a0 normalised to 1.
// Returns { b0, b1, b2, a1, a2 } for direct form 1:
//   y[n] = b0·x[n] + b1·x[n-1] + b2·x[n-2] − a1·y[n-1] − a2·y[n-2]
// freq is clamped below Nyquist; q <= 0 falls back to 0.7071.
export function biquadCoeffs(kind, freq, q, gainDb, sampleRate) {
  const sr = validateRate(sampleRate, 'biquadCoeffs')
  if (!EQ_KINDS.has(kind)) throw new Error('unknown eq band kind')
  const nyquist = sr / 2
  let f = Number.isFinite(freq) ? freq : 1000
  if (f <= 0) f = 1
  if (f >= nyquist) f = nyquist * 0.999
  const Q = Number.isFinite(q) && q > 0 ? q : DEFAULT_Q
  const A = dbToLin((Number.isFinite(gainDb) ? gainDb : 0) / 2) // 10^(gainDb/40)
  const w0 = (2 * Math.PI * f) / sr
  const cosw = Math.cos(w0)
  const sinw = Math.sin(w0)
  const alpha = sinw / (2 * Q)
  const twoSqrtA = 2 * Math.sqrt(A)
  let b0, b1, b2, a0, a1, a2
  switch (kind) {
    case 'lowpass':
      b0 = (1 - cosw) / 2
      b1 = 1 - cosw
      b2 = (1 - cosw) / 2
      a0 = 1 + alpha
      a1 = -2 * cosw
      a2 = 1 - alpha
      break
    case 'highpass':
      b0 = (1 + cosw) / 2
      b1 = -(1 + cosw)
      b2 = (1 + cosw) / 2
      a0 = 1 + alpha
      a1 = -2 * cosw
      a2 = 1 - alpha
      break
    case 'lowshelf':
      b0 = A * ((A + 1) - (A - 1) * cosw + twoSqrtA * alpha)
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw)
      b2 = A * ((A + 1) - (A - 1) * cosw - twoSqrtA * alpha)
      a0 = (A + 1) + (A - 1) * cosw + twoSqrtA * alpha
      a1 = -2 * ((A - 1) + (A + 1) * cosw)
      a2 = (A + 1) + (A - 1) * cosw - twoSqrtA * alpha
      break
    case 'peaking':
      b0 = 1 + alpha * A
      b1 = -2 * cosw
      b2 = 1 - alpha * A
      a0 = 1 + alpha / A
      a1 = -2 * cosw
      a2 = 1 - alpha / A
      break
    case 'highshelf':
      b0 = A * ((A + 1) + (A - 1) * cosw + twoSqrtA * alpha)
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw)
      b2 = A * ((A + 1) + (A - 1) * cosw - twoSqrtA * alpha)
      a0 = (A + 1) - (A - 1) * cosw + twoSqrtA * alpha
      a1 = 2 * ((A - 1) - (A + 1) * cosw)
      a2 = (A + 1) - (A - 1) * cosw - twoSqrtA * alpha
      break
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

function runBiquad(input, c) {
  const out = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = clean(input[i])
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    out[i] = y
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
  }
  return out
}

// Bands run in series, each as a per-channel direct-form-1 biquad. New buffers.
export function applyEQ(stereo, bands, sampleRate) {
  validateStereo(stereo)
  const sr = validateRate(sampleRate, 'applyEQ')
  let left = Float32Array.from(stereo.left)
  let right = Float32Array.from(stereo.right)
  for (const band of bands ?? []) {
    const c = biquadCoeffs(band.kind, band.freq, band.q, band.gainDb, sr)
    left = runBiquad(left, c)
    right = runBiquad(right, c)
  }
  return { left, right }
}

// ---- compressor -------------------------------------------------------------

// Per-sample stereo-linked envelope follower. Gain from threshold/ratio with a
// soft knee that starts exactly at the threshold, so a signal below threshold is
// bit-for-bit unity. Makeup gain applied at the end. Stable on silence.
export function compress(stereo, opts, sampleRate) {
  validateStereo(stereo)
  const sr = validateRate(sampleRate, 'compress')
  const o = opts ?? {}
  const thresholdDb = Number.isFinite(o.thresholdDb) ? o.thresholdDb : -12
  const ratio = Number.isFinite(o.ratio) && o.ratio > 1 ? o.ratio : 2
  const attackMs = Number.isFinite(o.attackMs) ? Math.max(0, o.attackMs) : 10
  const releaseMs = Number.isFinite(o.releaseMs) ? Math.max(0, o.releaseMs) : 120
  const makeupDb = Number.isFinite(o.makeupDb) ? o.makeupDb : 0
  const slope = 1 - 1 / ratio
  const attack = attackMs > 0 ? 1 - Math.exp(-1 / ((attackMs / 1000) * sr)) : 1
  const release = releaseMs > 0 ? 1 - Math.exp(-1 / ((releaseMs / 1000) * sr)) : 1
  const makeupGain = dbToLin(makeupDb)
  const n = stereo.left.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  let env = 0
  for (let i = 0; i < n; i++) {
    const l = clean(stereo.left[i])
    const r = clean(stereo.right[i])
    const level = Math.max(Math.abs(l), Math.abs(r))
    const coef = level > env ? attack : release
    env = coef * level + (1 - coef) * env
    const envDb = env > 0 ? 20 * Math.log10(env) : -Infinity
    const over = envDb - thresholdDb
    let gainDb = 0
    if (over > 0) {
      gainDb = over < KNEE_DB ? (-slope * over * over) / (2 * KNEE_DB) : -slope * (over - KNEE_DB / 2)
    }
    const g = makeupGain * dbToLin(gainDb)
    left[i] = l * g
    right[i] = r * g
  }
  return { left, right }
}

// ---- limiter ----------------------------------------------------------------

// Lookahead-free peak limiter. Instant attack (gain reduction), short one-pole
// release so the gain does not chatter, then a hard clamp so no sample exceeds
// the ceiling. Stereo-linked. ceilingDb is clamped to 0 dBFS.
export function limit(stereo, ceilingDb) {
  validateStereo(stereo)
  const ceiling = dbToLin(Number.isFinite(ceilingDb) ? Math.min(ceilingDb, 0) : 0)
  const n = stereo.left.length
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  let env = 1
  for (let i = 0; i < n; i++) {
    const l = clean(stereo.left[i])
    const r = clean(stereo.right[i])
    const level = Math.max(Math.abs(l), Math.abs(r))
    const needed = level > 0 ? ceiling / level : 1
    if (needed < env) env = needed
    else env += (1 - env) * LIMITER_RELEASE
    let yl = l * env
    let yr = r * env
    if (yl > ceiling) yl = ceiling
    else if (yl < -ceiling) yl = -ceiling
    if (yr > ceiling) yr = ceiling
    else if (yr < -ceiling) yr = -ceiling
    left[i] = yl
    right[i] = yr
  }
  return { left, right }
}

// ---- RMS normalisation ------------------------------------------------------

// Measures stereo RMS, returns { stereo, gainDb } where the scaled buffers move
// RMS to targetDb. Gain is capped at +24 dB; silence gets gain 0.
export function normalizeRms(stereo, targetDb) {
  validateStereo(stereo)
  const target = Number.isFinite(targetDb) ? targetDb : -14
  const n = stereo.left.length
  let sumSquares = 0
  for (let i = 0; i < n; i++) {
    const l = clean(stereo.left[i])
    const r = clean(stereo.right[i])
    sumSquares += l * l + r * r
  }
  if (n === 0 || sumSquares === 0) {
    return {
      stereo: { left: Float32Array.from(stereo.left), right: Float32Array.from(stereo.right) },
      gainDb: 0,
    }
  }
  const rmsDb = 20 * Math.log10(Math.sqrt(sumSquares / (2 * n)))
  let gainDb = target - rmsDb
  if (gainDb > NORMALIZE_GAIN_CAP_DB) gainDb = NORMALIZE_GAIN_CAP_DB
  const g = dbToLin(gainDb)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    left[i] = clean(stereo.left[i]) * g
    right[i] = clean(stereo.right[i]) * g
  }
  return { stereo: { left, right }, gainDb }
}

// ---- master chain -----------------------------------------------------------

// Chain: EQ -> compress -> normalizeRms -> limit.
// settings: {
//   eq: [{ kind, freq, q, gainDb }],                        // default []
//   comp: { thresholdDb, ratio, attackMs, releaseMs, makeupDb },  // all optional
//   limitDb: number,                                        // default 0 (0 dBFS ceiling)
//   targetRmsDb: number,                                    // default -14
// }
// report.gainDb is the static gain applied (comp makeup + normalise gain);
// peakDb/rmsDb are measured on the final, post-limiter output.
export function masterChain(stereo, settings, sampleRate) {
  validateStereo(stereo)
  const sr = validateRate(sampleRate, 'masterChain')
  const s = settings ?? {}
  const comp = { thresholdDb: -12, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 0, ...(s.comp ?? {}) }
  const limitDb = Number.isFinite(s.limitDb) ? s.limitDb : 0
  const targetRmsDb = Number.isFinite(s.targetRmsDb) ? s.targetRmsDb : -14
  const makeupDb = Number.isFinite(comp.makeupDb) ? comp.makeupDb : 0

  let cur = applyEQ(stereo, s.eq ?? [], sr)
  cur = compress(cur, comp, sr)
  const normalized = normalizeRms(cur, targetRmsDb)
  const out = limit(normalized.stereo, limitDb)
  const { peakDb, rmsDb } = analyze(out)
  return { stereo: out, report: { peakDb, rmsDb, gainDb: normalized.gainDb + makeupDb } }
}
