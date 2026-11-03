// scripts/selftest-shift.mjs — the worklet DSP, run outside a browser.
// Does process() actually move pitch, and does a later message retune it?
import { test, near, ok, report } from './lib/assert.mjs'

let register = null
globalThis.sampleRate = 48000
globalThis.AudioWorkletProcessor = class {
  constructor () {
    const handlers = []
    this.port = {
      postMessage: () => {},
      set onmessage (h) { handlers[0] = h },
      get onmessage () { return handlers[0] },
    }
  }
}
globalThis.registerProcessor = (_name, cls) => { register = cls }

await import('../js/shift-worklet.js')
const Proc = register
ok(typeof Proc === 'function', 'processor registers')

const f0 = (block) => {
  // autocorrelation, strongest peak in the guitar-to-vocal lag range
  let best = 0, lag0 = 0
  for (let lag = 60; lag < 700; lag++) {
    let sum = 0
    for (let i = 0; i < block.length - lag; i++) sum += block[i] * block[i + lag]
    if (sum > best) { best = sum; lag0 = lag }
  }
  return 48000 / lag0
}

const SETTLE = 40 * 128 // grains need a few blocks before they hold signal
const feed = (proc, frames) => {
  const out = []
  for (let f = 0; f < frames; f++) {
    const block = new Float32Array(128)
    for (let i = 0; i < 128; i++) block[i] = Math.sin((2 * Math.PI * 220 * (f * 128 + i)) / 48000)
    const dst = new Float32Array(128)
    proc.process([[block]], [[dst]])
    out.push(...dst)
  }
  return out
}
const at = (shift) => {
  const proc = new Proc()
  proc.target = shift
  proc.shift = shift
  return f0(feed(proc, 120).slice(SETTLE))
}

test('rate 1 passes the tone through', () => {
  near(at(0), 220, 6)
})

test('+12 semitones doubles the frequency', () => {
  near(at(12), 440, 20)
})

test('-12 semitones halves it', () => {
  near(at(-12), 110, 8)
})

test('a message retunes a running processor', () => {
  const proc = new Proc()
  proc.shift = 0
  proc.target = 0
  feed(proc, 80)
  proc.port.onmessage({ data: { shift: 12 } })
  near(f0(feed(proc, 120).slice(SETTLE)), 440, 25)
})

report()
