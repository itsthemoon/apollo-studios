// js/capture.js — mic recording, browser-only. Pure ESM, zero dependencies.
// Contract: js/contract.md (owner: input node).
//
// Browser globals are only touched inside functions, never at import time,
// so this module is safe to import from Node tests.
//
// Primary path: getUserMedia -> MediaRecorder -> Blob -> decodeAudioData.
// Fallback path: getUserMedia -> ScriptProcessorNode accumulation (used when
// MediaRecorder is unavailable or fails to construct/start).
// openInput() keeps one stream + analyser + monitor gain alive for the input
// column (meter, take drawing, monitoring); startRecording({ input }) reuses it.
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
 * Open the mic once and keep it open for the input column: an analyser for the
 * live meter / take drawing and a monitor gain that is the route to the master
 * output. Resolves { stream, ctx, analyser, monitor, sampleRate, settings,
 * setMonitorDb, close }. Rejects 'mic denied' / 'unsupported'.
 */
export async function openInput(options = {}) {
  if (!isSupported()) throw new Error('unsupported')

  const deviceId = typeof options.deviceId === 'string' ? options.deviceId : ''
  const channels = Math.min(2, Math.max(1, Number(options.channels) || 1))
  let stream
  try {
    stream = await window.navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: { ideal: channels },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (err) {
    throw new Error('mic denied')
  }

  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  if (ctx.state === 'suspended') {
    try { await ctx.resume() } catch (err) { /* autoplay policy; the meter idles */ }
  }

  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.4
  const monitor = ctx.createGain()
  monitor.gain.value = 0
  source.connect(analyser)
  // A muted path to the destination keeps the analyser pulled even while the
  // monitor is off; monitoring only lifts the gain.
  analyser.connect(monitor)
  monitor.connect(ctx.destination)

  /* Block peaks for the live take drawing. A ScriptProcessor runs on the audio
     thread, so it keeps producing shape while the tab is in the background and
     rAF/timers are throttled. */
  const live = { queue: [] }
  let tap = null
  const dead = ctx.createGain()
  dead.gain.value = 0
  if (typeof ctx.createScriptProcessor === 'function') {
    tap = ctx.createScriptProcessor(1024, 1, 1)
    tap.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0)
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = Math.abs(data[i])
        if (v > peak) peak = v
      }
      live.queue.push(peak)
      if (live.queue.length > 4000) live.queue.shift()
    }
    source.connect(tap)
    tap.connect(dead)
    dead.connect(ctx.destination)
  }

  const settings = () => {
    try {
      return stream.getAudioTracks()[0]?.getSettings() || {}
    } catch (err) {
      return {}
    }
  }

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    try {
      source.disconnect(); analyser.disconnect(); monitor.disconnect()
      if (tap) tap.disconnect()
      dead.disconnect()
    } catch (err) { /* best effort */ }
    stream.getTracks().forEach((t) => t.stop())
    closeContext(ctx)
  }

  return {
    stream,
    ctx,
    source,
    analyser,
    monitor,
    live: {
      drain() { return live.queue.splice(0) },
      clear() { live.queue.length = 0 },
    },
    sampleRate: ctx.sampleRate,
    settings,
    setMonitorDb(db) {
      const gain = Math.pow(10, (Number.isFinite(db) ? db : 0) / 20)
      try { monitor.gain.setTargetAtTime(gain, ctx.currentTime, 0.02) } catch (err) { monitor.gain.value = gain }
    },
    close,
  }
}

/**
 * Start recording from the mic. Resolves { stop, sampleRate, cancel }.
 * Pass { input } (from openInput) to reuse the armed input and its analyser;
 * the shared context/stream then stays open when recording stops.
 * stop(): Promise<Float32Array> — recorded mono audio at the context sample
 * rate. Safe to call once; repeated calls return the same promise.
 * cancel(): void — abort recording (stop() afterwards still resolves with
 * whatever audio was captured up to the abort).
 */
export async function startRecording(options = {}) {
  if (!isSupported()) throw new Error('unsupported')

  const shared = options.input && options.input.stream
  let stream = shared ? options.input.stream : null
  let ctx = shared ? options.input.ctx : null
  const channel = Number.isInteger(options.channel) ? Math.max(0, options.channel) : 0

  if (!shared) {
    try {
      stream = await window.navigator.mediaDevices.getUserMedia({
        audio: {
          ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
          channelCount: { ideal: channel > 0 ? 2 : 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch (err) {
      throw new Error('mic denied')
    }

    const Ctx = window.AudioContext || window.webkitAudioContext
    ctx = new Ctx()
    if (ctx.state === 'suspended') {
      try { ctx.resume() } catch (err) { /* autoplay policy; recording still works */ }
    }
  }

  const analyser = shared ? options.input.analyser : null
  const teardown = () => {
    if (shared) return
    stream.getTracks().forEach((t) => t.stop())
  }
  const common = { channel, teardown, analyser, shared }

  if (typeof window.MediaRecorder === 'function') {
    try {
      return mediaRecorderPath(stream, ctx, common)
    } catch (err) {
      // MediaRecorder construct/start failed — fall through to ScriptProcessor.
    }
  }
  if (typeof ctx.createScriptProcessor === 'function') {
    return scriptProcessorPath(stream, ctx, common)
  }

  teardown()
  closeContext(ctx)
  throw new Error('unsupported')
}

function mediaRecorderPath(stream, ctx, opts = {}) {
  if (typeof ctx.decodeAudioData !== 'function') throw new Error('unsupported')

  const channel = opts.channel || 0
  const teardown = opts.teardown || (() => {})
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
        teardown()
        let mono
        try {
          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' })
            const ab = await blob.arrayBuffer()
            // decodeAudioData resamples to the AudioContext rate.
            const decoded = await ctx.decodeAudioData(ab)
            mono = pickChannel(decoded, channel)
          } else {
            mono = new Float32Array(0)
          }
        } catch (err) {
          mono = new Float32Array(0)
        }
        if (!opts.shared) closeContext(ctx)
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

  return { stop, sampleRate: ctx.sampleRate, cancel, analyser: opts.analyser || null }
}

function scriptProcessorPath(stream, ctx, opts = {}) {
  const channel = opts.channel || 0
  const teardown = opts.teardown || (() => stream.getTracks().forEach((t) => t.stop()))
  const source = ctx.createMediaStreamSource(stream)
  const processor = ctx.createScriptProcessor(4096, 1, 1)
  const chunks = []
  let settled = false

  processor.onaudioprocess = (e) => {
    if (settled) return
    const ib = e.inputBuffer
    const len = ib.length
    const ch = ib.numberOfChannels
    const out = new Float32Array(len)
    if (channel < ch) {
      out.set(ib.getChannelData(channel))
    } else {
      for (let c = 0; c < ch; c++) {
        const d = ib.getChannelData(c)
        for (let i = 0; i < len; i++) out[i] += d[i]
      }
      if (ch > 1) {
        for (let i = 0; i < len; i++) out[i] /= ch
      }
    }
    chunks.push(out)
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
        try { source.disconnect(); processor.disconnect(); silent.disconnect() } catch (err) { /* best effort */ }
        teardown()
        const total = chunks.reduce((a, c) => a + c.length, 0)
        const out = new Float32Array(total)
        let off = 0
        for (const c of chunks) { out.set(c, off); off += c.length }
        if (!opts.shared) closeContext(ctx)
        resolve(out)
      })
    }
    return stopPromise
  }

  const cancel = () => {
    if (settled) return
    settled = true
    try { source.disconnect(); processor.disconnect(); silent.disconnect() } catch (err) { /* best effort */ }
    teardown()
    if (!opts.shared) closeContext(ctx)
  }

  return { stop, sampleRate: ctx.sampleRate, cancel, analyser: opts.analyser || null }
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

function pickChannel(buffer, channel) {
  if (channel > 0 && buffer.numberOfChannels > channel) {
    return Float32Array.from(buffer.getChannelData(channel))
  }
  return mixdownMono(buffer)
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
