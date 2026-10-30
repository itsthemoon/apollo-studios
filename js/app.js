// js/app.js — the only DOM-coupled module. Wires index.html to the pure modules.
import * as capture from './capture.js'
import * as pitch from './pitch.js'
import * as tune from './tune.js'
import * as presets from './presets.js'
import { masterChain } from './master.js'
import { encodeWav } from './wav.js'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const DIVISION = 4
const $ = (id) => document.getElementById(id)

const state = {
  notes: [],
  take: null,
  sampleRate: 48000,
  bands: [],
  selected: null,
  rec: null,
  playing: [],
  ctx: null,
}

// ---- helpers ---------------------------------------------------------------
function log(msg) {
  const el = $('log')
  el.textContent = (el.textContent ? el.textContent + '\n' : '') + msg
  el.scrollTop = el.scrollHeight
}

function status(text) { $('status').textContent = text }

function noteName(midi) {
  const m = Math.round(midi)
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

function guard(fn) {
  return async (event) => {
    try { await fn(event) } catch (err) { log(err?.message || String(err)) }
  }
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// ---- master settings from the panel ---------------------------------------
function settings() {
  return {
    eq: state.bands.map(b => ({ ...b })),
    comp: {
      thresholdDb: Number($('in-thresh').value),
      ratio: Number($('in-ratio').value),
      attackMs: 8,
      releaseMs: 140,
      makeupDb: 0,
    },
    limitDb: Number($('in-ceiling').value),
    targetRmsDb: Number($('in-target').value),
    vocalGainDb: Number($('in-gain').value),
  }
}

function stereoFrom(take) {
  return { left: Float32Array.from(take), right: Float32Array.from(take) }
}

// ---- rendering -------------------------------------------------------------
function renderBands() {
  const host = $('eq-bands')
  host.innerHTML = ''
  state.bands.forEach((band, i) => {
    const row = document.createElement('div')
    row.className = 'band'
    row.innerHTML = `
      <span>${band.kind}</span>
      <input type="range" min="30" max="16000" step="1" value="${band.freq}">
      <input type="range" min="-12" max="12" step="0.1" value="${band.gainDb}">
      <output>${band.gainDb.toFixed(1)} dB</output>`
    const [freq, gain] = row.querySelectorAll('input')
    freq.addEventListener('input', () => { band.freq = Number(freq.value) })
    gain.addEventListener('input', () => {
      band.gainDb = Number(gain.value)
      row.querySelector('output').textContent = `${band.gainDb.toFixed(1)} dB`
    })
    host.append(row)
  })
}

function renderNotes() {
  const host = $('note-list')
  host.innerHTML = ''
  state.notes.forEach((note, i) => {
    const row = document.createElement('div')
    row.className = 'note' + (i === state.selected ? ' sel' : '')
    const start = note.start.toFixed(2)
    const cents = Number.isFinite(note.cents) ? `${note.cents > 0 ? '+' : ''}${note.cents.toFixed(0)}c` : '0c'
    row.innerHTML = `<span>${start}s</span><span>${noteName(note.midi)}</span><span>${cents}</span><button>Del</button>`
    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') { state.notes.splice(i, 1); state.selected = null }
      else state.selected = i
      renderNotes()
    })
    host.append(row)
  })
  $('note-count').textContent = state.notes.length ? `${state.notes.length} notes` : 'no notes'
  $('btn-play').disabled = !state.notes.length
  syncTuning()
}

function syncTuning() {
  const root = Number($('in-root').value)
  const scale = $('in-scale').value
  const amount = Number($('in-snap').value) / 100
  state.notes = tune.snapStrength(state.notes, { root, scale, amount })
  if ($('in-quantize').checked) {
    state.notes = tune.quantizeStarts(state.notes, { bpm: Number($('in-bpm').value), division: DIVISION })
  }
}

function drawWave() {
  const canvas = $('wave')
  const g = canvas.getContext('2d')
  g.fillStyle = '#0e0e13'
  g.fillRect(0, 0, canvas.width, canvas.height)
  if (!state.take?.length) return
  g.strokeStyle = '#bf5af2'
  g.beginPath()
  const step = Math.max(1, Math.floor(state.take.length / canvas.width))
  for (let x = 0; x < canvas.width; x++) {
    let peak = 0
    for (let i = x * step; i < (x + 1) * step && i < state.take.length; i++) {
      peak = Math.max(peak, Math.abs(state.take[i]))
    }
    const y = (1 - peak) * (canvas.height / 2)
    x === 0 ? g.moveTo(0, canvas.height / 2 - (canvas.height / 2 - y)) : g.lineTo(x, y)
  }
  g.stroke()
  // mirror line for readability
  g.strokeStyle = 'rgba(236,236,242,.12)'
  g.beginPath()
  g.moveTo(0, canvas.height / 2)
  g.lineTo(canvas.width, canvas.height / 2)
  g.stroke()
}

function readMeter() {
  if (!state.take?.length) return
  const { report } = masterChain(stereoFrom(state.take), settings(), state.sampleRate)
  const peak = report.peakDb
  const rms = report.rmsDb
  $('meter-peak').textContent = Number.isFinite(peak) ? `${peak.toFixed(1)} dB` : '-inf'
  $('meter-rms').textContent = Number.isFinite(rms) ? `${rms.toFixed(1)} dB` : '-inf'
  $('meter-gain').textContent = `${report.gainDb.toFixed(1)} dB`
  const target = Number($('in-target').value)
  $('meter-peak').className = peak > -1 ? 'hot' : ''
  $('meter-rms').className = Math.abs(rms - target) <= 1 ? 'good' : ''
}

// ---- recording -------------------------------------------------------------
async function toggleRecord() {
  if (state.rec) {
    const rec = state.rec
    state.rec = null
    $('btn-record').classList.remove('on')
    clearInterval(state.timer)
    const take = await rec.stop()
    state.sampleRate = rec.sampleRate
    state.take = take
    state.notes = pitch.detectNotes(take, rec.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
    state.selected = null
    $('mic-state').textContent = take.length ? `captured ${take.length} samples` : 'empty take'
    status('ready')
    drawWave()
    renderNotes()
    return
  }

  if (!capture.isSupported()) throw new Error('mic unsupported')
  const rec = await capture.startRecording()
  state.rec = rec
  $('btn-record').classList.add('on')
  $('mic-state').textContent = 'mic live'
  $('rec-timer').textContent = '0.0s'
  status('recording')
  const started = performance.now()
  state.timer = setInterval(() => {
    $('rec-timer').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`
  }, 100)
}

// ---- playback --------------------------------------------------------------
function stopPlayback() {
  state.playing.forEach(src => { try { src.stop() } catch { /* already done */ } })
  state.playing = []
  state.ctx?.close()
  state.ctx = null
  $('btn-play').disabled = !state.notes.length
  $('btn-stop').disabled = true
}

function play() {
  if (!state.take?.length || !state.notes.length) return
  const ctx = new AudioContext({ sampleRate: state.sampleRate })
  state.ctx = ctx
  const buffer = ctx.createBuffer(1, state.take.length, state.sampleRate)
  buffer.copyToChannel(state.take, 0)
  const gain = ctx.createGain()
  gain.gain.value = Math.pow(10, Number($('in-gain').value) / 20)
  gain.connect(ctx.destination)
  const now = ctx.currentTime + 0.06
  for (const note of state.notes) {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = Math.pow(2, (Number.isFinite(note.cents) ? note.cents : 0) / 1200)
    src.connect(gain)
    src.start(now + note.start, note.start, Math.max(0.03, note.dur))
    state.playing.push(src)
  }
  $('btn-play').disabled = true
  $('btn-stop').disabled = false
  status('playing')
  const last = Math.max(...state.notes.map(n => n.start + n.dur))
  setTimeout(() => { if (state.ctx === ctx) stopPlayback() }, (last + 0.4) * 1000)
}

// ---- presets ---------------------------------------------------------------
function applyPatch(patch, label) {
  $('in-root').value = String(patch.tune.root)
  $('in-scale').value = patch.tune.scale
  $('in-snap').value = String(Math.round(patch.tune.amount * 100))
  $('out-snap').textContent = `${Math.round(patch.tune.amount * 100)}%`
  const m = patch.master
  $('in-thresh').value = String(m.comp.thresholdDb)
  $('in-ratio').value = String(m.comp.ratio)
  $('in-ceiling').value = String(m.limitDb)
  $('in-target').value = String(m.targetRmsDb)
  $('in-gain').value = String(patch.vocal?.gainDb ?? 0)
  for (const [id, out] of [['thresh', 'dB'], ['ratio', ':1'], ['ceiling', ' dB'], ['target', ' dB'], ['gain', ' dB']]) {
    const el = $('out-' + id)
    if (el) el.textContent = `${$(('in-' + id)).value}${out}`
  }
  state.bands = m.eq.map(b => ({ ...b }))
  renderBands()
  document.querySelectorAll('#preset-list button').forEach(b => b.classList.toggle('on', b.dataset.name === label))
  $('preset-state').textContent = label
  renderNotes()
}

function renderPresets() {
  const host = $('preset-list')
  host.innerHTML = ''
  for (const patch of presets.BUILTIN) {
    const b = document.createElement('button')
    b.textContent = patch.name
    b.dataset.name = patch.name
    b.addEventListener('click', guard(() => {
      const check = presets.validatePatch(patch)
      if (!check.ok) throw new Error(`bad preset: ${check.errors[0]}`)
      applyPatch(patch, patch.name)
      log(`preset: ${patch.name}`)
    }))
    host.append(b)
  }
}

function currentPatch() {
  const patch = presets.makePatch($('preset-state').textContent || 'Untitled')
  patch.tune = { root: Number($('in-root').value), scale: $('in-scale').value, amount: Number($('in-snap').value) / 100 }
  const s = settings()
  patch.master = { eq: s.eq, comp: s.comp, limitDb: s.limitDb, targetRmsDb: s.targetRmsDb }
  patch.vocal = { gainDb: s.vocalGainDb, reverbMix: patch.vocal.reverbMix }
  return patch
}

// ---- project ---------------------------------------------------------------
function saveProject() {
  const project = { version: 1, bpm: Number($('in-bpm').value), notes: state.notes, patch: currentPatch(), sampleRate: state.sampleRate }
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'voice-studio-project.json')
  log('project saved')
}

async function openProject(file) {
  const data = JSON.parse(await file.text())
  if (!Array.isArray(data.notes)) throw new Error('project: notes missing')
  state.notes = data.notes.map(n => ({ ...n }))
  $('in-bpm').value = String(data.bpm ?? 96)
  const check = presets.validatePatch(data.patch)
  if (check.ok) applyPatch(data.patch, data.patch.name)
  renderNotes()
  log(`project opened: ${state.notes.length} notes`)
}

// ---- demo ------------------------------------------------------------------
function loadDemo() {
  const sr = 48000
  const total = Math.round(sr * 2.4)
  const take = new Float32Array(total)
  const phrase = [[0.1, 0.45, 58], [0.65, 0.45, 62], [1.2, 0.5, 65], [1.8, 0.5, 62]]
  for (const [start, dur, midi] of phrase) {
    const hz = tune.midiToHz(midi + 0.35) // deliberately flat so snap has work to do
    const from = Math.round(start * sr)
    const to = Math.round((start + dur) * sr)
    for (let i = from; i < to; i++) {
      const t = (i - from) / sr
      const env = Math.min(1, t / 0.04) * Math.min(1, (to - i) / (sr * 0.08))
      const body = Math.sin(2 * Math.PI * hz * t) + 0.35 * Math.sin(4 * Math.PI * hz * t)
      take[i] = 0.42 * env * body + 0.012 * (Math.random() - 0.5)
    }
  }
  state.sampleRate = sr
  state.take = take
  state.notes = pitch.detectNotes(take, sr).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  $('mic-state').textContent = 'demo take'
  drawWave()
  renderNotes()
  log(`demo: ${state.notes.length} notes detected`)
}

// ---- export ----------------------------------------------------------------
function exportWav() {
  if (!state.take?.length) throw new Error('nothing to export')
  const rate = Number($('in-rate').value)
  const { stereo, report } = masterChain(stereoFrom(state.take), settings(), state.sampleRate)
  const bytes = encodeWav(stereo, rate)
  download(new Blob([bytes], { type: 'audio/wav' }), `voice-studio-${Date.now()}.wav`)
  log(`exported ${bytes.length} bytes @ ${rate} Hz, peak ${report.peakDb.toFixed(2)} dB, gain ${report.gainDb.toFixed(2)} dB`)
  status('exported')
}

// ---- boot ------------------------------------------------------------------
function boot() {
  $('in-root').innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')
  $('in-scale').innerHTML = tune.scaleNames().map(n => `<option value="${n}">${n}</option>`).join('')
  state.bands = [
    { kind: 'highpass', freq: 90, q: 0.71, gainDb: 0 },
    { kind: 'peaking', freq: 250, q: 1, gainDb: 0 },
    { kind: 'peaking', freq: 1000, q: 1, gainDb: 0 },
    { kind: 'peaking', freq: 3500, q: 1.2, gainDb: 0 },
    { kind: 'highshelf', freq: 8000, q: 0.71, gainDb: 0 },
    { kind: 'lowshelf', freq: 12000, q: 0.71, gainDb: 0 },
  ]
  renderBands()
  renderPresets()
  drawWave()
  renderNotes()

  $('btn-record').addEventListener('click', guard(toggleRecord))
  $('btn-play').addEventListener('click', guard(play))
  $('btn-stop').addEventListener('click', stopPlayback)
  $('btn-analyze').addEventListener('click', guard(readMeter))
  $('btn-export').addEventListener('click', guard(exportWav))
  $('btn-save').addEventListener('click', guard(saveProject))
  $('btn-demo').addEventListener('click', guard(loadDemo))
  $('btn-export-preset').addEventListener('click', guard(() => {
    const patch = currentPatch()
    download(new Blob([presets.serializePatch(patch)], { type: 'application/json' }), `${patch.name}.json`)
    log(`preset exported: ${patch.name}`)
  }))
  $('file-preset').addEventListener('change', guard(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const result = presets.parsePatch(await file.text())
    if (!result.ok) throw new Error(result.error)
    applyPatch(result.patch, result.patch.name)
    log(`preset imported: ${result.patch.name}`)
    e.target.value = ''
  }))
  $('file-project').addEventListener('change', guard(async (e) => {
    const file = e.target.files?.[0]
    if (file) await openProject(file)
    e.target.value = ''
  }))

  const retune = () => { renderNotes() }
  $('in-root').addEventListener('change', retune)
  $('in-scale').addEventListener('change', retune)
  $('in-bpm').addEventListener('change', retune)
  $('in-quantize').addEventListener('change', retune)
  $('in-snap').addEventListener('input', () => {
    $('out-snap').textContent = `${$('in-snap').value}%`
    renderNotes()
  })
  for (const [id, unit] of [['thresh', 'dB'], ['ratio', ':1'], ['ceiling', ' dB'], ['target', ' dB'], ['gain', ' dB']]) {
    $('in-' + id).addEventListener('input', () => { $('out-' + id).textContent = `${$('in-' + id).value}${unit}` })
  }
  $('in-gain').addEventListener('input', () => { if (state.ctx) play() })

  window.VS = {
    version: 1,
    get state() { return state },
    setState(next) { state.notes = next.notes ?? state.notes; renderNotes() },
    exportWav,
    loadDemo,
  }
  status('ready')
}

try { boot() } catch (err) {
  window.__bootErr = err?.stack || String(err)
  log(`boot failed: ${err?.message}`)
  status('boot failed')
}
