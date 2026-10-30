// js/pitch.js — pitch detection, pure ESM, zero dependencies.
// Contract: js/contract.md (owner: input node).
//
// detectPitch: normalized autocorrelation (direct summation, no FFT),
// Hann-windowed input, lags searched for 70..1000 Hz (lag = sampleRate / hz),
// parabolic refinement on the three samples around the correlation peak.
// detectNotes: frame-based note segmentation with 50-cent merging.
//
// Both functions are pure: no browser globals, no mutation of inputs,
// sample rate is always passed explicitly, never hardcoded.

export function detectPitch(buf, sampleRate) {
  if (!(buf instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { hz: 0, clarity: 0 }
  }
  const n = buf.length
  if (n < 2) return { hz: 0, clarity: 0 }

  // Hann window the input; reject non-finite samples; energy = r(0).
  const w = new Float64Array(n)
  let energy = 0
  for (let i = 0; i < n; i++) {
    const s = buf[i]
    if (!Number.isFinite(s)) return { hz: 0, clarity: 0 }
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    w[i] = s * hann
    energy += w[i] * w[i]
  }
  if (!(energy > 0)) return { hz: 0, clarity: 0 }

  // Lag range covering 70..1000 Hz.
  const minLag = Math.max(1, Math.ceil(sampleRate / 1000))
  const maxLag = Math.min(Math.floor(sampleRate / 70), n - 1)
  if (minLag > maxLag) return { hz: 0, clarity: 0 }

  // Direct-summation ACF, normalized by energy. Strictly-greater keeps the
  // smallest lag on ties, which prefers the fundamental over subharmonics.
  const r = new Float64Array(maxLag + 1)
  let bestLag = -1
  let best = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += w[i] * w[i + lag]
    const norm = sum / energy
    r[lag] = norm
    if (norm > best) {
      best = norm
      bestLag = lag
    }
  }

  // Parabolic interpolation on the three samples around the peak.
  let refinedLag = bestLag
  let clarity = best
  if (bestLag > minLag && bestLag < maxLag) {
    const ym = r[bestLag - 1]
    const yp = r[bestLag + 1]
    const denom = ym - 2 * best + yp
    if (denom < 0) {
      const offset = 0.5 * (ym - yp) / denom
      if (Number.isFinite(offset) && offset > -1 && offset < 1) {
        refinedLag = bestLag + offset
        clarity = best - 0.25 * denom * offset * offset
      }
    }
  }

  const hz = clarity < 0.5 ? 0 : sampleRate / refinedLag
  return { hz, clarity: Math.min(1, clarity) }
}

const DEFAULT_OPTS = { frame: 2048, hop: 512, minClarity: 0.5, minDur: 0.06 }
const CENTS_MERGE = 50

/**
 * Segment a buffer into notes. Frames the buffer, detects pitch per frame,
 * merges consecutive frames whose pitch is within 50 cents, drops notes
 * shorter than minDur. start/dur are in seconds; output sorted by start.
 */
export function detectNotes(buf, sampleRate, opts) {
  if (!(buf instanceof Float32Array) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return []
  }
  const o = opts || {}
  const frame = numOr(o.frame, DEFAULT_OPTS.frame)
  const hop = numOr(o.hop, DEFAULT_OPTS.hop)
  const minClarity = numOr(o.minClarity, DEFAULT_OPTS.minClarity)
  const minDur = numOr(o.minDur, DEFAULT_OPTS.minDur)
  if (!(frame > 0) || !(hop > 0)) return []

  const n = buf.length
  const f = Math.min(frame, n)
  const notes = []
  let cur = null

  const flush = () => {
    if (!cur) return
    const start = cur.startSample / sampleRate
    const dur = (cur.lastStart + f - cur.startSample) / sampleRate
    if (dur >= minDur) {
      // Geometric mean keeps averaging correct in the log-pitch domain.
      const hz = Math.exp(cur.logSum / cur.count)
      notes.push({ start, dur, hz, midi: 69 + 12 * Math.log2(hz / 440) })
    }
    cur = null
  }

  for (let start = 0; start + f <= n; start += hop) {
    const { hz, clarity } = detectPitch(buf.subarray(start, start + f), sampleRate)
    if (hz > 0 && clarity >= minClarity) {
      if (cur && Math.abs(1200 * Math.log2(hz / cur.lastHz)) <= CENTS_MERGE) {
        cur.logSum += Math.log(hz)
        cur.count += 1
        cur.lastStart = start
        cur.lastHz = hz
      } else {
        flush()
        cur = { startSample: start, lastStart: start, logSum: Math.log(hz), count: 1, lastHz: hz }
      }
    } else {
      flush()
    }
  }
  flush()
  return notes
}

function numOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback
}
