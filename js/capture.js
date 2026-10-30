// js/capture.js — mic recording, browser-only. Pure ESM, zero dependencies.
// Contract: js/contract.md (owner: input node).
//
// Browser globals are only touched inside functions, never at import time,
// so this module is safe to import from Node tests.
//
// Primary path: getUserMedia -> MediaRecorder -> Blob -> decodeAudioData.
// Fallback path: getUserMedia -> ScriptProcessorNode accumulation (used when
// MediaRecorder is unavailable or fails to construct/start).
// stop() resolves a mono Float32Array at the AudioContext sample rate.
// Errors are short lowercase messages: 'mic denied', 'unsupported'.

export function isSupported() {
  if (typeof window === 'undefined') return false
  const nav = window.navigator
  const md = nav && nav.mediaDevices
  if (!md || typeof md.getUserMedia !== 'function') return false
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (typeof Ctx !== 'function') return false
  if (typeof window.MediaRecorder === 'function') return true
  const proto = Ctx.prototype
  return Boolean(proto && typeof proto.createScriptProcessor === 'function')
}

/**
 * Start recording from the mic. Resolves { stop, sampleRate, cancel }.
 * stop(): Promise<Float32Array> — recorded mono audio at the context sample
 * rate. Safe to call once; repeated calls return the same promise.
 * cancel(): void — abort recording (stop() afterwards still resolves with
 * whatever audio was captured up to the abort).
 */
export async function startRecording() {
  if (!isSupported()) throw new Error('unsupported')

  let stream
  try {
    stream = await window.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false },
    })
  } catch (err) {
    throw new Error('mic denied')
  }

  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  if (ctx.state === 'suspended') {
    try { ctx.resume() } catch (err) { /* autoplay policy; recording still works */ }
  }

  if (typeof window.MediaRecorder === 'function') {
    try {
      return mediaRecorderPath(stream, ctx)
    } catch (err) {
      // MediaRecorder construct/start failed — fall through to ScriptProcessor.
    }
  }
  if (typeof ctx.createScriptProcessor === 'function') {
    return scriptProcessorPath(stream, ctx)
  }

  stream.getTracks().forEach((t) => t.stop())
  closeContext(ctx)
  throw new Error('unsupported')
}

function mediaRecorderPath(stream, ctx) {
  if (typeof ctx.decodeAudioData !== 'function') throw new Error('unsupported')

  const mime = pickMimeType()
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
  const chunks = []
  let stopEventResolve
  const stopEvent = new Promise((resolve) => { stopEventResolve = resolve })

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  }
  recorder.onerror = () => { stopEventResolve() }
  recorder.onstop = () => {
    stopEventResolve()
    finalize()
  }

  let finalizePromise = null
  const finalize = () => {
    if (!finalizePromise) {
      finalizePromise = (async () => {
        stream.getTracks().forEach((t) => t.stop())
        let mono
        try {
          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })
            const ab = await blob.arrayBuffer()
            // decodeAudioData resamples to the AudioContext rate.
            const decoded = await ctx.decodeAudioData(ab)
            mono = mixdownMono(decoded)
          } else {
            mono = new Float32Array(0)
          }
        } catch (err) {
          mono = new Float32Array(0)
        }
        closeContext(ctx)
        return mono
      })()
    }
    return finalizePromise
  }

  let stopPromise = null
  const stop = () => {
    if (!stopPromise) {
      stopPromise = (async () => {
        if (recorder.state !== 'inactive') {
          let stopped = false
          try { recorder.stop(); stopped = true } catch (err) { /* best effort */ }
          if (stopped) await stopEvent
        }
        return finalize()
      })()
    }
    return stopPromise
  }

  const cancel = () => {
    if (recorder.state !== 'inactive') {
      try { recorder.stop() } catch (err) { /* best effort */ }
    } else {
      finalize() // nothing was ever captured; still tear down the stream
    }
  }

  try {
    recorder.start(250) // periodic dataavailable so stop() never waits on the tail
  } catch (err) {
    throw new Error('unsupported')
  }

  return { stop, sampleRate: ctx.sampleRate, cancel }
}

function scriptProcessorPath(stream, ctx) {
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const chunks = []
  let settled = false

  processor.onaudioprocess = (e) => {
    if (settled) return
    const ib = e.inputBuffer
    const len = ib.length
    const ch = ib.numberOfChannels
    const mono = new Float32Array(len)
    for (let c = 0; c < ch; c++) {
      const d = ib.getChannelData(c)
      for (let i = 0; i < len; i++) mono[i] += d[i]
    }
    if (ch > 1) {
      for (let i = 0; i < len; i++) mono[i] /= ch
    }
    chunks.push(mono)
  }

  source.connect(processor)
  // Route to a muted destination so onaudioprocess fires without monitoring echo.
  const silent = ctx.createGain()
  silent.gain.value = 0
  processor.connect(silent)
  silent.connect(ctx.destination)

  let stopPromise = null
  const stop = () => {
    if (!stopPromise) {
      stopPromise = new Promise((resolve) => {
        settled = true
        try { source.disconnect(); processor.disconnect() } catch (err) { /* best effort */ }
        stream.getTracks().forEach((t) => t.stop())
        const total = chunks.reduce((a, c) => a + c.length, 0)
        const out = new Float32Array(total)
        let off = 0
        for (const c of chunks) { out.set(c, off); off += c.length }
        closeContext(ctx)
        resolve(out)
      })
    }
    return stopPromise
  }

  const cancel = () => {
    if (settled) return
    settled = true
    try { source.disconnect(); processor.disconnect() } catch (err) { /* best effort */ }
    stream.getTracks().forEach((t) => t.stop())
    closeContext(ctx)
  }

  return { stop, sampleRate: ctx.sampleRate, cancel }
}

function pickMimeType() {
  const MR = window.MediaRecorder
  if (typeof MR === 'undefined' || typeof MR.isTypeSupported !== 'function') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ]
  for (const t of candidates) {
    if (MR.isTypeSupported(t)) return t
  }
  return ''
}

function mixdownMono(buffer) {
  const ch = buffer.numberOfChannels
  const len = buffer.length
  const out = new Float32Array(len)
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += d[i]
  }
  if (ch > 1) {
    for (let i = 0; i < len; i++) out[i] /= ch
  }
  return out
}

function closeContext(ctx) {
  try {
    const p = ctx.close()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (err) { /* best effort */ }
}
