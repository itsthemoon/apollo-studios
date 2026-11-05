// js/waves.js — decimated peak data for drawing a waveform excerpt.
//
// A take is scanned once into fixed buckets of |peak| and sum-of-squares. Every
// later frame reads that cache instead of the Float32Array, so a repaint costs
// a few hundred bucket reads no matter how long the take is. Pure: no DOM, no
// canvas, so scripts/selftest-waves.mjs can exercise it under node.
//
// Bucket *count* is capped, not the take length: a 5 M-sample take still lands
// in ~1e5 buckets (about 40 samples each), which is well under one screen pixel
// even at maximum zoom.

export const MAX_COLUMNS = 900
export const MIN_PX = 3
export const MAX_BUCKETS = 1 << 17

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

/** Scan a buffer into the peak/sumsq cache a region repaint reads from. */
export function buildCache(data, rate) {
  const len = data?.length || 0
  const bucketSize = Math.max(1, Math.ceil(len / MAX_BUCKETS))
  const count = len ? Math.ceil(len / bucketSize) : 0
  const peak = new Float32Array(count)
  const sumsq = new Float32Array(count)
  let ref = 0
  for (let b = 0; b < count; b++) {
    const from = b * bucketSize
    const to = Math.min(len, from + bucketSize)
    let p = 0
    let s = 0
    for (let i = from; i < to; i++) {
      const v = data[i]
      const a = v < 0 ? -v : v
      if (a > p) p = a
      s += v * v
    }
    peak[b] = p
    sumsq[b] = s
    if (p > ref) ref = p
  }
  /* the window is referenced below the true peak: a limited take lives within a
     couple of dB of it, and referencing the peak itself drew a flat wall */
  return { peak, sumsq, count, bucketSize, len, rate: Number(rate) || 0, ref: Math.max(ref * 0.72, 1e-4) }
}

/** How many beats a take of `seconds` occupies at `bpm` — its layout span. */
export function spanOf(seconds, bpm) {
  const tempo = Number(bpm) > 0 ? Number(bpm) : 96
  return Math.max(0, Number(seconds) || 0) * tempo / 60
}

/**
 * The take window a region covers. `spanBeats` is the beat length the take
 * itself is laid out over, which is not always `seconds * bpm / 60`: the demo
 * take is stretched across the lane, so its span is however many beats the clip
 * is wide. Mapping through that span keeps a split's two halves exactly over
 * the pixels they were cut from.
 */
export function windowOf(region, spanBeats, len) {
  const startBeat = Math.max(0, Number(region?.startBeat) || 0)
  const lengthBeats = Math.max(0, Number(region?.lengthBeats) || 0)
  const span = Number(spanBeats) > 0 ? Number(spanBeats) : 1
  const from = clamp((startBeat / span) * len, 0, len)
  const to = clamp(((startBeat + lengthBeats) / span) * len, 0, len)
  return { from, to, full: from <= 0 && to >= len }
}

/**
 * Decimate [from, to) to at most `cols` columns. Each column keeps the loudest
 * sample and the rms of the samples under it, so a dense take reads as a solid
 * shape and a sparse one keeps its silence.
 */
export function columns(cache, from, to, cols) {
  const n = Math.max(1, Math.min(MAX_COLUMNS, Math.round(Number(cols)) || 1))
  const peak = new Float32Array(n)
  const rms = new Float32Array(n)
  const start = clamp(from, 0, cache.len)
  const end = clamp(to, 0, cache.len)
  const span = end - start
  if (!(span > 0) || !cache.count) return { peak, rms, cols: n, empty: true }
  for (let x = 0; x < n; x++) {
    const a = start + (span * x) / n
    const b = start + (span * (x + 1)) / n
    const i0 = clamp(Math.floor(a / cache.bucketSize), 0, cache.count - 1)
    const i1 = clamp(Math.max(Math.ceil(b / cache.bucketSize), i0 + 1), 1, cache.count)
    let p = 0
    let s = 0
    for (let i = i0; i < i1; i++) {
      if (cache.peak[i] > p) p = cache.peak[i]
      s += cache.sumsq[i]
    }
    peak[x] = p
    rms[x] = Math.sqrt(s / Math.max(1, (i1 - i0) * cache.bucketSize))
  }
  return { peak, rms, cols: n, empty: false }
}

/** Envelope at column `x`: gain, multiplied by a linear fade in/out ramp. */
export function envAt(region, x, cols) {
  const len = Math.max(0, Number(region?.lengthBeats) || 0)
  const t = cols <= 1 ? 0 : clamp(x / (cols - 1), 0, 1)
  const fin = clamp(region?.fadeIn, 0, len) || 0
  const fout = clamp(region?.fadeOut, 0, len) || 0
  let ramp = 1
  if (fin > 0) ramp = Math.min(ramp, clamp((t * len) / fin, 0, 1))
  if (fout > 0) ramp = Math.min(ramp, clamp(((1 - t) * len) / fout, 0, 1))
  const gain = Number.isFinite(region?.gain) && region.gain >= 0 ? region.gain : 1
  return { gain, ramp, amp: gain * ramp }
}
