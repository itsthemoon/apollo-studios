// js/app.js — the only DOM-coupled module. Wires index.html to the pure modules.
import * as capture from './capture.js'
import * as pitch from './pitch.js'
import * as tune from './tune.js'
import * as shifter from './shifter.js'
import * as autopitch from './autopitch.js'
import * as presets from './presets.js'
import * as harmony from './harmony.js'
import * as voicechar from './voicechar.js'
import * as stems from './stems.js'
import * as beat from './beat.js'
import * as compose from './compose.js'
import * as automix from './automix.js'
import { masterChain } from './master.js'
import { encodeWav } from './wav.js'
import { attach as attachStudio } from './studio.js'
import * as icons from './icons.js'
import { install as installPanels } from './panels.js'
import { install as installTimeline } from './timeline.js'
import { install as installEdit } from './edit.js'
import { install as installPersist } from './persist.js'
import * as waves from './waves.js'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const DIVISION = 4
const $ = (id) => document.getElementById(id)

const state = {
  notes: [],
  take: null,
  takes: new Map(),
  takeTrack: null,
  sampleRate: 48000,
  bands: [],
  selected: null,
  rec: null,
  playing: [],
  live: [],
  region: { pitch: 0, rate: 1, gainDb: 0, reverse: false },
  peakCache: null,
  ctx: null,
  harmonies: [],
  stems: null,
  demoDuration: null,
  playhead: 0,
  wavePeaks: new Map(),
  takeSpans: new Map(),
}

// ---- helpers ---------------------------------------------------------------
function log(msg) {
  const el = $('log')
  el.textContent = (el.textContent ? el.textContent + '\n' : '') + msg
  el.scrollTop = el.scrollHeight
}

function status(text) { $('status').textContent = text }

function playheadSeconds() { return state.playhead }

/* bars are drawn to cover the take, not a fixed twenty */
function buildRuler(bars = 24) {
  const ruler = $('ruler')
  const keep = ruler.querySelector('.loop-region')
  ruler.innerHTML = Array.from({ length: bars }, (_, i) => `<span class="bar${i === 0 ? ' on' : ''}">${i + 1}</span>`).join('')
  ruler.append(keep)
}

/* the lane maps pixels to seconds from the one-bar clip width (--ppb) */
function setPlayheadFromEvent(e) {
  const lane = $('lane')
  const box = lane.getBoundingClientRect()
  const ppb = parseFloat(getComputedStyle(lane).getPropertyValue('--ppb')) || 77
  const barSeconds = (60 / Number($('in-bpm').value)) * 4
  state.playhead = Math.max(0, ((e.clientX - box.left) / ppb) * barSeconds)
  const head = $('playhead')
  if (head) head.style.left = `${Math.max(0, e.clientX - box.left)}px`
}

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
      <input type="range" min="30" max="16000" step="1" value="${band.freq}" aria-label="${band.kind} frequency">
      <output class="fq">${Math.round(band.freq)} Hz</output>
      <input type="range" min="-12" max="12" step="0.1" value="${band.gainDb}" aria-label="${band.kind} gain">
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
  queueMicrotask(paintRegion) // wave + readouts follow the model
  state.studio?.drawRoll?.()
  const host = $('note-list')
  host.innerHTML = ''
  state.notes.forEach((note, i) => {
    const row = document.createElement('div')
    row.className = 'note' + (i === state.selected ? ' sel' : '')
    row.setAttribute('role', 'listitem')
    row.tabIndex = 0
    const start = note.start.toFixed(2)
    const cents = Number.isFinite(note.cents) ? `${note.cents > 0 ? '+' : ''}${note.cents.toFixed(0)}c` : '0c'
    row.innerHTML = `<span>${start}s</span><span>${noteName(note.midi)}</span><span>${cents}</span><button aria-label="Delete the note at ${start}s, ${noteName(note.midi)}">Del</button>`
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      state.selected = i
      renderNotes()
    })
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
  const scale = $('in-mode').value
  const amount = Number($('in-snap').value) / 100
  state.notes = tune.snapStrength(state.notes, { root, scale, amount })
  if ($('in-quantize').checked) {
    state.notes = tune.quantizeStarts(state.notes, { bpm: Number($('in-bpm').value), division: DIVISION })
  }
  // how far each note was actually transposed from its take pitch: playback
  // rate and the harmony preview read this, `cents` is only the residual
  state.notes = state.notes.map(n => (
    Number.isFinite(n.origMidi) && Number.isFinite(n.midi) ? { ...n, shift: n.midi - n.origMidi } : n
  ))
}

function drawTake(canvas, take) {
  if (!canvas) return
  const g = canvas.getContext('2d')
  g.fillStyle = '#0e0e13'
  g.fillRect(0, 0, canvas.width, canvas.height)
  if (!take?.length) return
  const mid = canvas.height / 2
  const step = Math.max(1, Math.floor(take.length / canvas.width))
  /* dB scale, 24 dB of range, referenced to the take's own peak so a quiet
     room recording still shows its shape instead of a flat line. */
  const DB = 24
  let ref = 0
  for (let i = 0; i < take.length; i += Math.max(1, Math.floor(take.length / 4096))) ref = Math.max(ref, Math.abs(take[i]))
  ref = Math.max(ref, 1e-4)
  const d = (v) => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(v, 1e-6) / ref) + DB) / DB))
  const rms = new Float32Array(canvas.width)
  const peaks = new Float32Array(canvas.width)
  for (let x = 0; x < canvas.width; x++) {
    let sum = 0, n = 0
    for (let i = x * step; i < (x + 1) * step && i < take.length; i++, n++) {
      const v = take[i]
      sum += v * v
      peaks[x] = Math.max(peaks[x], Math.abs(v))
    }
    rms[x] = n ? Math.sqrt(sum / n) : 0
  }

  g.strokeStyle = '#6fa8ff'
  g.beginPath()
  for (let x = 0; x < canvas.width; x++) {
    const amp = d(rms[x]) * (mid - 2) * 0.92
    g.moveTo(x + 0.5, mid - amp)
    g.lineTo(x + 0.5, mid + amp)
  }
  g.stroke()

  g.beginPath()
  for (let x = 0; x < canvas.width; x++) {
    const h = d(peaks[x]) * (mid - 1)
    g.moveTo(x + 0.5, mid - h)
    g.lineTo(x + 0.5, mid + h)
  }
  g.globalAlpha = 0.4
  g.stroke()
  g.globalAlpha = 1

  g.strokeStyle = '#2c4a52'
  g.beginPath()
  g.moveTo(0, mid + 0.5)
  g.lineTo(canvas.width, mid + 0.5)
  g.stroke()
}

/* ---- region waveforms ------------------------------------------------------
   Every region draws the slice of its track's take covered by
   `startBeat..startBeat+lengthBeats`, so splitting yields two real excerpts
   instead of one picture and a row of blank boxes. Peaks come from a decimated
   per-track cache (js/waves.js, built once per take), columns are capped, and
   repaints coalesce into one animation frame.

   Region 0 keeps the whole-take picture it always had while it is pristine (a
   bar long, at beat 0); once it is trimmed or split it becomes an excerpt like
   any other. Splitting adopts the pixels on screen first (see timeline.js), so
   the two halves show exactly what the one picture showed. */
const PRISTINE_BEATS = 4
const MAX_CANVAS_PX = 2400
const pristineRegion = (region) => !!region && region.startBeat === 0
  && Math.abs(region.lengthBeats - PRISTINE_BEATS) < 1e-6

function peaksFor(track, entry) {
  if (!entry?.data?.length) return null
  const known = state.wavePeaks.get(track.id)
  if (known && known.data === entry.data && known.rate === entry.rate) return known
  const cache = waves.buildCache(entry.data, entry.rate)
  cache.data = entry.data
  state.wavePeaks.set(track.id, cache)
  return cache
}

function canvasIn(clip) {
  if (!clip) return null
  const found = clip.querySelector(':scope > canvas.wave')
  if (found) return found
  if (clip.id === 'clip-1') return $('wave')
  const made = document.createElement('canvas')
  made.className = 'wave'
  made.height = 120
  made.setAttribute('aria-hidden', 'true')
  clip.append(made)
  return made
}

const pxPerBeatNow = () => {
  const lane = $('lane')
  const raw = parseFloat(getComputedStyle(lane).getPropertyValue('--ppb'))
  return (Number.isFinite(raw) && raw > 0 ? raw : 77) / 4
}

/* Region 0 of the same lane: the take is laid out against it. */
function clip0Of(clip) {
  if (!clip) return null
  if (clip.id === 'clip-1') return clip
  return clip.parentElement?.querySelector(':scope > .clip[data-region-index="0"]') || null
}

/**
 * Beats the track's take is laid out over. A demo take is stretched to the lane
 * (`data-full`) and so spans however many beats that width is; any other take
 * spans its own duration at the current tempo. Recorded the first time it is
 * needed and kept, so trimming region 0 cannot rescale the take under the
 * remaining regions.
 */
function takeSpan(track, clip0) {
  if (!track) return 0
  const known = state.takeSpans.get(track.id)
  if (Number.isFinite(known) && known > 0) return known
  const entry = state.takes.get(track.id)
  if (!entry) return 0
  const width = clip0?.hasAttribute('data-full') ? (clip0.clientWidth || 0) : 0
  if (width >= waves.MIN_PX) {
    const span = width / pxPerBeatNow()
    state.takeSpans.set(track.id, span)
    return span
  }
  const bpm = Number($('in-bpm').value) || 96
  const span = waves.spanOf(entry.data.length / entry.rate, bpm)
  // only keep it once the lane is laid out; a zero-width clip must not pin a
  // span the next paint cannot correct
  if (clip0) state.takeSpans.set(track.id, span)
  return span
}

/* the clip node under the DOM is the source of truth for which region it is */
function regionAtNode(node) {
  if (!node) return null
  const tracks = state.tracks || []
  const track = tracks.find(t => t && t.id === node.dataset.clip)
    || (node.id === 'clip-1' || node.closest('.lane-row[data-row="1"]') ? tracks[0] : null)
  if (!track) return null
  const index = Number(node.dataset.regionIndex || 0)
  const region = index === 0 ? track.clip
    : (Array.isArray(track.clips) ? track.clips[index - 1] : null)
  if (!region || !(region.lengthBeats > 0)) return null
  return { track, index, region }
}

/* region 0 before it is touched: the whole take, exactly as it always drew */
function drawWholeTake(canvas, clip, track) {
  if (!canvas || !clip || !track) return
  const entry = state.takes.get(track.id)
  const take = entry?.data || (track.id === state.tracks[0]?.id ? state.take : null)
  const w = Math.max(1, Math.round((clip.clientWidth || 0) - 20))
  if (canvas.width !== w) canvas.width = w
  // excerpt paints size the backing store to the box; the whole-take view has
  // always been a 120 px tall picture squeezed by CSS, so put that back
  if (canvas.height !== 120) canvas.height = 120
  drawTake(canvas, take)
}

function drawRegionWave(track, clip, region) {
  const canvas = canvasIn(clip)
  if (!canvas) return
  const box = canvas.getBoundingClientRect()
  const width = Math.round(box.width || clip.getBoundingClientRect().width || 0)
  // under three pixels nothing is legible: blank the canvas so a stale, wider
  // picture cannot be stretched into the sliver
  if (width < waves.MIN_PX) {
    if (canvas.width !== 1 || canvas.height !== 1) { canvas.width = 1; canvas.height = 1 }
    return
  }
  const g = canvas.getContext('2d')
  if (!g) return
  const height = Math.max(8, Math.round(box.height || 52))
  const px = Math.min(width, MAX_CANVAS_PX)
  if (canvas.width !== px) canvas.width = px
  if (canvas.height !== height) canvas.height = height
  g.globalAlpha = 1
  g.fillStyle = '#0e0e13'
  g.fillRect(0, 0, px, height)

  const entry = state.takes.get(track.id)
  const cache = peaksFor(track, entry)
  if (!cache || !entry) return
  const span = takeSpan(track, clip0Of(clip))
  const win = waves.windowOf(region, span, cache.len)
  if (!(win.to > win.from)) return
  const cols = Math.min(px, waves.MAX_COLUMNS)
  const { peak, rms } = waves.columns(cache, win.from, win.to, cols)
  const mid = height / 2
  const { ref } = cache
  // same 24 dB window as drawTake, referenced to the take's own peak
  const lit = (v) => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(v, 1e-6) / ref) + 24) / 24))

  /* Brightness carries the fades: columns are grouped into 16 ramp steps so a
     whole region is a handful of paths instead of one per column. */
  const steps = new Map()
  for (let x = 0; x < cols; x++) {
    const { amp, ramp } = waves.envAt(region, x, cols)
    const step = Math.max(1, Math.round(ramp * 15))
    const band = steps.get(step)
    if (band) band.push([x, amp])
    else steps.set(step, [[x, amp]])
  }
  const colW = Math.max(1, Math.ceil(px / cols))
  for (const [step, items] of steps) {
    const k = step / 15
    g.fillStyle = `rgb(${Math.round(111 * k)},${Math.round(168 * k)},${Math.round(255 * k)})`
    g.globalAlpha = 0.95
    for (const [x, amp] of items) {
      const h = lit(rms[x]) * amp * (mid - 2)
      if (h > 0) g.fillRect(Math.floor((x * px) / cols), mid - h, colW, h * 2)
    }
    g.globalAlpha = 0.35
    for (const [x, amp] of items) {
      const h = lit(peak[x]) * amp * (mid - 1)
      if (h > 0) g.fillRect(Math.floor((x * px) / cols), mid - h, colW, h * 2)
    }
  }
  g.globalAlpha = 1
  g.strokeStyle = '#2c4a52'
  g.beginPath()
  g.moveTo(0, mid + 0.5)
  g.lineTo(px, mid + 0.5)
  g.stroke()
}

function paintRegions() {
  for (const node of document.querySelectorAll('#lane .clip')) {
    const hit = regionAtNode(node)
    if (!hit) continue
    if (hit.index === 0 && pristineRegion(hit.region)) drawWholeTake(canvasIn(node), node, hit.track)
    else drawRegionWave(hit.track, node, hit.region)
  }
}

let waveFrame = 0
/* timeline.js, studio.js and record all call this; one frame per burst */
function scheduleWaves() {
  if (waveFrame) return
  waveFrame = requestAnimationFrame(() => { waveFrame = 0; paintRegions() })
}

function drawWave() {
  const clip = document.querySelector('.clip')
  if (clip) {
    // a real take spans the whole arrangement; the default is one bar (--ppb)
    clip.toggleAttribute('data-full', !!state.demoDuration)
    if (state.demoDuration) clip.title = `${state.demoDuration.toFixed(1)} s take`
  }
  paintRegions()
}

/* whoever moves, trims, splits or reloads a region asks for this and the next
   animation frame repaints once, however many calls land in between */
state.waveDirty = scheduleWaves
window.addEventListener('resize', scheduleWaves)

/* The take buffer is per track (`state.takes`); `state.take` stays the one that
   plays and edits. Every code path that lands a buffer goes through here so the
   per-track map cannot drift from the audible take. */
function keepTake(take, rate, trackId) {
  state.take = take
  const id = trackId || state.takeTrack || state.tracks?.[0]?.id
  if (id) {
    state.takeTrack = id
    state.takes.set(id, { data: take, rate: Number(rate) || state.sampleRate })
    state.takeSpans.delete(id)
  }
  return take
}

/* Repaint one track's regions from its own buffer — a restore, not a record. */
function paintTake(trackId) {
  const track = state.tracks.find(t => t.id === trackId)
  const entry = state.takes.get(trackId)
  if (!track || !entry) return
  takeSurface(track) // a lane that has no region 0 yet gets one
  if (track.id === state.tracks[0]?.id) drawWave()
  else paintRegions()
}

/* persist.js hands a stored buffer back here: map, take, title, waveform. */
function attachTake(trackId, data, rate) {
  const buf = data instanceof Float32Array ? data : new Float32Array(data || 0)
  if (!buf.length) return false
  const r = Number(rate) || state.sampleRate
  state.takes.set(trackId, { data: buf, rate: r })
  state.takeSpans.delete(trackId)
  if (!state.take?.length || trackId === state.takeTrack) {
    state.take = buf
    state.takeTrack = trackId
    state.sampleRate = r
  }
  const secs = buf.length / r
  const clip = trackId === state.tracks[0]?.id
    ? document.getElementById('clip-1')
    : document.querySelector(`.lane-row [data-clip="${trackId}"]`)
  if (clip) {
    clip.title = `${secs.toFixed(1)} s take`
    clip.removeAttribute('data-full')
  }
  paintTake(trackId)
  if (state.notes.length) $('btn-play').disabled = false
  return true
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
const AUDIO_TYPES = new Set(['voice', 'guitar', 'bass', 'sampler', 'loop'])
const isAudioTrack = (t) => Boolean(t && AUDIO_TYPES.has(t.type))

/* The armed audio track is the target. Nothing armed: arm what the user is
   looking at, or the voice track, and say so. */
function recordTarget() {
  const armed = state.tracks.filter(t => t.armed && isAudioTrack(t))
  if (armed.length) return armed[0]
  if (state.tracks.some(t => t.armed)) log('armed track is MIDI — recording to an audio track')
  const active = state.tracks.find(t => t.id === state.active)
  const target = isAudioTrack(active) ? active : state.tracks[0]
  const btn = document.querySelector(`[data-arm="${target.id}"]`)
  if (btn && !target.armed) { btn.click(); log(`armed ${target.name} for recording`) }
  return target
}

/* Region 0 of a track: the static clip-1 for the voice track, a clip built on
   demand for any other lane. */
function takeSurface(track) {
  if (!track) return null
  if (track.id === state.tracks[0]?.id) {
    return { canvas: $('wave'), clip: document.getElementById('clip-1') }
  }
  const row = document.querySelector(`.lane-row[data-row="${track.id}"]`)
  if (!row) return null
  let clip = row.querySelector(':scope > .clip')
  if (!clip) {
    clip = document.createElement('div')
    clip.className = 'clip tl-clip'
    clip.dataset.clip = track.id
    clip.dataset.regionIndex = '0'
    clip.innerHTML = `<div class="clip-head"><h3>${track.name}</h3><span class="clip-gain">gain <output>0.0 dB</output></span></div>
      <canvas class="wave" width="1200" height="120"></canvas>`
    row.prepend(clip)
  }
  let canvas = clip.querySelector('canvas')
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.className = 'wave'
    canvas.width = 1200
    canvas.height = 120
    clip.append(canvas)
  }
  return { canvas, clip }
}

function startLiveTake(track, rec) {
  stopLiveTake()
  const surface = rec.surface
  if (!surface?.canvas) return
  const lane = $('lane')
  const live = {
    canvas: surface.canvas,
    clip: surface.clip,
    peaks: [],
    buf: new Float32Array(rec.analyser?.fftSize || 2048),
    started: performance.now(),
    pxPerSec: 92,
    maxWidth: Math.max(160, (lane?.clientWidth || 800) - 48),
    timer: 0,
  }
  state.live = live
  if (surface.clip) {
    surface.clip.style.width = '48px'
    surface.clip.style.minWidth = '0px'
    surface.clip.dataset.recording = 'true'
  }
  live.timer = setInterval(liveFrame, 60)
}

function liveFrame() {
  const live = state.live
  if (!live) return
  const drain = state.rec?.input?.live?.drain
  if (drain) {
    const queued = drain()
    if (queued.length) live.peaks.push(...queued)
  } else {
    const analyser = state.rec?.analyser
    if (analyser) {
      if (live.buf.length !== analyser.fftSize) live.buf = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(live.buf)
      let peak = 0
      for (let i = 0; i < live.buf.length; i++) {
        const v = Math.abs(live.buf[i])
        if (v > peak) peak = v
      }
      live.peaks.push(peak)
    }
  }
  const seconds = (performance.now() - live.started) / 1000
  const width = Math.min(live.maxWidth, 48 + seconds * live.pxPerSec)
  if (live.clip) live.clip.style.width = `${width.toFixed(0)}px`
  const g = live.canvas.getContext('2d')
  const w = Math.max(1, Math.round(width - 20))
  if (live.canvas.width !== w) live.canvas.width = w
  const h = live.canvas.height
  const mid = h / 2
  g.fillStyle = '#0e0e13'
  g.fillRect(0, 0, w, h)
  if (!live.peaks.length) return
  /* dBFS scale so a quiet built-in mic still draws a shape (drawTake uses a
     24 dB window; the live view is deliberately hotter while recording) */
  const d = (v) => Math.min(1, Math.max(0, (20 * Math.log10(Math.max(v, 1e-6)) + 48) / 48))
  g.strokeStyle = '#6fa8ff'
  g.beginPath()
  for (let x = 0; x < w; x++) {
    const peak = live.peaks[Math.min(live.peaks.length - 1, Math.floor((x / w) * live.peaks.length))] || 0
    const amp = d(peak) * (mid - 2)
    g.moveTo(x + 0.5, mid - amp)
    g.lineTo(x + 0.5, mid + amp)
  }
  g.stroke()
}

function stopLiveTake() {
  const live = state.live
  state.live = null
  if (!live) return
  clearInterval(live.timer)
  if (live.clip) {
    live.clip.style.width = ''
    live.clip.style.minWidth = ''
    delete live.clip.dataset.recording
  }
}

function redrawTrackTake(track) {
  if (!track) return
  paintTake(track.id)
}

async function toggleRecord() {
  if (state.rec) {
    const rec = state.rec
    state.rec = null
    $('btn-record').classList.remove('on')
    clearInterval(state.timer)
    let take = new Float32Array(0)
    try { take = await rec.stop() } catch (err) { log(`record: ${err?.message || err}`) }
    stopLiveTake()
    const rate = rec.sampleRate || state.sampleRate
    if (!take.length) {
      $('mic-state').textContent = 'empty take'
      status('ready')
      redrawTrackTake(rec.track, rec.surface)
      log('recorded 0 samples — previous take kept')
      state.studio?.input?.refreshIfStale?.()
      return
    }
    state.sampleRate = rate
    state.take = keepTake(take, rate, rec.track.id)
    state.selected = null
    state.demoDuration = null
    if (rec.track.id === state.tracks[0]?.id) $('proj-name').value = 'Take 1'
    if (rec.surface?.clip) {
      /* size the region to the take: one bar is (60 / bpm) * 4 seconds and the
         lane's --ppb is its pixel width, so the clip stops stretching a short
         take across the whole arrangement */
      const secs = take.length / rate
      const barSeconds = (60 / (Number($('in-bpm').value) || 96)) * 4
      const ppb = parseFloat(getComputedStyle($('lane')).getPropertyValue('--ppb')) || 77
      rec.surface.clip.style.width = `${Math.max(12, (secs / barSeconds) * ppb)}px`
      rec.surface.clip.style.minWidth = '0px'
      rec.surface.clip.title = `${secs.toFixed(1)} s take`
      rec.surface.clip.removeAttribute('data-full')
      if (rec.track.clip) rec.track.clip.lengthBeats = Math.max(1, (secs / barSeconds) * 4)
    }
    // detection is decimated for long takes; it still fills the editor
    state.notes = (await detectTakeNotes(take, rate)).map(n => ({ ...n, origMidi: n.midi }))
    $('mic-state').textContent = `captured ${take.length} samples`
    status('ready')
    resetHarmonies()
    if (rec.track.id === state.tracks[0]?.id) drawWave()
    else drawTake(rec.surface?.canvas, take)
    renderNotes()
    log(`recorded ${(take.length / rate).toFixed(2)} s onto ${rec.track.name} (${take.length} samples, ${state.notes.length} notes)`)
    state.studio?.input?.refreshIfStale?.()
    return
  }

  if (!capture.isSupported()) throw new Error('mic unsupported')
  const track = recordTarget()
  const input = await state.studio?.input?.ensure()
  if (!input) {
    status('ready')
    throw new Error('recording needs mic access — take kept')
  }
  const rec = await capture.startRecording({ input, channel: state.studio.input.channel() })
  rec.track = track
  rec.input = input
  rec.surface = takeSurface(track)
  input.live?.clear()
  state.rec = rec
  $('btn-record').classList.add('on')
  $('mic-state').textContent = 'mic live'
  $('rec-timer').textContent = '0.0s'
  status('recording')
  const started = performance.now()
  rec.started = started
  state.timer = setInterval(() => {
    $('rec-timer').textContent = `${((performance.now() - started) / 1000).toFixed(1)}s`
  }, 100)
  startLiveTake(track, rec)
}

// ---- playback --------------------------------------------------------------
function stopPlayback() {
  state.playing.forEach(src => { try { src.stop() } catch { /* already done */ } })
  state.playing = []
  state.live = []
  state.ctx?.close()
  state.ctx = null
  $('btn-play').disabled = !state.notes.length
  $('btn-stop').disabled = true
}

// Live correction: every sounding note owns a shifter node, and any parameter
// drag re-posts the current shift into it, so the sound moves under the finger.
function liveRefresh() {
  if (!state.live?.length) return
  state.live.forEach(({ index, node }) => {
    shifter.set(node, autopitch.liveShift(state.notes[index], state.apState))
  })
}

// The take as the region settings say to play it: reversed copy when flipped.
function regionWave() {
  if (!state.region.reverse) return state.take
  const out = Float32Array.from(state.take)
  out.reverse()
  return out
}

function paintRegion() {
  const r = state.region
  $('reg-name').textContent = state.notes.length ? 'Skin' : 'no take'
  $('out-reg-pitch').textContent = `${r.pitch > 0 ? '+' : ''}${r.pitch}`
  $('out-reg-rate').textContent = r.rate.toFixed(2)
  $('in-reg-gain').value = String(r.gainDb)
  $('out-reg-gain').textContent = `${r.gainDb > 0 ? '+' : ''}${r.gainDb.toFixed(1)} dB`
  $('btn-reg-reverse').setAttribute('aria-pressed', String(r.reverse))
  paintRegionWave()
}

function paintRegionWave() {
  const canvas = $('reg-wave')
  if (!canvas) return
  const w = canvas.clientWidth || 900
  const h = canvas.clientHeight || 150
  canvas.width = w
  canvas.height = h
  const ctx2d = canvas.getContext('2d')
  ctx2d.clearRect(0, 0, w, h)
  if (!state.take?.length) return
  if (!state.peakCache) state.peakCache = waves.buildCache(state.take, state.sampleRate)
  const cols = waves.columns(state.peakCache, 0, state.take.length, w)
  ctx2d.fillStyle = 'rgba(0,198,209,0.85)'
  const mid = h / 2
  for (let x = 0; x < cols.peak.length; x++) {
    const amp = Math.max(1, cols.peak[x] * mid)
    ctx2d.fillRect(x, mid - amp, 1, amp * 2)
  }
  // the reference ruler counts bars across the whole region, cropped audio or not
  const ruler = $('reg-ruler')
  const bpm = Number($('in-bpm')?.value) || 96
  const bars = Math.max(2, Math.round((state.take.length / state.sampleRate) * bpm / 240))
  ruler.innerHTML = Array.from({ length: 10 }, (_, i) => `<span>${Math.max(1, Math.round(1 + i * (bars / 9)))}</span>`).join('')
}

function setRegion(patch) {
  state.region = { ...state.region, ...patch }
  paintRegion()
  if (state.playing.length) play()
}

async function playNotes(notes, opts = {}) {
  if (!state.take?.length || !notes?.length) return
  stopPlayback()
  const ctx = new AudioContext({ sampleRate: state.sampleRate })
  state.ctx = ctx
  const live = await shifter.ready(ctx)
  if (state.ctx !== ctx) return
  const src0 = regionWave()
  const buffer = ctx.createBuffer(1, src0.length, state.sampleRate)
  buffer.copyToChannel(src0, 0)
  const gain = ctx.createGain()
  gain.gain.value = Math.pow(10, (Number($('in-gain').value) + (opts.gainDb || 0) + state.region.gainDb) / 20)
  gain.connect(ctx.destination)
  const now = ctx.currentTime + 0.06
  const spread = (opts.spreadMs || 0) / 1000
  state.live = []
  notes.forEach((note, i) => {
    const cents = Number.isFinite(note.cents) ? note.cents : 0
    // `shift` is the real transposition applied by tuning; fall back to the
    // residual cents for notes that never carried a take pitch
    const pitch = Number.isFinite(note.shift) ? note.shift : cents / 100
    const offset = Number.isFinite(opts.offsets?.[i]) ? opts.offsets[i] : 0
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value *= state.region.rate
    if (live && !offset) {
      const node = shifter.create(ctx, pitch + state.region.pitch)
      src.connect(node).connect(gain)
      state.live.push({ index: i, node })
    } else {
      src.playbackRate.value *= Math.pow(2, (pitch + state.region.pitch) / 12 + offset / 12)
      src.connect(gain)
    }
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
  const hs = $('harmony-state')
  if (hs) hs.textContent = state.harmonies.length ? `${state.harmonies.length} sets` : 'no sets'
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
  keepTake(out, state.sampleRate)
  state.notes = pitch.detectNotes(out, state.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  const vs = $('voice-state')
  if (vs) vs.textContent = name
  $('mic-state').textContent = `character: ${name}`
  resetHarmonies()
  const barSeconds = (60 / Number($('in-bpm').value)) * 4
  buildRuler(Math.ceil(state.demoDuration / barSeconds) + 4)
  state.playhead = 0
  if ($('playhead')) $('playhead').style.left = '0px'
  drawWave()
  renderNotes()
  log(`voice: ${name}, ${out.length} samples, ${state.notes.length} notes re-detected`)
}

// ---- autotune --------------------------------------------------------------
// Same engine the snap slider uses: snapStrength from each note's original
// pitch, so repeated clicks cannot compound and the strength is the slider.
function autotune() {
  if (!state.notes.length) throw new Error('no notes to autotune')
  const root = Number($('in-root').value)
  const scale = $('in-mode').value
  const strength = Number($('in-snap').value)
  const amount = Math.min(1, Math.max(0, strength / 100))
  const before = state.notes.map(n => (Number.isFinite(n.origMidi) ? n.origMidi : n.midi))
  state.notes = tune.snapStrength(
    state.notes.map((n, i) => ({ ...n, midi: before[i] })),
    { root, scale, amount },
  )
  const corrected = state.notes.filter((n, i) => Math.abs(n.midi - before[i]) > 1e-6).length
  state.selected = null
  resetHarmonies()
  renderNotes()
  log(`autotune: ${corrected} notes corrected to ${NAMES[root]} ${scale} at ${strength}%`)
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
  keepTake(out, state.sampleRate)
  state.stems = null
  state.notes = pitch.detectNotes(out, state.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  $('stem-readout').textContent = `recombined ${out.length} samples`
  resetHarmonies()
  const barSeconds = (60 / Number($('in-bpm').value)) * 4
  buildRuler(Math.ceil(state.demoDuration / barSeconds) + 4)
  state.playhead = 0
  if ($('playhead')) $('playhead').style.left = '0px'
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
  state.take = keepTake(mixed, state.sampleRate)
  state.notes = pitch.detectNotes(mixed, state.sampleRate).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  resetHarmonies()
  const barSeconds = (60 / Number($('in-bpm').value)) * 4
  buildRuler(Math.ceil(state.demoDuration / barSeconds) + 4)
  state.playhead = 0
  if ($('playhead')) $('playhead').style.left = '0px'
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
    scale: $('in-mode').value,
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
    scale: $('in-mode').value,
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
  $('in-mode').value = patch.tune.scale
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
  document.querySelectorAll('#preset-list button').forEach(b => {
    const on = b.dataset.name === label
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', String(on))
  })
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
  patch.tune = { root: Number($('in-root').value), scale: $('in-mode').value, amount: Number($('in-snap').value) / 100 }
  const s = settings()
  patch.master = { eq: s.eq, comp: s.comp, limitDb: s.limitDb, targetRmsDb: s.targetRmsDb }
  patch.vocal = { gainDb: s.vocalGainDb, reverbMix: patch.vocal.reverbMix }
  return patch
}

// ---- project ---------------------------------------------------------------
// Save/open live in js/persist.js now: one local slot per browser, a full-state
// restore, and a `.apollo.json` download. app.js only binds the picker.

// ---- demo ------------------------------------------------------------------
const DEMO_FILE = 'assets/skin.wav'
const DEMO_ROWS = 120
const DEMO_FRAME = 4096

// A 106 s take is ~46x the old 2.4 s phrase, so detection runs on a decimated
// copy: 12 kHz keeps every sung fundamental but cuts the autocorrelation work
// by ~4x, and the extra frames cost nothing. Rows are capped so the DOM stays
// scrollable on a full song.
async function detectTakeNotes(take, rate) {
  const factor = Math.max(1, Math.round(rate / 12000))
  const len = Math.floor(take.length / factor)
  const small = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let sum = 0
    for (let j = 0; j < factor; j++) sum += take[i * factor + j]
    small[i] = sum / factor
  }
  const notes = pitch.detectNotes(small, rate / factor, { frame: DEMO_FRAME, hop: DEMO_FRAME, minDur: 0.12 })
  return notes.slice(0, DEMO_ROWS)
}

async function loadDemo() {
  const res = await fetch(DEMO_FILE)
  if (!res.ok) throw new Error(`demo: ${DEMO_FILE} -> HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  // A throwaway context decodes the file; state.ctx belongs to playback.
  const scratch = new AudioContext()
  let buffer
  try {
    buffer = await scratch.decodeAudioData(bytes)
  } catch {
    throw new Error(`demo: ${DEMO_FILE} did not decode`)
  } finally {
    scratch.close()
  }
  const take = Float32Array.from(buffer.getChannelData(0))
  if (!take.length) throw new Error(`demo: ${DEMO_FILE} is empty`)

  state.sampleRate = buffer.sampleRate
  state.demoDuration = take.length / buffer.sampleRate
  state.take = keepTake(take, buffer.sampleRate, state.tracks?.[0]?.id)
  // a recorded take sizes the region to itself; the demo take owns the lane
  const firstTrack = state.tracks?.[0]
  if (firstTrack?.clip) { firstTrack.clip.startBeat = 0; firstTrack.clip.lengthBeats = 4 }
  const firstClip = document.getElementById('clip-1')
  if (firstClip) { firstClip.style.width = ''; firstClip.style.minWidth = '' }
  state.notes = (await detectTakeNotes(take, buffer.sampleRate)).map(n => ({ ...n, origMidi: n.midi }))
  state.selected = null
  $('mic-state').textContent = 'skin'
  $('proj-name').value = 'Skin'
  const head = document.querySelector('.clip-head b')
  if (head) head.textContent = 'Skin'
  // raw take: leave the take off the grid so autotune has visible work to do
  $('in-snap').value = '0'
  $('out-snap').textContent = '0%'
  resetHarmonies()
  const barSeconds = (60 / Number($('in-bpm').value)) * 4
  buildRuler(Math.ceil(state.demoDuration / barSeconds) + 4)
  state.playhead = 0
  if ($('playhead')) $('playhead').style.left = '0px'
  drawWave()
  renderNotes()
  log(`demo: ${state.notes.length} notes detected`)
}

// ---- export ----------------------------------------------------------------
function gainDb(samples, db) {
  const g = Math.pow(10, db / 20)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g
  return out
}

function exportWav() {
  if (!state.take?.length) throw new Error('nothing to export')
  const rate = Number($('in-rate').value)
  // Corrections are baked in before mastering, so what is exported is what
  // playback sounds like. A fully in-tune take copies through untouched.
  const tuned = state.notes.filter(n => Number.isFinite(n.shift) && Math.abs(n.shift) > 0.001)
  let mix = tuned.length
    ? tune.renderTuned(state.take, state.notes, { sampleRate: state.sampleRate }).samples
    : state.take
  if (state.region.reverse) { mix = Float32Array.from(mix); mix.reverse() }
  if (state.region.gainDb) mix = gainDb(mix, state.region.gainDb)
  const { stereo, report } = masterChain(stereoFrom(mix), settings(), state.sampleRate)
  const bytes = encodeWav(stereo, rate)
  download(new Blob([bytes], { type: 'audio/wav' }), `apollo-studios-${Date.now()}.wav`)
  log(`exported ${bytes.length} bytes @ ${rate} Hz, peak ${report.peakDb.toFixed(2)} dB, gain ${report.gainDb.toFixed(2)} dB${tuned.length ? `, ${tuned.length} notes tuned` : ''}`)
  status('exported')
}

// ---- boot ------------------------------------------------------------------
function boot() {
  $('in-root').innerHTML = NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')
  // the project key is a root plus major or minor, as the product shows it
  // major/minor are the product's two keys; chromatic stays for the factory
  // patches that do not constrain to a key at all
  $('in-mode').innerHTML = [['major', 'maj'], ['minor', 'min'], ['chromatic', 'chromatic']]
    .map(([v, label]) => `<option value="${v}"${v === 'minor' ? ' selected' : ''}>${label}</option>`).join('')
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
  buildRuler()
  renderBands()
  renderPresets()
  renderHarmonies()
  drawWave()
  renderNotes()

  $('btn-record').addEventListener('click', guard(toggleRecord))
  $('btn-pitch-down').addEventListener('click', () => setRegion({ pitch: Math.max(-12, state.region.pitch - 1) }))
  $('btn-pitch-up').addEventListener('click', () => setRegion({ pitch: Math.min(12, state.region.pitch + 1) }))
  $('btn-rate-down').addEventListener('click', () => setRegion({ rate: Math.max(0.5, Number((state.region.rate - 0.05).toFixed(2))) }))
  $('btn-rate-up').addEventListener('click', () => setRegion({ rate: Math.min(2, Number((state.region.rate + 0.05).toFixed(2))) }))
  $('in-reg-gain').addEventListener('input', (e) => setRegion({ gainDb: Number(e.target.value) }))
  $('btn-reg-reverse').addEventListener('click', () => { setRegion({ reverse: !state.region.reverse }); log(`region ${state.region.reverse ? 'reversed' : 'forward'}`) })
  $('btn-reg-retune').addEventListener('click', guard(autotune))
  $('btn-reg-close').addEventListener('click', () => openPanel('harmony'))
  $('btn-play').addEventListener('click', guard(play))
  $('btn-stop').addEventListener('click', stopPlayback)
  $('btn-analyze').addEventListener('click', guard(readMeter))
  $('btn-export').addEventListener('click', guard(exportWav))
  // #btn-save is owned by js/persist.js (local slot + Last Saved stamp)
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
  // the file pickers sit behind labels; labels are not focusable targets by themselves
  document.querySelectorAll('label[role="button"]').forEach((label) => {
    label.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      label.querySelector('input[type=file]')?.click()
    })
  })
  $('file-preset').addEventListener('change', guard(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const result = presets.parsePatch(await file.text())
    if (!result.ok) throw new Error(result.error)
    applyPatch(result.patch, result.patch.name)
    log(`preset imported: ${result.patch.name}`)
    e.target.value = ''
  }))
  // the project's file picker: js/persist.js does the parsing and the restore
  $('file-project').addEventListener('change', guard(async (e) => {
    const file = e.target.files?.[0]
    if (file) await state.persist?.openFile?.(file)
    e.target.value = ''
  }))

  /* toolbar / rail / tab chrome: a drawer button shows its panel; any Export button exports */
  const TAB_FOR = { tools: 'harmony', presets: 'harmony' }
  const openPanel = (name, focusPanel) => {
    const panel = document.getElementById('p-' + name)
    if (!panel) return
    const tabName = TAB_FOR[name] || name
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p !== panel })
    document.body.classList.add('panel-open')
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.drawer === tabName
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
  // #btn-export has its own listener above; this covers the extra data-export buttons
  document.querySelectorAll('[data-export]:not(#btn-export)').forEach((el) => {
    el.addEventListener('click', guard(exportWav))
  })

  const retune = () => { renderNotes() }
  $('in-root').addEventListener('change', retune)
  $('in-mode').addEventListener('change', retune)
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
    autotune,
    drawWave,
    attachTake,
    harmonySet(name) {
      $('in-harmony').value = name
      buildHarmonies()
      return state.harmonies.map(s => s.label)
    },
    split,
  }
  const app = { state, log, status, openPanel, playheadSeconds, syncTuning, renderNotes, renderBands, exportWav, liveRefresh }
  window.__app = app // probe hook: tests read the model through this
  state.studio = attachStudio(app)
  installPanels({ state, log })
  installTimeline({ state, log })
  installEdit({ state, log })
  installPersist({ state, log })
  state.studio?.input?.syncArmed?.()
  icons.hydrate()
  new MutationObserver((rows) => rows.forEach((r) => r.addedNodes.forEach((n) => {
    if (n.nodeType === 1) icons.hydrate(n)
  }))).observe(document.body, { childList: true, subtree: true })
  $('lane').addEventListener('pointerdown', setPlayheadFromEvent)
  $('lane').addEventListener('scroll', () => { const rr = $('ruler-row'); if (rr) rr.scrollLeft = $('lane').scrollLeft })
  $('ruler').parentElement.classList.add('ruler-scroll')
  window.addEventListener('pagehide', () => { stopLiveTake(); state.studio?.input?.close() })
  status('ready')
}

try { boot() } catch (err) {
  window.__bootErr = err?.stack || String(err)
  log(`boot failed: ${err?.message}`)
  status('boot failed')
}
