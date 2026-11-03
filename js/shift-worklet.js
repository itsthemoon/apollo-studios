// js/shift-worklet.js — real-time pitch shifter for apollo-studios.
// Ring buffer, two 70 ms grains read half a cycle apart and crossfaded, each
// grain's pointer advancing at the pitch ratio. One node per playing note; the
// main thread posts `{ shift }` in semitones and the grains follow, glided so a
// slider drag is audible without stepping.
const DEPTH_S = 0.07
const GLIDE = 0.08

class ShiftProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.ring = new Float32Array(Math.round(sampleRate * 0.3))
    this.size = this.ring.length
    this.w = 0
    this.phase = 0
    this.shift = 0
    this.target = 0
    this.depth = Math.round(sampleRate * DEPTH_S)
    this.rp = [-this.depth, -Math.round(this.depth / 2)]
    this.port.onmessage = (e) => {
      if (Number.isFinite(e.data?.shift)) this.target = e.data.shift
    }
  }

  // wrapped distance behind the write head, in samples
  behind(pos) {
    let d = this.w - pos
    d %= this.size
    if (d < 1) d += this.size
    return d
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0]
    const out = outputs[0]?.[0]
    if (!input || !out) return true
    const ring = this.ring
    this.shift += (this.target - this.shift) * GLIDE
    const ratio = Math.pow(2, this.shift / 12)
    for (let i = 0; i < out.length; i++) {
      ring[this.w] = input[i]
      this.phase += 1
      if (this.phase >= this.depth) this.phase -= this.depth
      let sum = 0
      for (let g = 0; g < 2; g++) {
        const p = (this.phase / this.depth + g * 0.5) % 1
        // a grain that just wrapped restarts at the oldest safe sample
        if (this.phase < ratio + 1) this.rp[g] = this.w - this.depth
        this.rp[g] = (this.rp[g] + ratio) % this.size
        const d = this.behind(this.rp[g])
        const read = (this.w - Math.min(d, this.size - 1) + this.size) % this.size
        const i0 = Math.floor(read)
        const fx = read - i0
        const a = ring[i0 % this.size]
        const b = ring[(i0 + 1) % this.size]
        const w = 1 - Math.abs(2 * p - 1) // triangular: silent at grain edges
        sum += (a + (b - a) * fx) * w
      }
      out[i] = sum
      this.w = (this.w + 1) % this.size
    }
    return true
  }
}
registerProcessor('pitch-shift', ShiftProcessor)
