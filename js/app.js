// js/app.js — the only DOM-coupled module. Wires index.html to the pure modules.
import * as capture from './capture.js'
import * as pitch from './pitch.js'
import * as tune from './tune.js'
import * as presets from './presets.js'
import * as harmony from './harmony.js'
import * as voicechar from './voicechar.js'
import * as stems from './stems.js'
import * as beat from './beat.js'
import * as compose from './compose.js'
import * as automix from './automix.js'
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
  harmonies: [],
  stems: null,
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
      <output class="fq">${Math.round(band.freq)} Hz</output>
      <input type="range" min="-12" max="12" step="0.1" value="${band.gainDb}">
      <output>${band.gainDb.toFixed(1)} dB</output>`
    const [freq, gain] = row.querySelectorAll('input')
    freq.addEventListener('input', () => {
      band.freq = Number(freq.value)
      row.querySelector('.fq').textContent = `${Math.round(band.freq)} Hz`
    })
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
    row.setAttribute('role', 'listitem')
    const start = note.start.toFixed(2)
    const cents = Number.isFinite(note.cents) ? `${note.cents > 0 ? '+' : ''}${note.cents.toFixed(0)}c` : '0c'
    row.innerHTML = `<span>${start}s</span><span>${noteName(note.midi)}</span><span>${cents}</span><button aria-label="Delete the note at ${start}s, ${noteName(note.midi)}">Del</button>`
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
    resetHarmonies()
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

function playNotes(notes, opts = {}) {
  if (!state.take?.length || !notes?.length) return
  stopPlayback()
  const ctx = new AudioContext({ sampleRate: state.sampleRate })
  state.ctx = ctx
  const buffer = ctx.createBuffer(1, state.take.length, state.sampleRate)
  buffer.copyToChannel(state.take, 0)
  const gain = ctx.createGain()
  gain.gain.value = Math.pow(10, (Number($('in-gain').value) + (opts.gainDb || 0)) / 20)
  gain.connect(ctx.destination)
  const now = ctx.currentTime + 0.06
  const spread = (opts.spreadMs || 0) / 1000
  notes.forEach((note, i) => {
    const cents = Number.isFinite(note.cents) ? note.cents : 0
    const offset = Number.isFinite(opts.offsets?.[i]) ? opts.offsets[i] : 0
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = Math.pow(2, cents / 1200 + offset / 12)
    src.connect(gain)
    src.start(now + note.start + spread * i, note.start, Math.max(0.03, note.dur))
    state.playing.push(src)
  })
  $('btn-play').disabled = true
  $('btn-stop').disabled = false
  status('playing')
  const last = Math.max(...notes.map(n => n.start + n.dur))
  setTimeout(() => { if (state.ctx === ctx) stopPlayback() }, (last + spread * notes.length + 0.4) * 1000)
}

function play() { playNotes(state.notes) }

function playBuffer(buf) {
  if (!buf?.length) return
  stopPlayback()
  const ctx = new AudioContext({ sampleRate: state.sampleRate })
  state.ctx = ctx
  const buffer = ctx.createBuffer(1, buf.length, state.sampleRate)
  buffer.copyToChannel(buf, 0)
  const gain = ctx.createGain()
  gain.gain.value = 0.9
  gain.connect(ctx.destination)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(gain)
  src.start()
  state.playing.push(src)
  src.onended = () => { if (state.ctx === ctx) stopPlayback() }
}

// ---- harmony ---------------------------------------------------------------
function resetHarmonies() {
  state.harmonies = []
  renderHarmonies()
}

function renderHarmonies() {
  const host = $('harmony-list')
  host.innerHTML = ''
  state.harmonies.forEach((set, i) => {
    const row = document.createElement('div')
    row.className = 'note'
    row.title = `${set.label} · ${set.spreadMs} ms spread`
    row.innerHTML = `<span>${set.label}</span><span>${set.notes.length} notes</span><span>${set.gainDb} dB</span><button aria-label="Preview ${set.label}, ${set.notes.length} notes">Preview</button>`
    row.querySelector('button').addEventListener('click', guard(() => previewHarmony(i)))
    host.append(row)
  })
  $('harmony-state').textContent = state.harmonies.length ? `${state.harmonies.length} sets` : 'no sets'
}

function buildHarmonies() {
  if (!state.notes.length) throw new Error('no notes to harmonise')
  const name = $('in-harmony').value
  state.harmonies = harmony.buildHarmonies(state.notes, name)
  renderHarmonies()
  log(`harmonies: ${name}, ${state.harmonies.length} sets, ${state.harmonies.map(s => s.label).join(', ')}`)
}

function previewHarmony(index) {
  const set = state.harmonies[index]
  if (!set) throw new Error('no harmony set')
  if (!state.take?.length) throw new Error('nothing to play')
  const offsets = set.notes.map((n, i) => n.midi - state.notes[i].midi)
  playNotes(set.notes, { gainDb: set.gainDb, spreadMs: set.spreadMs, offsets })
  log(`harmony preview: ${set.label} (${set.gainDb} dB, ${set.spreadMs} ms spread)`)
}

// ---- voice character -------------------------------------------------------
function applyCharacter() {
  if (!state.take?.length) throw new Error('nothing to process')
  const name = $('in-character').value
  const out = voicechar.applyCharacter(state.take, name, state.sampleRate)
  state.take = out
  state.notes = pitch.detectNotes(out, state.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  $('voice-state').textContent = name
  $('mic-state').textContent = `character: ${name}`
  resetHarmonies()
  drawWave()
  renderNotes()
  log(`voice: ${name}, ${out.length} samples, ${state.notes.length} notes re-detected`)
}

// ---- stems -----------------------------------------------------------------
function rmsDb(buf) {
  if (!buf?.length) return -Infinity
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  const rms = Math.sqrt(sum / buf.length)
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

const fmtDb = (v) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : '-inf')

function split() {
  if (!state.take?.length) throw new Error('nothing to split')
  state.stems = stems.splitStems(state.take, state.sampleRate)
  const leads = rmsDb(state.stems.leads)
  const bed = rmsDb(state.stems.bed)
  $('stem-readout').textContent = `leads ${fmtDb(leads)} · bed ${fmtDb(bed)}`
  log(`stems: leads rms ${fmtDb(leads)}, bed rms ${fmtDb(bed)}`)
}

function recombineStems() {
  if (!state.stems) throw new Error('no stems to recombine')
  const out = stems.recombine(state.stems)
  state.take = out
  state.stems = null
  state.notes = pitch.detectNotes(out, state.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  $('stem-readout').textContent = `recombined ${out.length} samples`
  resetHarmonies()
  drawWave()
  renderNotes()
  log(`stems recombined: ${out.length} samples, ${state.notes.length} notes re-detected`)
}

// ---- beat ------------------------------------------------------------------
function generateBeat() {
  const genre = $('in-genre').value
  const bars = Number($('in-bars').value)
  const rendered = beat.renderBeat(genre, bars, state.sampleRate)
  const base = state.take ?? new Float32Array(0)
  const mixed = new Float32Array(Math.max(base.length, rendered.length))
  mixed.set(base)
  for (let i = 0; i < rendered.length; i++) {
    mixed[i] = Math.max(-1, Math.min(1, mixed[i] + rendered[i] * 0.6))
  }
  state.take = mixed
  state.notes = pitch.detectNotes(mixed, state.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  resetHarmonies()
  drawWave()
  renderNotes()
  log(`beat: ${genre} ${bars} bars, ${rendered.length} samples mixed, ${state.notes.length} notes`)
}

// ---- compose ---------------------------------------------------------------
function feedNotes(notes, label) {
  state.notes = notes.map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  resetHarmonies()
  renderNotes()
  log(`compose: ${label}, ${notes.length} notes`)
}

function composeMelody() {
  const seed = Number($('in-seed').value)
  const notes = compose.generateMelody({
    root: Number($('in-root').value),
    scale: $('in-scale').value,
    steps: Number($('in-steps').value),
    bpm: Number($('in-bpm').value),
    seed,
    octave: 1,
  })
  feedNotes(notes, `melody seed ${seed}`)
}

function composeChords() {
  const seed = Number($('in-seed').value)
  const chords = compose.generateChords({
    root: Number($('in-root').value),
    scale: $('in-scale').value,
    bars: Number($('in-bars').value),
    bpm: Number($('in-bpm').value),
    seed,
  })
  feedNotes(compose.chordNotes(chords), `chords seed ${seed}, ${chords.length} bars`)
}

// ---- automix ---------------------------------------------------------------
function suggestMaster() {
  const genre = $('in-genre').value
  const s = automix.suggestFromGenre(genre)
  state.bands = s.eq.map(b => ({ ...b }))
  renderBands()
  $('in-thresh').value = String(s.comp.thresholdDb)
  $('in-ratio').value = String(s.comp.ratio)
  $('in-target').value = String(s.targetRmsDb)
  $('out-thresh').textContent = `${s.comp.thresholdDb} dB`
  $('out-ratio').textContent = `${s.comp.ratio}:1`
  $('out-target').textContent = `${s.targetRmsDb} dB`
  $('automix-readout').textContent = `${genre}: ${state.bands.length} bands, target ${s.targetRmsDb} dB`
  log(`automix: ${genre} -> ${state.bands.length} bands, comp ${s.comp.thresholdDb} dB / ${s.comp.ratio}:1, target ${s.targetRmsDb} dB`)
}

function balanceLevels() {
  const levels = []
  const labels = []
  if (state.take?.length) { levels.push(rmsDb(state.take)); labels.push('take') }
  if (state.stems) {
    levels.push(rmsDb(state.stems.leads)); labels.push('leads')
    levels.push(rmsDb(state.stems.bed)); labels.push('bed')
  }
  if (!levels.length) throw new Error('no levels to balance')
  const trims = automix.balance(levels)
  const text = labels.map((label, i) => `${label} ${trims[i] > 0 ? '+' : ''}${trims[i]} dB`).join(', ')
  $('automix-readout').textContent = text
  log(`balance: ${text}`)
}

function previewNote() {
  const instrument = $('in-instrument').value
  const note = state.selected != null ? state.notes[state.selected] : null
  const hz = note && Number.isFinite(note.hz) && note.hz > 0 ? note.hz : tune.midiToHz(Number($('in-root').value) + 60)
  const buf = automix.renderNote(instrument, hz, 0.8, state.sampleRate)
  playBuffer(buf)
  log(`instrument preview: ${instrument} at ${hz.toFixed(1)} Hz`)
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
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'apollo-studios-project.json')
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
  resetHarmonies()
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
  download(new Blob([bytes], { type: 'audio/wav' }), `apollo-studios-${Date.now()}.wav`)
  log(`exported ${bytes.length} bytes @ ${rate} Hz, peak ${report.peakDb.toFixed(2)} dB, gain ${report.gainDb.toFixed(2)} dB`)
  status('exported')
}

// ---- boot ------------------------------------------------------------------
function boot() {
  $('in-root').innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')
  $('in-scale').innerHTML = tune.scaleNames().map(n => `<option value="${n}">${n}</option>`).join('')
  $('in-harmony').innerHTML = harmony.HARMONY_PRESETS.map(p => `<option value="${p.name}">${p.name}</option>`).join('')
  $('in-character').innerHTML = voicechar.CHARACTERS.map(c => `<option value="${c.name}">${c.name}</option>`).join('')
  $('in-genre').innerHTML = beat.GENRES.map(g => `<option value="${g.name}">${g.name}</option>`).join('')
  $('in-instrument').innerHTML = automix.INSTRUMENTS.map(i => `<option value="${i.name}">${i.name}</option>`).join('')
  state.bands = [
    { kind: 'highpass', freq: 30, q: 0.71, gainDb: 0 },
    { kind: 'lowshelf', freq: 90, q: 0.71, gainDb: 0 },
    { kind: 'peaking', freq: 250, q: 1, gainDb: 0 },
    { kind: 'peaking', freq: 1000, q: 1, gainDb: 0 },
    { kind: 'peaking', freq: 3500, q: 1.2, gainDb: 0 },
    { kind: 'highshelf', freq: 8000, q: 0.71, gainDb: 0 },
  ]
  renderBands()
  renderPresets()
  renderHarmonies()
  drawWave()
  renderNotes()

  $('btn-record').addEventListener('click', guard(toggleRecord))
  $('btn-play').addEventListener('click', guard(play))
  $('btn-stop').addEventListener('click', stopPlayback)
  $('btn-analyze').addEventListener('click', guard(readMeter))
  $('btn-export').addEventListener('click', guard(exportWav))
  $('btn-save').addEventListener('click', guard(saveProject))
  $('btn-demo').addEventListener('click', guard(loadDemo))
  $('btn-harmony').addEventListener('click', guard(buildHarmonies))
  $('btn-character').addEventListener('click', guard(applyCharacter))
  $('btn-split').addEventListener('click', guard(split))
  $('btn-recombine').addEventListener('click', guard(recombineStems))
  $('btn-beat').addEventListener('click', guard(generateBeat))
  $('btn-melody').addEventListener('click', guard(composeMelody))
  $('btn-chords').addEventListener('click', guard(composeChords))
  $('btn-suggest').addEventListener('click', guard(suggestMaster))
  $('btn-balance').addEventListener('click', guard(balanceLevels))
  $('btn-preview-note').addEventListener('click', guard(previewNote))
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
    e.target.value = ''  }))

  /* toolbar / rail / tab chrome: a drawer button shows its panel; any Export button exports */
  const openPanel = (name, focusPanel) => {
    const panel = document.getElementById('p-' + name)
    if (!panel) return
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p !== panel })
    document.body.classList.add('panel-open')
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.drawer === name
      t.classList.toggle('on', on)
      t.setAttribute('aria-selected', on ? 'true' : 'false')
      t.tabIndex = on ? 0 : -1
    })
    if (focusPanel) panel.focus()
  }
  document.querySelectorAll('[data-drawer]').forEach((el) => {
    el.addEventListener('click', () => openPanel(el.dataset.drawer))
  })
  /* real tab behaviour: arrows move, Home/End jump */
  const tablist = document.querySelector('.tabs')
  tablist?.addEventListener('keydown', (e) => {
    const tabs = [...tablist.querySelectorAll('.tab')]
    const i = tabs.indexOf(document.activeElement)
    if (i < 0) return
    const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]
    if (go === undefined) return
    e.preventDefault()
    const next = tabs[(go + tabs.length) % tabs.length]
    next.focus()
    openPanel(next.dataset.drawer)
  })
  /* the two file pickers live in labels, so give them a keyboard path */
  document.querySelectorAll('label.file[role=button]').forEach((label) => {
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); label.querySelector('input').click() }
    })
  })
  document.querySelectorAll('[data-export]').forEach((el) => {
    el.addEventListener('click', guard(exportWav))
  })

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
    version: 2,
    get state() { return state },
    setState(next) { state.notes = next.notes ?? state.notes; renderNotes() },
    exportWav,
    loadDemo,
    harmonySet(name) {
      $('in-harmony').value = name
      buildHarmonies()
      return state.harmonies.map(s => s.label)
    },
    split,
  }
  status('ready')
}

try { boot() } catch (err) {
  window.__bootErr = err?.stack || String(err)
  log(`boot failed: ${err?.message}`)
  status('boot failed')
}
