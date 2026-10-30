// js/stems.js — crude transient/sustained split for apollo-studios (stems node).
// Contract: js/contract-appendix.md.
//
// THIS IS A CRUDE SPLIT, NOT A MODEL. No network, no training data, nothing
// learned: it is the median-filter heuristic (FitzGerald 2010, "HPSS") applied
// to an STFT, which is good at "hit vs. hold" and bad at everything else.
// Expect bright sustained material to stay in `bed`, expect smeared attacks and
// expect no vocal isolation — this cannot pull a voice out of a mix.
//
// Method, exactly as contracted:
//   1. frames of 2048 samples, hop 512, periodic Hann analysis + synthesis.
//   2. per bin, the magnitude is compared with the median magnitude of that
//      same bin across 3 neighbour frames on each side (a 7-point median,
//      clamped at the edges). Three frames on each side rather than three in
//      total because the window spans four hops: a hit shorter than the window
//      still shows in the frames next to it, so a 3-point median calls it
//      sustained and the split collapses.
//   3. median            -> sustained / harmonic -> `bed`
//      magnitude - median -> transient / residual -> `leads`
//      kept as a soft Wiener mask squared so phase survives and the two layers
//      add back together.
//   4. inverse FFT, overlap-add, divide by the accumulated window sum (constant
//      1.5 at this hop for a periodic Hann) so the split is gain-neutral.
//
// `leads` is the attack/noise/breath layer and `bed` the sustained layer; the
// names describe the role, not a frequency band. `leads` is written as the
// sample-wise remainder so recombine() is exact to float rounding.
//
// Pure: no browser globals, inputs never mutated, sample rate passed in.

const FRAME = 2048
const HOP = 512
const PAD = FRAME // zero padding so every real sample gets full 4-frame coverage
const BINS = FRAME / 2 + 1

let tables = null

const clean = (v) => (Number.isFinite(v) ? v : 0)

function checkRate(sampleRate) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('sample rate must be a positive finite number')
  }
  return sampleRate
}

// Periodic Hann: w[i] = 0.5 - 0.5 cos(2*pi*i/N). Squared over a hop of N/4 it
// sums to exactly 1.5, which is the normalisation the overlap-add divides by.
function hann() {
  const w = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)
  return w
}

// Iterative radix-2 Cooley-Tukey. Tables are built once for the fixed size.
function fftTables() {
  if (tables) return tables
  const bits = Math.round(Math.log2(FRAME))
  const rev = new Uint32Array(FRAME)
  for (let i = 0; i < FRAME; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1)
    rev[i] = r
  }
  const cos = new Float64Array(FRAME / 2)
  const sin = new Float64Array(FRAME / 2)
  for (let i = 0; i < FRAME / 2; i++) {
    const a = (2 * Math.PI * i) / FRAME
    cos[i] = Math.cos(a)
    sin[i] = Math.sin(a)
  }
  tables = { rev, cos, sin }
  return tables
}

// In-place transform of re/im. `inverse` conjugates the twiddles and scales.
function runFft(re, im, t, inverse) {
  const { rev, cos, sin } = t
  for (let i = 0; i < FRAME; i++) {
    const j = rev[i]
    if (j > i) {
      let x = re[i]
      re[i] = re[j]
      re[j] = x
      x = im[i]
      im[i] = im[j]
      im[j] = x
    }
  }
  const sign = inverse ? 1 : -1
  for (let size = 2; size <= FRAME; size <<= 1) {
    const half = size >> 1
    const step = FRAME / size
    for (let start = 0; start < FRAME; start += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const c = cos[k]
        const s = sign * sin[k]
        const a = start + j
        const b = a + half
        const tr = c * re[b] - s * im[b]
        const ti = c * im[b] + s * re[b]
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < FRAME; i++) {
      re[i] /= FRAME
      im[i] /= FRAME
    }
  }
}

const NEIGHBOURS = 3
const medianScratch = new Float64Array(2 * NEIGHBOURS + 1)

const clampFrame = (f, frames) => (f < 0 ? 0 : f >= frames ? frames - 1 : f)

// Insertion sort of the scratch window, then the middle element.
function medianWindow() {
  const s = medianScratch
  for (let i = 1; i < s.length; i++) {
    const v = s[i]
    let j = i - 1
    while (j >= 0 && s[j] > v) {
      s[j + 1] = s[j]
      j--
    }
    s[j + 1] = v
  }
  return s[NEIGHBOURS]
}

// Split one take into a transient layer and a sustained layer.
// Returns `{ leads, bed }`: new Float32Arrays of exactly the input length.
export function splitStems(take, sampleRate) {
  if (!(take instanceof Float32Array)) throw new Error('take must be a Float32Array')
  checkRate(sampleRate)

  const n = take.length
  if (n === 0) return { leads: new Float32Array(0), bed: new Float32Array(0) }

  const frames = Math.ceil((n + 2 * PAD) / HOP)
  const paddedLen = frames * HOP + FRAME
  const padded = new Float64Array(paddedLen)
  for (let i = 0; i < n; i++) padded[PAD + i] = clean(take[i])

  const win = hann()
  const t = fftTables()
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const acc = new Float64Array(paddedLen)
  const winSum = new Float64Array(paddedLen)
  const mags = new Float32Array(frames * BINS)

  // Pass 1: magnitudes for the median neighbourhood.
  for (let f = 0; f < frames; f++) {
    const start = f * HOP
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < FRAME; i++) re[i] = padded[start + i] * win[i]
    runFft(re, im, t, false)
    const row = f * BINS
    for (let k = 0; k < BINS; k++) mags[row + k] = Math.hypot(re[k], im[k])
  }

  // Pass 2: mask against the 7-frame median, inverse, window and overlap-add.
  // The median layer (mask h) rebuilds `bed`; `leads` is its sample-wise
  // remainder, so the residual is exactly what the median filter did not take.
  for (let f = 0; f < frames; f++) {
    const start = f * HOP
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < FRAME; i++) re[i] = padded[start + i] * win[i]
    runFft(re, im, t, false)

    const row = f * BINS
    for (let k = 0; k < BINS; k++) {
      const mag = mags[row + k]
      for (let d = -NEIGHBOURS; d <= NEIGHBOURS; d++) {
        const g = clampFrame(f + d, frames)
        medianScratch[d + NEIGHBOURS] = mags[g * BINS + k]
      }
      const med = medianWindow()
      const residual = mag > med ? mag - med : 0
      // Wiener mask, squared: keeps the layers soft so nothing sounds gated.
      const raw = mag > 0 ? (med * med) / (med * med + residual * residual + 1e-30) : 0
      const h = raw * raw
      re[k] *= h
      im[k] *= h
      if (k > 0 && k < FRAME / 2) {
        const mirror = FRAME - k
        re[mirror] = re[k]
        im[mirror] = -im[k]
      }
    }

    runFft(re, im, t, true)
    for (let i = 0; i < FRAME; i++) {
      const w = win[i]
      acc[start + i] += re[i] * w
      winSum[start + i] += w * w
    }
  }

  const bed = new Float32Array(n)
  const leads = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = PAD + i
    const sum = winSum[p]
    const harmonic = sum > 1e-12 ? acc[p] / sum : padded[p]
    const h32 = Number.isFinite(harmonic) ? harmonic : 0
    bed[i] = h32
    leads[i] = padded[p] - h32
  }
  return { leads, bed }
}

// Sum the two layers sample-wise into a new buffer.
export function recombine(stems) {
  if (!stems || !(stems.leads instanceof Float32Array) || !(stems.bed instanceof Float32Array)) {
    throw new Error('stems must be { leads, bed } Float32Arrays')
  }
  if (stems.leads.length !== stems.bed.length) throw new Error('stem lengths differ')
  const out = new Float32Array(stems.leads.length)
  for (let i = 0; i < out.length; i++) out[i] = clean(stems.leads[i]) + clean(stems.bed[i])
  return out
}
