// js/shifter.js — main-thread side of the real-time pitch shifter.
// Nothing here knows about notes; callers post semitones. When AudioWorklet is
// unavailable the callers fall back to `playbackRate`, which is why `ok` is a
// per-context flag rather than a hard error.
const loaded = new WeakMap()

export async function ready(ctx) {
  if (!ctx?.audioWorklet) return false
  if (loaded.has(ctx)) return loaded.get(ctx)
  let ok = true
  try {
    await ctx.audioWorklet.addModule('/js/shift-worklet.js')
  } catch {
    ok = false
  }
  loaded.set(ctx, ok)
  return ok
}

export function create(ctx, shift = 0) {
  const node = new AudioWorkletNode(ctx, 'pitch-shift', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
  })
  node.port.postMessage({ shift })
  return node
}

export function set(node, shift) {
  if (!node) return
  if (node.port) node.port.postMessage({ shift })
  else if (node.playbackRate) node.playbackRate.value = Math.pow(2, shift / 12)
}
