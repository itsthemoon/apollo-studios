// js/studio.js — the multi-track shell: tracks, mixer, automation, roll editor,
// effect chains, AutoPitch, mastering, browser, versions, chat and shortcuts.
// Split out of app.js so the take-level editing code stays readable.

import * as tracks from './tracks.js'
import * as automation from './automation.js'
import * as synth from './synth.js'
import * as drums from './drums.js'
import * as library from './library.js'
import * as versions from './versions.js'
import * as mastering2 from './mastering2.js'
import * as autopitch from './autopitch.js'
import * as shortcuts from './shortcuts.js'
import * as fx from './fx.js'
import * as roll from './roll.js'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const $ = (id) => document.getElementById(id)

export function attach(app) {
  const state = app.state
  state.tracks = [tracks.createTrack({ type: 'voice', name: 'Voice/Audio', index: 0 })]
  state.tracks[0].chain = fx.createChain()
  state.active = state.tracks[0].id
  state.rolls = new Map()
  state.patterns = new Map()
  state.undoRoll = []
  state.lyrics = []
  state.chat = []
  state.versions = []
  state.favourites = []
  state.member = false
  state.showAutomation = false
  state.autoArm = false
  state.follow = true
  state.loop = null
  state.stretch = false
  state.sound = null
  state.masterState = mastering2.createState()
  state.apState = autopitch.createState()
  state.fxTarget = null
  state.clipGainDb = 0

  const ADJECTIVES = ['midnight', 'paper', 'neon', 'velvet', 'static', 'amber', 'glass', 'ember']

  // ---------------------------------------------------------------- menus and modals
  const closeAll = () => {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true })
    document.querySelectorAll('.modal:not([hidden])').forEach(m => closeModal(m))
  }
  const openMenu = (el, x, y) => {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true })
    el.hidden = false
    const r = el.getBoundingClientRect()
    const left = Math.min(Math.max(8, x ?? r.left), innerWidth - r.width - 12)
    el.style.left = `${left}px`
    el.style.top = `${Math.min(Math.max(8, y ?? r.bottom + 6), innerHeight - r.height - 12)}px`
  }
  function closeModal(m) { m.hidden = true }
  const openModal = (name) => {
    const m = document.getElementById('m-' + name)
    if (!m) return
    closeAll()
    m.hidden = false
    m.querySelector('button, input, select')?.focus()
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-menu], [data-modal], [data-close]')
    if (!t) return
    if (t.dataset.close !== undefined) { closeModal(t.closest('.modal')); return }
    if (t.dataset.modal) { openModal(t.dataset.modal); return }
    const m = document.getElementById('menu-' + t.dataset.menu)
    if (m) openMenu(m, t.getBoundingClientRect().left, t.getBoundingClientRect().bottom + 6)
  })
  document.addEventListener('click', (e) => {
    if (e.target.closest('.menu') || e.target.closest('[data-menu]')) return
    document.querySelectorAll('.menu').forEach(m => { m.hidden = true })
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.modal:not([hidden])')
      if (open) { closeModal(open); e.preventDefault(); return }
      document.querySelectorAll('.menu').forEach(m => { m.hidden = true })
    }
  })
  $('m-addtrack').addEventListener('click', (e) => { if (e.target === $('m-addtrack')) closeModal($('m-addtrack')) })

  // ---------------------------------------------------------------- panels
  document.querySelectorAll('[data-panel-open]').forEach((el) => {
    el.addEventListener('click', (e) => { e.preventDefault(); app.openPanel(el.dataset.panelOpen.replace('p-', '')) })
  })

  // ---------------------------------------------------------------- tracks
  const clamps = { vol: tracks.clampDb, pan: tracks.clampPan }

  function renderTrackList() {
    const host = $('track-list')
    const laneRows = $('lane-rows')
    host.innerHTML = ''
    laneRows.innerHTML = ''
    state.tracks.slice(1).forEach((t, i) => {
      if (!t.chain?.effects) t.chain = fx.createChain()
      const box = document.createElement('div')
      box.className = 'track-head'
      box.dataset.track = t.id
      const info = tracks.typeInfo(t.type)
      box.innerHTML = `
        <div class="th-row">
          <span class="colour" data-colour="${t.color}" aria-hidden="true"></span>
          <span class="ticon" aria-hidden="true">${info.icon}</span>
          <b><i class="tnum">${String(i + 2).padStart(2, '0')}</i> <span class="tname" contenteditable="true" spellcheck="false">${t.name}</span></b>
          <button class="ic mini" type="button" aria-label="More actions" data-track-menu="${t.id}">&#8942;</button>
          <span class="th-spacer"></span>
          <button class="arm" type="button" aria-label="Arm track for recording" data-arm="${t.id}" aria-pressed="${t.armed}">&#9679;</button>
          <button class="ms" type="button" aria-label="Mute" data-mute="${t.id}" aria-pressed="${t.mute}">M</button>
          <button class="ms" type="button" aria-label="Solo" data-solo="${t.id}" aria-pressed="${t.solo}">S</button>
          <span class="chev" aria-hidden="true">&#8250;</span>
        </div>
        <div class="th-row">
          <button class="fx" type="button" aria-label="Add a plug-in" data-fx="${t.id}">+ Fx</button>
          <span class="fx-count" data-fx-count="${t.id}">${t.chain.effects.length ? t.chain.effects.length + ' effects' : 'no effects'}</span>
          <span class="th-spacer"></span>
          <label class="panwrap" title="Pan"><input class="panin" type="range" min="-100" max="100" value="${t.pan * 100}" aria-label="Pan ${t.name}" data-pan="${t.id}"></label>
        </div>
        <div class="th-row vol-row">
          <input class="th-vol" type="range" min="-60" max="6" value="${t.volumeDb}" step="0.5" aria-label="${t.name} volume" data-vol="${t.id}">
          <span class="th-vol-read" data-vol-read="${t.id}">${t.volumeDb.toFixed(1)} dB</span>
          <span class="th-meter" aria-hidden="true"><i></i></span>
        </div>
        `
      host.append(box)

      const row = document.createElement('div')
      row.className = 'lane-row'
      row.dataset.row = t.id
      const rollOf = state.rolls.get(t.id)
      const label = t.type === 'instrument' ? `${rollOf?.notes.length || 0} notes`
        : t.type === 'drums' ? 'pattern' : 'region'
      row.innerHTML = `<div class="ghost-clip" data-ghost="${t.id}">
          ${t.type === 'instrument' ? '<canvas class="mini-roll" width="220" height="96"></canvas>' : ''}
          <span>${label}</span></div>
        <div class="automation-lane" data-automation="${t.id}" hidden>
        <canvas class="auto-canvas" width="240" height="46" role="img" aria-label="Volume automation for ${t.name}"></canvas>
        <span class="auto-legend">vol <button class="ic mini" type="button" data-auto-param="${t.id}:pan">pan</button></span></div>`
      laneRows.append(row)
      if (t.type === 'instrument' && rollOf) renderRoll(row.querySelector('.mini-roll'), rollOf, { rows: 24, preview: true })
    })
    renderMixer()
  }

  function findTrack(id) { return state.tracks.find(t => t.id === id) }

  document.addEventListener('click', (e) => {
    const head = e.target.closest('.track-head')
    if (!head || e.target.closest('button, input, [contenteditable]')) return
    state.active = head.dataset.track
    document.querySelectorAll('.track-head').forEach(h => h.classList.toggle('on', h === head))
    renderChain(findTrack(state.active))
    drawRoll()
  })

  function syncTrackDom(t) {
    document.querySelectorAll(`[data-mute="${t.id}"], [data-solo="${t.id}"], [data-arm="${t.id}"]`)
      .forEach(b => {
        const k = b.dataset.mute ? 'mute' : b.dataset.solo ? 'solo' : 'armed'
        b.setAttribute('aria-pressed', String(t[k]))
      })
    const v = document.querySelector(`[data-vol="${t.id}"]`)
    if (v) v.value = String(t.volumeDb)
    const vr = document.querySelector(`[data-vol-read="${t.id}"]`)
    if (vr) vr.textContent = `${t.volumeDb.toFixed(1)} dB`
    const p = document.querySelector(`[data-pan="${t.id}"]`)
    if (p) p.value = String(t.pan * 100)
    const c = document.querySelector(`[data-colour="${t.id}"]`)
    if (c) c.dataset.colour = String(t.color)
    const n = document.querySelector(`[data-track="${t.id}"] .tname`)
    if (n && n.textContent !== t.name) n.textContent = t.name
    const fc = document.querySelector(`[data-fx-count="${t.id}"]`)
    if (fc) fc.textContent = t.chain.effects.length ? `${t.chain.effects.length} effects` : 'no effects'
  }

  document.addEventListener('input', (e) => {
    const el = e.target
    if (el.dataset.vol) {
      const t = findTrack(el.dataset.vol)
      tracks.setVolumeDb(t, Number(el.value))
      el.closest('.vol-row').querySelector('[data-vol-read]').textContent = `${t.volumeDb.toFixed(1)} dB`
      renderMixer()
    }
    if (el.dataset.pan) tracks.setPan(findTrack(el.dataset.pan), Number(el.value) / 100)
  })

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mute], [data-solo], [data-arm], [data-track-menu], [data-fx]')
    if (!el) return
    if (el.dataset.mute) { tracks.toggleMute(findTrack(el.dataset.mute)); syncTrackDom(findTrack(el.dataset.mute)); syncAudibility() }
    else if (el.dataset.solo) { tracks.toggleSolo(findTrack(el.dataset.solo)); syncAll() }
    else if (el.dataset.arm) { tracks.toggleArm(findTrack(el.dataset.arm)); syncTrackDom(findTrack(el.dataset.arm)); syncAudibility() }
    else if (el.dataset.trackMenu) {
      state.fxTarget = el.dataset.trackMenu
      openMenu($('menu-track'), el.getBoundingClientRect().left, el.getBoundingClientRect().bottom + 6)
    } else if (el.dataset.fx) { state.fxTarget = el.dataset.fx; openModal('fx') }
  })

  document.addEventListener('focusout', (e) => {
    const n = e.target.closest?.('.tname')
    if (!n) return
    const box = n.closest('[data-track]')
    const t = findTrack(box?.dataset.track)
    if (t) { tracks.rename(t, n.textContent.trim() || tracks.typeInfo(t.type).label); syncTrackDom(t) }
  })

  function syncAudibility() {
    const audible = tracks.resolveSolo(state.tracks)
    state.tracks.forEach((t) => {
      const strip = document.querySelector(`[data-strip="${t.id}"]`)
      if (strip) strip.classList.toggle('off', !audible.has(t.id))
    })
  }
  function syncAll() { state.tracks.forEach(syncTrackDom); syncAudibility() }

  // add track
  $('track-types').innerHTML = tracks.TRACK_TYPES.map(t =>
    `<button class="type" type="button" role="listitem" data-type="${t.slug}">
       <span aria-hidden="true">${t.icon}</span><span><b>${t.label}</b><i>${t.hint}</i></span></button>`).join('')
  $('track-types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]')
    if (!b) return
    const t = tracks.addTrack(state.tracks, { type: b.dataset.type, name: tracks.typeInfo(b.dataset.type).label })
    t.chain = fx.createChain()
    if (t.type === 'instrument') state.rolls.set(t.id, roll.createRoll())
    state.active = t.id
    if (t.type === 'drums') state.patterns.set(t.id, drums.createPattern())
    closeModal($('m-addtrack'))
    renderTrackList()
    syncAudibility()
    app.log(`track added: ${t.name}`)
  })

  // track menu actions
  $('menu-track').addEventListener('click', (e) => {
    const b = e.target.closest('[data-track-act]')
    const t = findTrack(state.fxTarget)
    if (!b || !t) return
    const act = b.dataset.trackAct
    if (act === 'rename') { document.querySelector(`[data-track="${t.id}"] .tname`)?.focus() }
    if (act === 'duplicate') { const copy = tracks.duplicateTrack(state.tracks, t.id); if (copy) { copy.chain = fx.createChain(); if (copy.roll) state.rolls.set(copy.id, roll.createRoll()) } renderTrackList(); syncAudibility(); app.log(`duplicated ${t.name}`) }
    if (act === 'colour') { tracks.setColor(t, (t.color % 6) + 1); syncTrackDom(t) }
    if (act === 'automation') { state.showAutomation = true; toggleAutomation(true) }
    if (act === 'bounce') { app.log(`bounced ${t.name} to audio`); app.status('bounced') }
    if (act === 'delete') {
      if (state.tracks.length === 1) { app.log('the last track stays'); return }
      tracks.removeTrack(state.tracks, t.id)
      renderTrackList(); syncAudibility(); app.log(`deleted ${t.name}`)
    }
    $('menu-track').hidden = true
  })

  // ---------------------------------------------------------------- automation
  function toggleAutomation(on) {
    state.showAutomation = on ?? !state.showAutomation
    document.querySelectorAll('[data-automation]').forEach((l) => { l.hidden = !state.showAutomation })
    $('btn-automation').setAttribute('aria-pressed', String(state.showAutomation))
    if (state.showAutomation) state.tracks.forEach(drawAutomation)
  }
  $('btn-automation').addEventListener('click', () => toggleAutomation())
  $('btn-automation-arm').addEventListener('click', () => {
    state.autoArm = !state.autoArm
    $('btn-automation-arm').setAttribute('aria-pressed', String(state.autoArm))
    app.log(`automation recording ${state.autoArm ? 'armed' : 'off'}`)
  })

  function drawAutomation(t) {
    const lane = document.querySelector(`[data-automation="${t.id}"] canvas`)
    if (!lane) return
    const g = lane.getContext('2d')
    const { width: w, height: h } = lane
    g.clearRect(0, 0, w, h)
    const param = lane.dataset.param || 'volume'
    const pts = t.automation[param] || []
    const rg = automation.PARAM_RANGES[param]
    const y = (v) => h - 3 - ((v - rg.min) / (rg.max - rg.min)) * (h - 6)
    if (!pts.length) {
      g.strokeStyle = '#2c3a40'
      g.setLineDash([3, 4])
      g.beginPath(); g.moveTo(0, y(param === 'pan' ? 0 : 0)); g.lineTo(w, y(0)); g.stroke()
      g.setLineDash([])
      return
    }
    g.strokeStyle = '#6fa8ff'
    g.lineWidth = 1.5
    g.beginPath()
    pts.forEach((p, i) => {
      const x = 3 + p.t * (w - 6)
      i ? g.lineTo(x, y(p.value)) : g.moveTo(x, y(p.value))
    })
    g.stroke()
    g.fillStyle = '#bfd8ff'
    pts.forEach((p) => { g.beginPath(); g.arc(3 + p.t * (w - 6), y(p.value), 2.4, 0, Math.PI * 2); g.fill() })
  }

  document.addEventListener('click', (e) => {
    const lane = e.target.closest('.auto-canvas')
    if (!lane) return
    const box = lane.closest('[data-automation]')
    const t = findTrack(box.dataset.automation)
    const param = box.querySelector('canvas').dataset.param || 'volume'
    const r = lane.getBoundingClientRect()
    const tn = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const vn = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    const range = automation.PARAM_RANGES[param]
    const value = range.min + vn * (range.max - range.min)
    t.automation[param] = automation.addPoint(t.automation[param], tn, value)
    drawAutomation(t)
  })
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-auto-param]')
    if (!b) return
    const [id, param] = b.dataset.autoParam.split(':')
    const cv = document.querySelector(`[data-automation="${id}"] canvas`)
    cv.dataset.param = param
    b.textContent = param === 'pan' ? 'vol' : 'pan'
    drawAutomation(findTrack(id))
  })

  // ---------------------------------------------------------------- mixer
  function renderMixer() {
    const host = $('strips')
    if (!host) return
    host.innerHTML = ''
    const audible = tracks.resolveSolo(state.tracks)
    state.tracks.forEach((t) => {
      const s = document.createElement('div')
      s.className = `strip${audible.has(t.id) ? '' : ' off'}`
      s.dataset.strip = t.id
      s.innerHTML = `<b>${t.name}</b>
        <input type="range" min="-60" max="6" value="${t.volumeDb}" step="0.5" aria-label="${t.name} fader" data-vol="${t.id}">
        <span class="db">${t.volumeDb.toFixed(1)}</span>
        <input type="range" min="-100" max="100" value="${t.pan * 100}" aria-label="${t.name} pan" data-pan="${t.id}">
        <span class="mstag"><button class="ms" type="button" aria-label="Mute ${t.name}" data-mute="${t.id}" aria-pressed="${t.mute}">M</button>
        <button class="ms" type="button" aria-label="Solo ${t.name}" data-solo="${t.id}" aria-pressed="${t.solo}">S</button></span>`
      host.append(s)
    })
    const m = document.createElement('div')
    m.className = 'strip master'
    m.innerHTML = `<b>Master</b><input type="range" min="-12" max="12" value="${$('in-gain').value}" aria-label="Master fader"><span class="db">${$('out-gain').textContent}</span>`
    m.querySelector('input').addEventListener('input', (e) => { $('in-gain').value = e.target.value; $('in-gain').dispatchEvent(new Event('input')) })
    host.append(m)
  }
  $('btn-mixer').addEventListener('click', () => {
    const m = $('mixer')
    m.hidden = !m.hidden
    if (!m.hidden) renderMixer()
  })
  $('btn-mixer-close').addEventListener('click', () => { $('mixer').hidden = true })

  // ---------------------------------------------------------------- roll editor
  const ROLL_W = 1400
  const ROLL_H = 260
  const ROWS = 24
  function activeRoll() { return state.rolls.get(state.active) }

  function drawRoll() { renderRoll($('roll'), activeRoll(), { rows: ROWS, preview: false }) }

  function renderRoll(cv, r, opts = {}) {
    if (!cv) return
    const g = cv.getContext('2d')
    const W = cv.width
    const H = cv.height
    const rows = opts.rows || ROWS
    g.clearRect(0, 0, W, H)
    if (!r) {
      $('note-count').textContent = state.notes.length ? `${state.notes.length} take notes` : 'no notes'
      g.fillStyle = '#0a0e10'
      g.fillRect(0, 0, W, H)
      g.fillStyle = '#192124'
      for (let b = 0; b <= 32; b += 4) g.fillRect(b * (W / 32), 0, 1, H)
      return
    }
    const rowH = H / rows
    const beatW = W / r.lengthBeats
    for (let row = 0; row < rows; row++) {
      const midi = r.lowMidi + (rows - 1 - row)
      g.fillStyle = [1, 3, 6, 8, 10].includes(midi % 12) ? '#0a0e10' : '#0d1315'
      g.fillRect(0, row * rowH, W, rowH)
      g.fillStyle = '#1b2225'
      g.fillRect(0, row * rowH + rowH - 1, W, 1)
    }
    for (let b = 0; b <= r.lengthBeats; b += 1) {
      g.fillStyle = b % 4 === 0 ? '#243034' : '#192124'
      g.fillRect(b * beatW, 0, 1, H)
    }
    r.notes.forEach((n) => {
      const row = rows - 1 - (n.midi - r.lowMidi)
      if (row < 0 || row >= rows) return
      g.fillStyle = opts.preview ? '#4e86c9' : '#6fa8ff'
      g.fillRect(n.start * beatW, row * rowH + 2, Math.max(3, n.dur * beatW), Math.max(2, rowH - 4))
    })
  }

  function refreshRollUi() {
    const t = findTrack(state.active)
    const r = activeRoll()
    if (!t || !r) return
    const ghost = document.querySelector(`[data-ghost="${t.id}"]`)
    if (ghost) {
      const span = ghost.querySelector('span')
      if (span) span.textContent = `${r.notes.length} notes`
      const mini = ghost.querySelector('.mini-roll')
      if (mini) renderRoll(mini, r, { rows: 24, preview: true })
    }
    $('note-count').textContent = `${r.notes.length} roll notes`
  }

  const rollPoint = (e) => {
    const r = activeRoll()
    const box = $('roll').getBoundingClientRect()
    const beat = Math.min(r.lengthBeats - 0.05, Math.max(0, ((e.clientX - box.left) / box.width) * r.lengthBeats))
    const row = Math.floor(((e.clientY - box.top) / box.height) * ROWS)
    return { beat, midi: r.lowMidi + (ROWS - 1 - row) }
  }
  $('roll').addEventListener('pointerdown', (e) => {
    const r = activeRoll()
    if (!r) { app.log('add an instrument track to use the roll'); return }
    const { beat, midi } = rollPoint(e)
    if (e.button === 2) {
      const hit = r.notes.find(n => n.midi === midi && beat >= n.start && beat <= n.start + n.dur)
      if (hit) { state.undoRoll.push(roll.cloneRoll(r)); roll.deleteNote(r, hit.id); drawRoll(); refreshRollUi() }
      return
    }
    state.undoRoll.push(roll.cloneRoll(r))
    roll.addNote(r, { midi, start: beat, dur: 0.5 })
    drawRoll(); refreshRollUi()
    previewRollNote(midi)
  })
  $('roll').addEventListener('contextmenu', (e) => e.preventDefault())

  let previewCtx = null
  function previewRollNote(midi) {
    try {
      previewCtx?.close()
      previewCtx = new AudioContext()
      synth.makeVoice(previewCtx, midi, previewCtx.currentTime + 0.01, 0.4, synth.VOICE_PRESETS.pad)
      setTimeout(() => { previewCtx?.close(); previewCtx = null }, 900)
    } catch { /* audio blocked */ }
  }

  $('btn-quantize').addEventListener('click', () => {
    const r = activeRoll()
    if (!r) return
    state.undoRoll.push(roll.cloneRoll(r))
    roll.quantize(r, Number($('in-quant').value), Number($('in-snap').value) / 100)
    drawRoll(); refreshRollUi()
    app.log('roll quantized')
  })
  $('btn-lock-scale').addEventListener('click', () => {
    const r = activeRoll()
    if (!r) return
    state.undoRoll.push(roll.cloneRoll(r))
    const root = Number($('in-root').value)
    roll.lockToScale(r, scalePitchClasses($('in-scale').value, root), root + 48)
    drawRoll(); refreshRollUi()
    app.log('roll locked to scale')
  })
  $('btn-roll-undo').addEventListener('click', () => {
    const r = activeRoll()
    const prev = state.undoRoll.pop()
    if (!r || !prev) return
    state.rolls.set(state.active, prev)
    drawRoll(); refreshRollUi()
  })

  function scalePitchClasses(name, root) {
    const MAP = {
      chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
      dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
      pentatonic: [0, 2, 4, 7, 9], pentatonicminor: [0, 3, 5, 7, 10],
    }
    return (MAP[name] || MAP.chromatic).map(i => (i + root) % 12)
  }

  // ---------------------------------------------------------------- effect chains
  const fxCat = { value: 'all', query: '' }
  function renderFxBrowser() {
    $('fx-cats').innerHTML = [{ id: 'all', label: 'All' }, ...fx.FX_CATEGORIES]
      .map(c => `<button type="button" data-cat="${c.id}" class="${c.id === fxCat.value ? 'on' : ''}">${c.label}</button>`).join('')
    $('fx-list').innerHTML = fx.FX_LIST
      .filter(e => (fxCat.value === 'all' || e.category === fxCat.value) && (!fxCat.query || e.name.toLowerCase().includes(fxCat.query)))
      .map(e => `<button type="button" role="listitem" data-add="${e.slug}"><b>${e.name}</b><i>${e.category} · ${e.params.length} params</i></button>`).join('')
  }
  $('fx-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]')
    if (!b) return
    fxCat.value = b.dataset.cat
    renderFxBrowser()
  })
  $('in-fx-search').addEventListener('input', (e) => { fxCat.query = e.target.value.toLowerCase(); renderFxBrowser() })
  $('fx-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]')
    const t = findTrack(state.fxTarget)
    if (!b || !t) return
    try { fx.addEffect(t.chain, b.dataset.add); app.log(`effect added: ${b.dataset.add}`) }
    catch (err) { app.log(err.message); return }
    renderChain(t)
    syncTrackDom(t)
    closeModal($('m-fx'))
  })
  $('btn-fx-add').addEventListener('click', () => openModal('fx'))
  $('btn-fx-add').setAttribute('aria-label', 'Add an effect to the active track')

  function renderChain(t) {
    const host = $('fx-chain')
    host.innerHTML = ''
    t.chain.effects.forEach((effect) => {
      const row = document.createElement('div')
      row.className = `fxrow${effect.bypass ? ' off' : ''}`
      row.setAttribute('role', 'listitem')
      const spec = fx.FX_LIST.find(e => e.slug === effect.slug)
      row.innerHTML = `<b>${spec.name}</b><span class="lit">${effect.bypass ? 'bypassed' : 'active'}</span>
        <button class="ic mini" type="button" aria-label="Edit ${spec.name}" data-edit="${effect.id}">&#9998;</button>
        <button class="ic mini" type="button" aria-label="Bypass ${spec.name}" data-bypass="${effect.id}">&#9678;</button>`
      host.append(row)
    })
    const limiter = t.chain.effects.find(e => e.slug === fx.LIMITER_SLUG)
    if (!limiter) {
      const row = document.createElement('div')
      row.className = 'fxrow'
      row.innerHTML = '<b>Limiter</b><span class="lit">always last</span><span></span><span></span>'
      host.append(row)
    }
    const fc = document.querySelector(`[data-fx-count="${t.id}"]`)
    if (fc) fc.textContent = t.chain.effects.length ? `${t.chain.effects.length} effects` : 'no effects'
  }

  $('fx-chain').addEventListener('click', (e) => {
    const t = state.tracks.find(x => x.chain.effects.length && $('fx-chain').contains(e.target))
    const active = state.tracks.find(x => x.id === state.active) || t
    const b = e.target.closest('[data-edit], [data-bypass]')
    if (!b || !active) return
    const id = b.dataset.edit || b.dataset.bypass
    const effect = active.chain.effects.find(x => x.id === id)
    if (!effect) return
    if (b.dataset.bypass) { fx.setBypass(active.chain, id, !effect.bypass); renderChain(active); return }
    state.fxEditing = { track: active.id, id }
    openFxEditor(active, effect)
  })

  function openFxEditor(t, effect) {
    const spec = fx.FX_LIST.find(e => e.slug === effect.slug)
    $('fx-edit-title').textContent = spec.name
    const host = $('fx-edit-params')
    host.innerHTML = ''
    spec.params.forEach((p) => {
      const row = document.createElement('label')
      row.innerHTML = `<span>${p.name}</span><input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${effect.params[p.slug]}" aria-label="${spec.name} ${p.name}"><output>${fmt(effect.params[p.slug], p.unit)}</output>`
      const input = row.querySelector('input')
      input.addEventListener('input', () => {
        fx.setParam(t.chain, effect.id, p.slug, Number(input.value))
        row.querySelector('output').textContent = fmt(effect.params[p.slug], p.unit)
      })
      host.append(row)
    })
    openModal('fx-edit')
  }
  const fmt = (v, unit) => unit === '%' ? `${Math.round(v * 100)}%` : `${Number(v).toFixed(unit === 'Hz' || unit === 'ms' ? 0 : 2)} ${unit || ''}`.trim()

  $('btn-fx-bypass').addEventListener('click', () => {
    const { track, id } = state.fxEditing || {}
    const t = findTrack(track)
    const effect = t?.chain.effects.find(x => x.id === id)
    if (!effect) return
    fx.setBypass(t.chain, id, !effect.bypass)
    renderChain(t)
    closeModal($('m-fx-edit'))
  })
  $('btn-fx-remove').addEventListener('click', () => {
    const { track, id } = state.fxEditing || {}
    const t = findTrack(track)
    if (!t) return
    fx.removeEffect(t.chain, id)
    renderChain(t)
    closeModal($('m-fx-edit'))
  })
  $('btn-fx-up').addEventListener('click', () => moveEffect(-1))
  $('btn-fx-down').addEventListener('click', () => moveEffect(1))
  function moveEffect(delta) {
    const { track, id } = state.fxEditing || {}
    const t = findTrack(track)
    if (!t) return
    const from = t.chain.effects.findIndex(e => e.id === id)
    fx.moveEffect(t.chain, from, from + delta)
    renderChain(t)
  }

  // ---------------------------------------------------------------- AutoPitch
  $('ap-presets').innerHTML = autopitch.PRESETS.map(p =>
    `<button type="button" data-ap="${p.slug}" class="${p.tier === 'membership' ? 'locked' : ''}">${p.name}</button>`).join('')
  $('tonic-grid').innerHTML = autopitch.TONIC_GRID.map(t =>
    `<button type="button" data-tonic="${t.pitchClass}" aria-label="${t.name}">${t.name}</button>`).join('')
  $('in-ap-scale').innerHTML = autopitch.SCALE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('')

  function paintAp() {
    const s = state.apState
    document.querySelectorAll('[data-ap]').forEach(b => {
      const on = b.dataset.ap === s.preset
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    document.querySelectorAll('[data-tonic]').forEach(b => {
      const on = Number(b.dataset.tonic) === s.tonic
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    $('in-ap-scale').value = s.scale
    $('in-ap-strength').value = String(Math.round(s.strength * 100))
    $('out-ap-strength').textContent = `${Math.round(s.strength * 100)}%`
  }
  $('ap-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ap]')
    if (!b) return
    const p = autopitch.presetBySlug(b.dataset.ap)
    if (autopitch.isMembership(p) && !state.member) { app.log(`${p.name} needs Apollo Pro`); openModal('get'); return }
    autopitch.setPreset(state.apState, b.dataset.ap)
    paintAp()
  })
  $('tonic-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tonic]')
    if (!b) return
    autopitch.setTonic(state.apState, Number(b.dataset.tonic))
    paintAp()
  })
  $('in-ap-strength').addEventListener('input', (e) => {
    autopitch.setStrength(state.apState, Number(e.target.value) / 100)
    $('out-ap-strength').textContent = `${e.target.value}%`
  })
  $('in-ap-scale').addEventListener('change', (e) => { autopitch.setScale(state.apState, e.target.value); app.log(`scale ${e.target.value}`) })
  $('btn-autodetect').addEventListener('click', () => {
    const res = autopitch.detectKey(state.notes.map(n => n.midi))
    if (res.confidence < 0.2) { app.log('autodetect: not enough confident notes'); return }
    autopitch.setTonic(state.apState, res.tonic)
    autopitch.setScale(state.apState, res.scale)
    paintAp()
    app.log(`autodetect: ${NAMES[res.tonic]} ${res.scale} (${Math.round(res.confidence * 100)}%)`)
  })
  $('btn-autopitch').addEventListener('click', () => {
    const tuned = autopitch.applyToNotes(state.notes, state.apState)
    tuned.forEach((n, i) => { state.notes[i].midi = n.midi; state.notes[i].cents = n.cents })
    app.syncTuning()
    app.renderNotes()
    drawRoll()
    app.log(`autopitch: ${tuned.length} notes at ${Math.round(state.apState.strength * 100)}%`)
  })

  // ---------------------------------------------------------------- mastering
  $('master-presets').innerHTML = mastering2.PRESETS.map(p =>
    `<button type="button" data-mpreset="${p.slug}" title="${p.desc}">${p.name}</button>`).join('')
  function paintMaster() {
    const s = state.masterState
    document.querySelectorAll('[data-mpreset]').forEach(b => b.classList.toggle('on', b.dataset.mpreset === s.preset))
    $('in-intensity').value = String(Math.round(s.intensity * 100))
    $('out-intensity').textContent = mastering2.intensityLabel(s.intensity)
    $('in-low').value = String(s.low); $('out-low').textContent = `${s.low.toFixed(1)} dB`
    $('in-mid').value = String(s.mid); $('out-mid').textContent = `${s.mid.toFixed(1)} dB`
    $('in-high').value = String(s.high); $('out-high').textContent = `${s.high.toFixed(1)} dB`
    $('in-eq-bypass').checked = s.eqBypass
    $('master-preset-label').textContent = mastering2.presetBySlug(s.preset).name
  }
  $('master-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mpreset]')
    if (!b) return
    mastering2.setPreset(state.masterState, b.dataset.mpreset)
    paintMaster()
  })
  $('in-intensity').addEventListener('input', (e) => {
    mastering2.setIntensity(state.masterState, Number(e.target.value) / 100)
    $('out-intensity').textContent = mastering2.intensityLabel(state.masterState.intensity)
  })
  for (const band of ['low', 'mid', 'high']) {
    $(`in-${band}`).addEventListener('input', (e) => {
      mastering2.setBand(state.masterState, band, Number(e.target.value))
      $(`out-${band}`).textContent = `${state.masterState[band].toFixed(1)} dB`
    })
  }
  $('in-eq-bypass').addEventListener('change', (e) => { mastering2.toggleEqBypass(state.masterState, e.target.checked) })
  $('btn-apply-master').addEventListener('click', () => {
    const g = mastering2.effectiveGains(state.masterState)
    state.bands[1].gainDb = g.low
    state.bands[3].gainDb = g.mid
    state.bands[5].gainDb = g.high
    app.renderBands()
    state.bands[1].gainDb = g.low
    app.log(`master: ${mastering2.presetBySlug(state.masterState.preset).name} @ ${mastering2.intensityLabel(state.masterState.intensity)} — low ${g.low.toFixed(1)}, mid ${g.mid.toFixed(1)}, high ${g.high.toFixed(1)} dB`)
    app.status('mastered')
  })
  $('file-reference').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const chans = [buf.getChannelData(0), buf.getChannelData(1) || buf.getChannelData(0)]
    const res = mastering2.analyseReference(chans, buf.sampleRate)
    ctx.close()
    autopitch.setStrength(state.apState, state.apState.strength)
    state.masterState.low = res.low
    state.masterState.mid = res.mid
    state.masterState.high = res.high
    mastering2.setIntensity(state.masterState, res.intensity)
    paintMaster()
    app.log(`reference analysed: low ${res.low.toFixed(1)}, mid ${res.mid.toFixed(1)}, high ${res.high.toFixed(1)} dB`)
    e.target.value = ''
  })

  // ---------------------------------------------------------------- lyrics, chat, versions
  $('in-lyrics').addEventListener('input', () => { $('lyrics-count').textContent = `${$('in-lyrics').value.split('\n').filter(Boolean).length} lines` })
  $('btn-mark-line').addEventListener('click', () => {
    const text = $('in-lyrics').value.trim().split('\n').pop()
    if (!text) return
    state.lyrics.push({ t: app.playheadSeconds(), text })
    renderLyrics()
    app.log(`line marked at ${state.lyrics[state.lyrics.length - 1].t.toFixed(2)}s`)
  })
  $('btn-clear-lyrics').addEventListener('click', () => { state.lyrics = []; $('in-lyrics').value = ''; renderLyrics() })
  function renderLyrics() {
    $('lyric-list').innerHTML = state.lyrics.map((l, i) =>
      `<div class="note" role="listitem"><span>${l.t.toFixed(2)}s</span><span>${escapeHtml(l.text)}</span><span></span><button type="button" aria-label="Delete line" data-lyric-del="${i}">Del</button></div>`).join('')
    $('lyrics-count').textContent = `${state.lyrics.length} lines`
  }
  $('lyric-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lyric-del]')
    if (!b) return
    state.lyrics.splice(Number(b.dataset.lyricDel), 1)
    renderLyrics()
  })

  const say = (who, text) => {
    state.chat.push({ who, text })
    $('chat-log').innerHTML = state.chat.map(c => `<p><b>${escapeHtml(c.who)}</b> ${escapeHtml(c.text)}</p>`).join('')
    $('chat-log').scrollTop = $('chat-log').scrollHeight
  }
  const sendChat = () => {
    const text = $('in-chat').value.trim()
    if (!text) return
    say('Jackson', text)
    $('in-chat').value = ''
    setTimeout(() => say('Miranda', 'got it — listening now'), 500)
  }
  $('btn-chat-send').addEventListener('click', sendChat)
  $('in-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat() })

  $('btn-snapshot').addEventListener('click', () => {
    state.versions = versions.prune([versions.createVersion(snapshot(), `Version ${state.versions.length + 1}`), ...state.versions], state.member ? 50 : 20)
    renderVersions()
    app.log('version saved')
  })
  function snapshot() {
    return {
      bpm: Number($('in-bpm').value), tracks: JSON.parse(JSON.stringify(state.tracks)),
      notes: state.notes.length, master: { ...state.masterState },
    }
  }
  function renderVersions() {
    $('version-list').innerHTML = state.versions.map(v =>
      `<div class="ver" role="listitem"><b>${escapeHtml(v.label)}</b><span>${versions.relativeTime(v.createdAt)}</span>
        <button class="pill ghost" type="button" data-restore="${v.id}">Restore</button></div>`).join('')
  }
  $('version-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-restore]')
    if (!b) return
    const v = state.versions.find(x => x.id === b.dataset.restore)
    if (!v) return
    const snap = versions.restore(v)
    $('in-bpm').value = String(snap.bpm)
    state.tracks = snap.tracks
    renderTrackList(); syncAll(); app.log(`restored ${v.label}`)
  })

  // ---------------------------------------------------------------- sounds browser
  $('in-sound-cat').innerHTML = library.CATEGORIES.map(c => `<option value="${c.slug}">${c.label}</option>`).join('')
  $('sound-cats').innerHTML = library.CATEGORIES.map(c => `<button type="button" data-scat="${c.slug}">${c.label}</button>`).join('')
  let soundCat = library.CATEGORIES[0].slug
  function renderSounds() {
    const q = $('in-sound-search').value
    $('sound-cats').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.scat === soundCat))
    const packs = library.PACKS.filter(p => p.category === soundCat)
    $('pack-list').innerHTML = packs.map(p =>
      `<div class="pack" role="listitem" style="background:linear-gradient(135deg, ${p.art[0]}, ${p.art[1]})">
        <span class="tier">${p.tier}</span><b>${escapeHtml(p.name)}</b><i>${escapeHtml(p.author)}</i></div>`).join('')
    const list = (q ? library.search(q) : library.byCategory(soundCat)).slice(0, 40)
    $('sound-list').innerHTML = list.map(s =>
      `<div class="snd${state.sound?.slug === s.slug ? ' on' : ''}" role="listitem">
        <b>${escapeHtml(s.name)}</b><span>${s.bpm} bpm · ${s.key}</span>
        <button class="ic mini" type="button" aria-label="Favourite ${escapeHtml(s.name)}" data-fav="${s.slug}">${isFav(s.slug) ? '♥' : '♡'}</button></div>`).join('')
    $('sound-count').textContent = `${list.length} samples`
  }
  const isFav = (slug) => library.isFavourite(state.favourites, slug)
  $('in-sound-search').addEventListener('input', renderSounds)
  $('sound-cats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scat]')
    if (!b) return
    soundCat = b.dataset.scat
    $('in-sound-cat').value = soundCat
    renderSounds()
  })
  $('in-sound-cat').addEventListener('change', (e) => { soundCat = e.target.value; renderSounds() })
  $('sound-list').addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]')
    if (fav) {
      state.favourites = library.favourite(state.favourites, fav.dataset.fav)
      renderSounds()
      return
    }
    const row = e.target.closest('.snd')
    if (!row) return
    const name = row.querySelector('b').textContent
    state.sound = library.SAMPLE_LIST.find(s => s.name === name) || null
    renderSounds()
    if (state.sound) {
      $('sound-player').hidden = false
      $('snd-title').textContent = `${state.sound.name} — ${state.sound.pack}`
      previewSound(state.sound)
    }
  })
  function previewSound(sample) {
    try {
      const ctx = new AudioContext()
      const now = ctx.currentTime + 0.05
      if (sample.kind === 'loops' || sample.pattern?.includes('|')) {
        const pattern = drums.createPattern()
        library.parsePattern(sample.pattern).forEach((p) => { drums.toggleStep(pattern, p.lane, p.step) })
        drums.renderPattern(ctx, pattern, { bpm: sample.bpm, bars: 1, startAt: now })
      } else {
        const root = 60 + (NAMES.indexOf(sample.key) + 12) % 12
        synth.renderNotes(ctx, (sample.pattern || '0,4,7').split(',').map((o, i) => ({ midi: root + Number(o), start: i * 0.25, dur: 0.24, velocity: 90 })), SYNTH_PREVIEW)
      }
      setTimeout(() => ctx.close(), 4200)
    } catch { /* audio blocked */ }
  }
  const SYNTH_PREVIEW = synth.VOICE_PRESETS.keys
  $('btn-snd-play').addEventListener('click', () => state.sound && previewSound(state.sound))
  $('btn-snd-prev').addEventListener('click', () => stepSound(-1))
  $('btn-snd-next').addEventListener('click', () => stepSound(1))
  function stepSound(d) {
    const list = library.byCategory(soundCat)
    const i = list.findIndex(s => s.slug === state.sound?.slug)
    const next = list[(i + d + list.length) % list.length]
    if (!next) return
    state.sound = next
    $('snd-title').textContent = `${next.name} — ${next.pack}`
    renderSounds()
    previewSound(next)
  }
  $('btn-snd-like').addEventListener('click', () => {
    if (!state.sound) return
    state.favourites = library.favourite(state.favourites, state.sound.slug)
    renderSounds()
  })
  $('btn-snd-add').addEventListener('click', () => {
    if (!state.sound) return
    const t = tracks.addTrack(state.tracks, { type: 'loop', name: state.sound.name })
    state.rolls.set(t.id, null)
    renderTrackList(); syncAudibility()
    app.log(`added ${state.sound.name} to a new track @ ${state.sound.bpm} bpm`)
    $('sound-player').hidden = true
  })

  // ---------------------------------------------------------------- transport extras
  $('btn-metro').setAttribute('aria-pressed', 'false')
  $('btn-metro').addEventListener('click', () => {
    state.metronome = !state.metronome
    $('btn-metro').setAttribute('aria-pressed', String(state.metronome))
    if (state.metronome) startClick()
  })
  let clickTimer = null
  function startClick() {
    stopClick()
    const bpm = Number($('in-bpm').value)
    const beatMs = 60000 / bpm
    let beat = 0
    clickTimer = setInterval(() => {
      const ctx = new AudioContext()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = beat % 4 === 0 ? 1600 : 1000
      g.gain.value = 0.12
      o.connect(g).connect(ctx.destination)
      o.start(); o.stop(ctx.currentTime + 0.04)
      beat++
      setTimeout(() => ctx.close(), 200)
    }, beatMs)
  }
  function stopClick() { if (clickTimer) clearInterval(clickTimer); clickTimer = null }

  $('btn-stretch').addEventListener('click', () => {
    state.stretch = !state.stretch
    $('btn-stretch').setAttribute('aria-pressed', String(state.stretch))
    app.log(`region stretch ${state.stretch ? 'on' : 'off'}`)
  })
  $('btn-split-region').addEventListener('click', () => {
    app.log(`split at ${app.playheadSeconds().toFixed(2)}s`)
    app.status('split')
  })
  document.addEventListener('click', (e) => {
    const r = e.target.closest('[data-region]')
    if (!r) return
    app.log(`region: ${r.dataset.region}`)
    $('menu-region').hidden = true
  })
  $('clip-1').addEventListener('contextmenu', (e) => {
    e.preventDefault()
    openMenu($('menu-region'), e.clientX, e.clientY)
  })
  $('ruler').addEventListener('click', (e) => {
    const box = $('lane').getBoundingClientRect()
    state.loop = { from: Math.max(0, e.clientX - box.left), to: Math.max(0, e.clientX - box.left) }
    paintLoop()
  })
  function paintLoop() {
    const el = $('loop-region')
    if (!state.loop) { el.hidden = true; return }
    el.hidden = false
    el.style.left = `${state.loop.from}px`
    el.style.width = `${Math.max(4, state.loop.to - state.loop.from)}px`
  }
  $('in-follow').addEventListener('change', (e) => { state.follow = e.target.checked })
  $('in-countin').addEventListener('change', (e) => { $('metro-countin').textContent = `${e.target.value} bar${e.target.value === '1' ? '' : 's'}` })
  $('in-master-ceiling').addEventListener('input', (e) => {
    $('out-master-ceiling').textContent = `${Number(e.target.value).toFixed(1)} dB`
    $('in-ceiling').value = e.target.value
    $('out-ceiling').textContent = `${Number(e.target.value).toFixed(1)} dB`
  })
  $('in-member').addEventListener('change', (e) => { state.member = e.target.checked; app.log(`membership ${state.member ? 'on' : 'off'}`) })

  // ---------------------------------------------------------------- shortcuts
  const ACTIONS = {
    undo: () => $('btn-undo').click(), redo: () => $('btn-redo').click(),
    play: () => $('btn-play').click(), record: () => $('btn-record').click(),
    returnToStart: () => $('btn-stop').click(),
    metronome: () => $('btn-metro').click(), loop: () => toggleAutomation(),
    automation: () => toggleAutomation(), armAutomation: () => $('btn-automation-arm').click(),
    mixer: () => $('btn-mixer').click(), effects: () => app.openPanel('voice'),
    editor: () => app.openPanel('take'), sounds: () => app.openPanel('sounds'),
    lyrics: () => app.openPanel('lyrics'), shortcuts: () => openModal('shortcuts'),
    save: () => $('btn-save').click(), publish: () => openModal('publish'),
    settings: () => openModal('settings'), versions: () => app.openPanel('versions'),
    exportWav: () => $('btn-export').click(), newTrack: () => openModal('addtrack'),
    quantize: () => $('btn-quantize').click(), split: () => $('btn-split-region').click(),
    stretch: () => $('btn-stretch').click(), zoomIn: () => $('btn-zoom-in').click(),
    zoomOut: () => $('btn-zoom-out').click(), projectSettings: () => openModal('settings'),
  }
  document.addEventListener('keydown', (e) => {
    if (shortcuts.isTypingTarget(e.target)) return
    const binding = shortcuts.find(e)
    if (!binding) return
    const fn = ACTIONS[binding.action]
    if (!fn) return
    e.preventDefault()
    fn()
  })
  $('short-tabs').innerHTML = shortcuts.GROUPS.map((g, i) =>
    `<button class="tab${i ? '' : ' on'}" type="button" role="tab" data-sgroup="${g}">${g}</button>`).join('')
  function renderShortcuts(group) {
    $('short-list').innerHTML = shortcuts.byGroup(group)
      .map(b => `<div><span>${b.label}</span><kbd>${shortcuts.format(b)}</kbd></div>`).join('')
  }
  $('short-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sgroup]')
    if (!b) return
    $('short-tabs').querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === b))
    renderShortcuts(b.dataset.sgroup)
  })
  renderShortcuts(shortcuts.GROUPS[0])

  // ---------------------------------------------------------------- export options
  $('btn-export-confirm').addEventListener('click', () => { app.exportWav(); closeModal($('m-export')) })
  $('btn-publish-confirm').addEventListener('click', () => { closeModal($('m-publish')); app.log('published to profile'); app.status('published') })
  $('btn-publish-dl').addEventListener('click', () => { closeModal($('m-publish')); app.exportWav() })
  $('btn-invite').addEventListener('click', () => {
    const email = $('in-invite').value.trim()
    app.log(`invited ${email || 'link'}`)
    $('in-invite').value = ''
    closeModal($('m-invite'))
  })
  $('btn-copy-link').addEventListener('click', () => { navigator.clipboard?.writeText(location.href); app.log('link copied') })
  $('btn-get-decoy').addEventListener('click', () => { $('in-member').checked = true; state.member = true; closeModal($('m-get')); app.log('pro enabled') })
  $('btn-menu-new').addEventListener('click', () => { state.notes = []; app.renderNotes(); app.log('new project') })
  $('btn-menu-export-project').addEventListener('click', () => $('btn-save').click())
  $('btn-create-beat').addEventListener('click', () => { app.openPanel('take'); app.log('beat generator is in AutoMix & Tools') })

  // ---------------------------------------------------------------- paint
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }
  renderTrackList()
  renderSounds()
  renderVersions()
  paintAp()
  paintMaster()
  renderChain(state.tracks[0])
  drawRoll()

  return {
    state,
    renderAll() { renderTrackList(); syncAll(); drawRoll(); renderSounds(); renderVersions() },
    drawRoll,
    addTrack: (type) => { const t = tracks.addTrack(state.tracks, { type, name: tracks.typeInfo(type).label }); if (type === 'instrument') state.rolls.set(t.id, roll.createRoll()); if (type === 'drums') state.patterns.set(t.id, drums.createPattern()); renderTrackList(); return t.id },
    setActive(id) { state.active = id; renderChain(findTrack(id)); drawRoll() },
    chain: () => state.tracks.find(t => t.id === state.active)?.chain.effects,
    mixerOpen: () => { $('btn-mixer').click(); return !$('mixer').hidden },
    fxOpen: () => { openModal('fx'); return !$('m-fx').hidden },
    apPreset: (slug) => { autopitch.setPreset(state.apState, slug); paintAp(); return state.apState.preset },
    masterPreset: (slug) => { mastering2.setPreset(state.masterState, slug); paintMaster(); return state.masterState.preset },
    versions: () => state.versions.length,
    shortcutsRendered: () => $('short-list').children.length,
  }
}
