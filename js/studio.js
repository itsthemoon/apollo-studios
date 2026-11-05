// js/studio.js — the multi-track shell: tracks, mixer, automation, roll editor,
// effect chains, AutoPitch, mastering, browser, versions, chat and shortcuts.
// Split out of app.js so the take-level editing code stays readable.

import * as tracks from './tracks.js'
import * as capture from './capture.js'
import * as automation from './automation.js'
import * as synth from './synth.js'
import * as drums from './drums.js'
import * as library from './library.js'
import * as versions from './versions.js'
import * as mastering2 from './mastering2.js'
import * as shifter from './shifter.js'
import * as icons from './icons.js'
import * as autopitch from './autopitch.js'
import * as shortcuts from './shortcuts.js'
import { openModal, openPanel } from './panels.js'
import * as fx from './fx.js'
import * as roll from './roll.js'
import * as tune from './tune.js'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const $ = (id) => document.getElementById(id)

/* Bar lengths, counted in quarter notes (6/8 is six eighths = three quarters),
   so the ruler groups bars, the metronome accents bar 1 and the snap grid can
   offer "bar" as a real unit at any meter. */
const TIME_SIGS = { '2/4': 2, '3/4': 3, '4/4': 4, '6/8': 3 }
const BASE_BPM = 120
const RAIL_KEY = 'apollo.rail'
const TIMESIG_KEY = 'apollo.timesig'
const TAB_QUERY = '(max-width: 1399px)'

const readStore = (key, fallback = '') => {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
const writeStore = (key, value) => { try { localStorage.setItem(key, value) } catch { /* private mode */ } }

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
  state.metronome = false
  state.metroLevel = 0.6
  state.metroAccent = true
  state.countIn = Number($('in-countin')?.value) || 0
  state.snapBeats = 1
  state.zoom = 77
  state.stretch = false
  // the meter is a real project setting: it drives the ruler, the metronome
  // accent, the roll's bar lines and the bar-length grid targets
  state.timesig = TIME_SIGS[readStore(TIMESIG_KEY)] ? readStore(TIMESIG_KEY) : '4/4'
  state.key = { root: Number($('in-root')?.value) || 0, scale: $('in-mode')?.value || 'chromatic' }
  /* transport clock: one object so the meter engine can read it before the
     transport section below has added its listeners */
  const transport = {
    playing: false, ctx: null, gain: null, timer: 0, raf: 0, sources: [],
    from: 0, to: 0, t0: 0, len: 0, metroBeat: 0, counting: false,
  }
  state.sound = null
  state.masterState = mastering2.createState()
  state.apState = autopitch.createState()
  state.fxTarget = null
  state.clipGainDb = 0

  /* the first track's markup is static, so its data-* hooks carry the placeholder
     index 1 until the model hands out a real id — rebind them here */
  const staticId = state.tracks[0].id
  const rebind = (root) => {
    root.querySelectorAll('[data-track],[data-fx],[data-mute],[data-solo],[data-arm],[data-vol],[data-pan],[data-fx-count],[data-vol-read],[data-automation],[data-track-menu],[data-auto-param],[data-clip],[data-clip-gain],[data-row]').forEach((el) => {
      for (const key of ['track','fx','mute','solo','arm','vol','pan','fxCount','volRead','automation','trackMenu','clip','clipGain','row']) {
        const attr = 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
        if (el.getAttribute(attr) === '1' || el.getAttribute(attr) === '1:pan') {
          el.setAttribute(attr, el.getAttribute(attr) === '1:pan' ? `${staticId}:pan` : staticId)
        }
      }
    })
  }
  rebind($('track-1'))
  rebind($('clip-1'))
  rebind(document.querySelector('[data-row="1"]'))

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

  // ---------------------------------------------------------------- chrome: rail + tab overflow
  // These build themselves here, above the panel wiring, so the delegated
  // [data-panel-open] / [data-drawer] binders below also cover the copies.
  const rail = document.querySelector('.rail')

  function paintRail() {
    const collapsed = document.body.classList.contains('rail-collapsed')
    const btn = $('btn-rail-collapse')
    if (btn) {
      btn.setAttribute('aria-expanded', String(!collapsed))
      btn.setAttribute('aria-label', collapsed ? 'Expand the track rail' : 'Collapse the track rail')
      btn.title = collapsed ? 'Expand the rail' : 'Collapse the rail'
    }
    paintRailMore()
  }

  /* the fade pill is only honest while there is more rail below the fold */
  function paintRailMore() {
    const tip = $('rail-more')
    if (!tip || !rail) return
    tip.hidden = rail.scrollHeight - rail.clientHeight <= 4
  }

  function setRail(collapsed) {
    document.body.classList.toggle('rail-collapsed', collapsed)
    writeStore(RAIL_KEY, collapsed ? 'collapsed' : 'open')
    paintRail()
    // the arrange column just changed width: rebuild the ruler on the new one
    requestAnimationFrame(() => { rebuildRuler(); laneSpan(); state.studio?.drawRoll?.() })
  }

  if (rail) {
    rail.id = 'rail'
    const head = rail.querySelector('.rail-head')
    const toggle = document.createElement('button')
    toggle.id = 'btn-rail-collapse'
    toggle.className = 'ic rail-toggle'
    toggle.type = 'button'
    toggle.setAttribute('aria-controls', 'rail')
    toggle.setAttribute('aria-expanded', 'true')
    toggle.setAttribute('aria-label', 'Collapse the track rail')
    toggle.innerHTML = '<span data-icon="chevron" aria-hidden="true"></span>'
    head?.append(toggle)
    toggle.addEventListener('click', () => setRail(!document.body.classList.contains('rail-collapsed')))

    const tip = document.createElement('button')
    tip.id = 'rail-more'
    tip.className = 'rail-more'
    tip.type = 'button'
    tip.hidden = true
    tip.textContent = 'more ⌄'
    tip.setAttribute('aria-label', 'Scroll the track rail')
    tip.addEventListener('click', () => rail.scrollBy({ top: rail.clientHeight * 0.7, behavior: 'smooth' }))
    document.querySelector('.body')?.append(tip)

    rail.addEventListener('scroll', paintRailMore, { passive: true })
    if (typeof ResizeObserver === 'function') new ResizeObserver(paintRailMore).observe(rail)
    new MutationObserver(paintRailMore).observe(rail, { childList: true, subtree: true })
    if (readStore(RAIL_KEY) === 'collapsed') document.body.classList.add('rail-collapsed')
    paintRail()
  }

  /* Below 1400 px the right-hand tab cluster is hidden by CSS and this menu
     stands in for it, item for item, so every panel stays one tab away. */
  const tabRight = document.querySelector('.tabbar-right')
  const tabMore = document.createElement('button')
  const tabMenu = document.createElement('div')
  if (tabRight) {
    const items = [...tabRight.querySelectorAll('.sb')]
    tabMore.id = 'btn-tab-more'
    tabMore.className = 'sb more'
    tabMore.type = 'button'
    tabMore.setAttribute('aria-haspopup', 'menu')
    tabMore.setAttribute('aria-expanded', 'false')
    tabMore.setAttribute('aria-controls', 'menu-tabbar')
    tabMore.setAttribute('aria-label', 'More panels and actions')
    tabMore.innerHTML = '<span data-icon="dots-h" aria-hidden="true"></span>'
    items[items.length - 1]?.after(tabMore)
    tabRight.insertBefore(tabMore, $('status'))

    tabMenu.id = 'menu-tabbar'
    tabMenu.className = 'menu'
    tabMenu.setAttribute('role', 'menu')
    tabMenu.setAttribute('aria-labelledby', 'btn-tab-more')
    tabMenu.hidden = true
    items.forEach((src) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'menuitem')
      for (const attr of ['data-panel-open', 'data-drawer', 'data-modal']) {
        if (src.getAttribute(attr)) b.setAttribute(attr, src.getAttribute(attr))
      }
      // a copy cannot inherit an element-bound listener, so id-only items
      // (the mixer) replay their original button instead
      if (src.id) b.dataset.replay = src.id
      b.innerHTML = src.innerHTML
      b.setAttribute('aria-label', src.textContent.trim())
      b.addEventListener('click', () => closeTabMenu(true))
      tabMenu.append(b)
    })
    document.body.append(tabMenu)

    tabMore.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!tabMenu.hidden) { closeTabMenu(true); return }
      tabMenu.hidden = false
      tabMore.setAttribute('aria-expanded', 'true')
      const r = tabMore.getBoundingClientRect()
      const box = tabMenu.getBoundingClientRect()
      tabMenu.style.left = `${Math.max(8, Math.min(r.right - box.width, innerWidth - box.width - 12))}px`
      tabMenu.style.top = `${Math.min(r.top - box.height - 8, innerHeight - box.height - 12)}px`
      tabMenu.querySelector('[role="menuitem"]')?.focus()
    })
    tabMenu.addEventListener('click', (e) => {
      const item = e.target.closest('[data-replay]')
      if (item) $(item.dataset.replay)?.click()
    })
    document.addEventListener('click', (e) => {
      if (e.target.closest('#menu-tabbar, #btn-tab-more')) return
      if (!tabMenu.hidden) closeTabMenu(false)
    })
    /* Capture phase: the editor's own Escape (clear the note selection) also
       listens on document capture and would otherwise eat the key first. */
    document.addEventListener('keydown', (e) => {
      if (tabMore.getAttribute('aria-expanded') !== 'true') return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeTabMenu(true)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      e.stopPropagation()
      const all = [...tabMenu.querySelectorAll('[role="menuitem"]')]
      const at = all.indexOf(document.activeElement)
      all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
    }, true)
  }

  function closeTabMenu(refocus) {
    const wasOpen = !tabMenu.hidden
    tabMenu.hidden = true
    tabMore.setAttribute('aria-expanded', 'false')
    if (refocus && wasOpen) tabMore.focus()
  }

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
        <div class="th-inner">
        <div class="th-row">
          <span class="colour" data-colour="${t.color}" aria-hidden="true"></span>
          <span class="ticon" aria-hidden="true" data-icon="${info.icon}"></span>
          <b><i class="tnum">${String(i + 2).padStart(2, '0')}</i> <span class="tname" contenteditable="true" spellcheck="false">${t.name}</span></b>
          <button class="ic mini" type="button" aria-label="More actions" data-track-menu="${t.id}"><span data-icon="dots-v" aria-hidden="true"></span></button>
          <span class="th-spacer"></span>
          <button class="arm" type="button" aria-label="Arm track for recording" data-arm="${t.id}" aria-pressed="${t.armed}"><span data-icon="record" aria-hidden="true"></span></button>
          <button class="ms" type="button" aria-label="Mute" data-mute="${t.id}" aria-pressed="${t.mute}">M</button>
          <button class="ms" type="button" aria-label="Solo" data-solo="${t.id}" aria-pressed="${t.solo}">S</button>
          <span class="chev" aria-hidden="true" data-icon="chevron"></span>
        </div>
        <div class="th-row">
          <button class="fx" type="button" aria-label="Add a plug-in" data-fx="${t.id}">+ Fx</button>
          <span class="fx-count" data-fx-count="${t.id}">${t.chain.effects.length ? `${t.chain.effects.length} effect${t.chain.effects.length === 1 ? '' : 's'}` : 'no effects'}</span>
          <span class="th-spacer"></span>
        </div>
        <div class="th-row vol-row">
          <input class="th-vol" type="range" min="-60" max="6" value="${t.volumeDb}" step="0.5" aria-label="${t.name} volume" data-vol="${t.id}">
          <span class="th-vol-read" data-vol-read="${t.id}">${t.volumeDb.toFixed(1)} dB</span>
          <span class="th-meter" aria-hidden="true"><i></i></span>
          <label class="panwrap" title="Pan"><input class="panin" type="range" min="-100" max="100" value="${t.pan * 100}" aria-label="Pan ${t.name}" data-pan="${t.id}"></label>
        </div>
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
          <div class="clip-head"><h3>${t.name}</h3><span class="gain">${t.volumeDb.toFixed(1)} dB</span></div>
          <span class="ghost-count">${label}</span></div>
        <div class="automation-lane" data-automation="${t.id}" hidden>
        <canvas class="auto-canvas" width="240" height="46" role="img" aria-label="Volume automation for ${t.name}"></canvas>
        <span class="auto-legend">vol <button class="ic mini" type="button" data-auto-param="${t.id}:pan">pan</button></span></div>`
      laneRows.append(row)
      if (t.type === 'instrument' && rollOf) renderRoll(row.querySelector('.mini-roll'), rollOf, { rows: 24, preview: true })
    })
    laneSpan()
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
    if (fc) {
      fc.textContent = t.chain.effects.length ? `${t.chain.effects.length} effect${t.chain.effects.length === 1 ? '' : 's'}` : 'no effects'
      const fb = document.querySelector(`[data-fx="${t.id}"]`)
      if (fb) fb.title = fc.textContent
    }
    const slot = document.querySelector(`.strip [data-insert="${t.id}"]`)
    if (slot) {
      const n2 = t.chain.effects.length
      slot.textContent = `fx ${n2}`
      slot.classList.toggle('loaded', n2 > 0)
    }
  }

  document.addEventListener('input', (e) => {
    const el = e.target
    if (el.dataset.vol) {
      const t = findTrack(el.dataset.vol)
      if (!t) return
      tracks.setVolumeDb(t, Number(el.value))
      // a strip has no .vol-row; mirroring both readouts and the other fader
      // keeps the drag alive instead of re-rendering the strip under the pointer
      const read = document.querySelector(`[data-vol-read="${t.id}"]`)
      if (read) read.textContent = `${t.volumeDb.toFixed(1)} dB`
      const db = el.closest('.strip')?.querySelector('.db')
      if (db) db.textContent = t.volumeDb.toFixed(1)
      document.querySelectorAll(`[data-vol="${t.id}"]`).forEach((x) => { if (x !== el) x.value = String(t.volumeDb) })
      const dock = $('in-track-vol')
      if (dock && t.id === state.active) {
        dock.value = String(t.volumeDb)
        // drives the fill on the fader track: the cap alone gave no level cue
        dock.style.setProperty('--vf', `${((t.volumeDb + 60) / 66) * 100}%`)
      }
    }
    if (el.dataset.pan) {
      const t = findTrack(el.dataset.pan)
      if (!t) return
      tracks.setPan(t, Number(el.value) / 100)
      const read = document.querySelector(`[data-pan-read="${t.id}"]`)
      if (read) read.textContent = panReadout(t.pan)
    }
    if (el.dataset.send) {
      const [id, key] = el.dataset.send.split(':')
      const t = findTrack(id)
      if (!t) return
      tracks.setSend(t, key, Number(el.value) / 100)
      const knob = el.closest('.sendknob')
      if (knob) {
        knob.classList.toggle('on', t.sends[key] > 0)
        const out = knob.querySelector('output')
        if (out) out.textContent = sendReadout(t.sends[key])
      }
    }
  })

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mute], [data-solo], [data-arm], [data-track-menu], [data-fx]')
    if (!el) return
    if (el.dataset.mute) { tracks.toggleMute(findTrack(el.dataset.mute)); syncTrackDom(findTrack(el.dataset.mute)); syncAudibility() }
    else if (el.dataset.solo) { tracks.toggleSolo(findTrack(el.dataset.solo)); syncAll() }
    else if (el.dataset.arm) {
      const t = findTrack(el.dataset.arm)
      tracks.toggleArm(t)
      syncTrackDom(t)
      syncAudibility()
      onArmChanged(t)
    }
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
  $('track-types').innerHTML = tracks.TRACK_TYPES.filter(t => t.picker).map(t =>
    `<button class="type" type="button" role="listitem" data-type="${t.slug}">
       <span class="ticon" aria-hidden="true" data-icon="${t.icon}"></span><span><b>${t.label}</b><i>${t.hint}</i></span>
       ${t.midi ? '<em class="midi">MIDI</em>' : ''}</button>`).join('')
  $('track-types').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]')
    if (!b) return
    const t = tracks.addTrack(state.tracks, { type: b.dataset.type, name: tracks.typeInfo(b.dataset.type).label })
    t.chain = fx.createChain()
    if (tracks.typeInfo(t.type).midi) state.rolls.set(t.id, roll.createRoll())
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
  function sendReadout(v) { return v > 0 ? `${Math.round(v * 100)}%` : '–' }
  function panReadout(p) { return p === 0 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}` }
  function renderMixer() {
    const host = $('strips')
    if (!host) return
    host.innerHTML = ''
    const audible = tracks.resolveSolo(state.tracks)
    state.tracks.forEach((t) => {
      const s = document.createElement('div')
      s.className = `strip${audible.has(t.id) ? '' : ' off'}`
      s.dataset.strip = t.id
      // the header counts the limiter, so the slot does too
      const inserts = t.chain?.effects.length || 0
      const reverb = t.sends?.reverb || 0
      const delay = t.sends?.delay || 0
      s.innerHTML = `<b>${escapeHtml(t.name)}</b>
        <span class="sends">
          <label class="sendknob${reverb ? ' on' : ''}" title="Send A — Reverb"><span>A</span>
            <input type="range" min="0" max="100" step="1" value="${Math.round(reverb * 100)}" aria-label="${escapeHtml(t.name)} send A reverb" data-send="${t.id}:reverb">
            <output>${sendReadout(reverb)}</output></label>
          <label class="sendknob${delay ? ' on' : ''}" title="Send B — Delay"><span>B</span>
            <input type="range" min="0" max="100" step="1" value="${Math.round(delay * 100)}" aria-label="${escapeHtml(t.name)} send B delay" data-send="${t.id}:delay">
            <output>${sendReadout(delay)}</output></label>
        </span>
        <button class="insert${inserts ? ' loaded' : ''}" type="button" data-insert="${t.id}"
          aria-label="${escapeHtml(t.name)} insert chain: ${inserts} ${inserts === 1 ? 'effect' : 'effects'}">fx ${inserts}</button>
        <input type="range" min="-60" max="6" value="${t.volumeDb}" step="0.5" aria-label="${escapeHtml(t.name)} fader" data-vol="${t.id}">
        <span class="db">${t.volumeDb.toFixed(1)}</span>
        <span class="mstag"><button class="ms" type="button" aria-label="Mute ${escapeHtml(t.name)}" data-mute="${t.id}" aria-pressed="${t.mute}">M</button>
        <button class="ms" type="button" aria-label="Solo ${escapeHtml(t.name)}" data-solo="${t.id}" aria-pressed="${t.solo}">S</button></span>
        <span class="mlab">pan</span>
        <input class="strippan" type="range" min="-100" max="100" value="${t.pan * 100}" aria-label="${escapeHtml(t.name)} pan — double-click to centre" title="Pan — double-click to centre" data-pan="${t.id}">
        <span class="db" data-pan-read="${t.id}">${panReadout(t.pan)}</span>
        <span class="strip-meter" data-meter="${t.id}" aria-hidden="true"><i></i></span>`
      host.append(s)
    })
    const m = document.createElement('div')
    m.className = 'strip master'
    m.innerHTML = `<b>Master</b>
      <span class="master-read"><span class="tp">TP <output data-tp>–∞</output> dB</span>
      <span class="gr">LIM <output data-gr>0.0</output> dB</span></span>
      <input type="range" min="-12" max="12" value="${$('in-gain').value}" aria-label="Master fader"><span class="db">${$('out-gain').textContent}</span>
      <span class="strip-meter master-meter" data-meter="master" aria-hidden="true"><i></i></span>`
    m.querySelector('input').addEventListener('input', (e) => { $('in-gain').value = e.target.value; $('in-gain').dispatchEvent(new Event('input')) })
    host.append(m)
    paintMeters()
  }
  $('btn-mixer').addEventListener('click', () => {
    const m = $('mixer')
    m.hidden = !m.hidden
    if (!m.hidden) renderMixer()
  })
  $('btn-mixer-close').addEventListener('click', () => { $('mixer').hidden = true })

  // insert slot opens the chain browser for that strip's track
  document.addEventListener('click', (e) => {
    const ins = e.target.closest('[data-insert]')
    if (!ins) return
    state.fxTarget = ins.dataset.insert
    state.active = ins.dataset.insert
    document.querySelectorAll('.track-head').forEach(h => h.classList.toggle('on', h.dataset.track === state.active))
    openModal('fx')
  })

  // double-click a pan knob (strip or track head) to put it back in the centre
  document.addEventListener('dblclick', (e) => {
    const knob = e.target.closest('[data-pan]')
    if (!knob) return
    const t = findTrack(knob.dataset.pan)
    if (!t) return
    e.preventDefault()
    tracks.setPan(t, 0)
    document.querySelectorAll(`[data-pan="${t.id}"]`).forEach((el) => { el.value = '0' })
    const read = document.querySelector(`[data-pan-read="${t.id}"]`)
    if (read) read.textContent = 'C'
    app.log(`pan recentred: ${t.name}`)
  })

  // --- meters: one analyser taps whatever is playing, each strip scales it ---
  let analyser = null
  let meterSink = null
  let meterRaf = 0
  const meterBuf = new Float32Array(1024)
  const dbToN = (db) => Math.min(1, Math.max(0, (db + 60) / 60))

  function meterContext() { return transport.ctx || state.ctx }
  function attachAnalyser() {
    const ctx = meterContext()
    if (!ctx) return null
    if (analyser && analyser.context === ctx) {
      // a fresh play() creates new sources; tap whichever ones aren't yet
      state.playing.forEach(tapSource)
      return analyser
    }
    try {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.55
      meterSink = ctx.createGain()
      meterSink.gain.value = 0
      analyser.connect(meterSink).connect(ctx.destination)
    } catch { analyser = null; return null }
    state.playing.forEach(tapSource)
    return analyser
  }

  function tapSource(src) { if (analyser && src) { try { src.connect(analyser) } catch { /* noop */ } } }

  function paintMeters() {
    if (!analyser || $('mixer')?.hidden) return
    const buf = meterBuf
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    let sum = 0
    for (let i = 0; i < buf.length; i += 1) {
      const v = Math.abs(buf[i])
      if (v > peak) peak = v
      sum += v * v
    }
    // true peak: sample the inter-sample curve at quarter steps
    let tp = peak
    for (let i = 0; i < buf.length - 1; i += 1) {
      const a = buf[i]
      const d = buf[i + 1] - a
      for (let k = 1; k < 4; k += 1) {
        const v = Math.abs(a + d * (k / 4))
        if (v > tp) tp = v
      }
    }
    const rmsN = dbToN(20 * Math.log10(Math.max(Math.sqrt(sum / buf.length), 1e-6)))
    const audible = tracks.resolveSolo(state.tracks)
    state.tracks.forEach((t) => {
      const bar = document.querySelector(`[data-meter="${t.id}"] i`)
      if (!bar) return
      const factor = audible.has(t.id) ? 10 ** (t.volumeDb / 20) * (1 - Math.abs(t.pan) * 0.3) : 0
      const n = Math.min(1, rmsN * factor)
      bar.style.width = `${(n * 100).toFixed(1)}%`
      bar.dataset.zone = n > 0.92 ? 'clip' : n > 0.72 ? 'warn' : 'ok'
    })
    const master = document.querySelector('[data-meter="master"] i')
    if (master) {
      const n = dbToN(20 * Math.log10(Math.max(tp, 1e-6)))
      master.style.width = `${(n * 100).toFixed(1)}%`
      master.dataset.zone = n > 0.97 ? 'clip' : n > 0.8 ? 'warn' : 'ok'
      const tpOut = document.querySelector('[data-tp]')
      if (tpOut) tpOut.textContent = tp > 1e-5 ? (20 * Math.log10(tp)).toFixed(1) : '–∞'
      const ceiling = Number($('in-master-ceiling')?.value ?? -1)
      const peakDb = 20 * Math.log10(Math.max(tp, 1e-6))
      const gr = document.querySelector('[data-gr]')
      if (gr) gr.textContent = Math.max(0, peakDb - ceiling).toFixed(1)
    }
  }

  function meterLoop() {
    meterRaf = 0
    if (!state.playing.length && !transport.playing) {
      document.querySelectorAll('[data-meter] i').forEach((b) => { b.style.width = '0%' })
      const tpOut = document.querySelector('[data-tp]')
      if (tpOut) tpOut.textContent = '–∞'
      const gr = document.querySelector('[data-gr]')
      if (gr) gr.textContent = '0.0'
      return
    }
    paintMeters()
    meterRaf = requestAnimationFrame(meterLoop)
  }
  function startMeter() {
    attachAnalyser()
    if (!meterRaf) meterRaf = requestAnimationFrame(meterLoop)
  }

  // ---------------------------------------------------------------- roll editor
  const ROLL_W = 1400
  const ROLL_H = 260
  const ROWS = 24
  function activeRoll() { return state.rolls.get(state.active) }

  function drawRoll() { renderRoll($('roll'), activeRoll(), { rows: ROWS, preview: false }) }

  const PITCH_NAMES = ['C', 'C\u266F', 'D', 'D\u266F', 'E', 'F', 'F\u266F', 'G', 'G\u266F', 'A', 'A\u266F', 'B']

  // A pitch gutter down the left edge, so the grid reads as a keyboard.
  function drawPitchLabels(g, W, H, rows, lowMidi) {
    g.save()
    g.fillStyle = 'rgba(6, 9, 10, 0.88)'
    g.fillRect(0, 0, 26, H)
    g.fillStyle = '#a3abaf'
    g.font = '10px ui-monospace, Menlo, monospace'
    g.textBaseline = 'middle'
    const rowH = H / rows
    for (let i = 0; i < rows; i += 1) {
      const midi = lowMidi + (rows - 1 - i)
      if (rowH < 12 && i % 2 === 1) continue
      g.fillText(`${PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`, 4, i * rowH + rowH / 2)
    }
    g.restore()
  }

  function renderRoll(cv, r, opts = {}) {
    if (!cv) return
    // match the backing store to the box, so a dock resize never clips the grid
    if (cv.clientWidth && cv.width !== cv.clientWidth) cv.width = cv.clientWidth
    if (cv.clientHeight && cv.height !== cv.clientHeight) cv.height = cv.clientHeight
    const g = cv.getContext('2d')
    const W = cv.width
    const H = cv.height
    const rows = opts.rows || ROWS
    g.clearRect(0, 0, W, H)
    if (!r) {
      // a voice track has no roll: show its detected pitch segments, read-only
      $('note-count').textContent = state.notes.length ? `${state.notes.length} take notes` : 'no notes'
      g.fillStyle = '#0a0e10'
      g.fillRect(0, 0, W, H)
      /* the dividers are the timeline's bar lines: span comes from the take,
         and a bar is as many beats as the meter says, not a fixed four */
      const beatsPerSecond = Number($('in-bpm').value) / 60
      const perBar = Math.max(1, Number(($('in-timesig')?.value || '4/4').split('/')[0]) || 4)
      const lastEnd = state.notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0)
      const totalBeats = Math.max(8, Math.ceil((lastEnd * beatsPerSecond + 1) / perBar) * perBar)
      const beatX = (W - 26) / totalBeats
      g.fillStyle = '#192124'
      for (let b = 0; b <= totalBeats; b += perBar) g.fillRect(26 + b * beatX, 0, 1, H)
      const lowest = state.notes.length ? Math.min(...state.notes.map(n => Math.floor(n.midi))) : 48
      const low = Math.max(24, lowest - 2)
      state.notes.forEach((n) => {
        const row = 23 - (Math.round(n.midi) - low)
        if (row < 0 || row > 23) return
        const x = n.start * beatsPerSecond * beatX
        const w = Math.max(3, n.dur * beatsPerSecond * beatX)
        const flat = Math.abs(n.cents || 0) < 8
        g.fillStyle = flat ? '#3f8f99' : '#6fa8ff'
        g.fillRect(x + 26, row * (H / 24) + 2, w, Math.max(2, H / 24 - 4))
      })
      drawPitchLabels(g, W, H, 24, low)
      return
    }
    const rowH = H / rows
    const gut = opts.preview ? 0 : 26
    const beatW = (W - gut) / r.lengthBeats
    const keyPcs = scalePcs()
    for (let row = 0; row < rows; row++) {
      const midi = r.lowMidi + (rows - 1 - row)
      const pc = ((midi % 12) + 12) % 12
      const black = [1, 3, 6, 8, 10].includes(pc)
      // in-key rows carry a faint lift so the key's target is visible in the grid
      g.fillStyle = black ? '#0a0e10' : '#0d1315'
      if (keyPcs.has(pc)) g.fillStyle = black ? '#111a1d' : '#121b1e'
      g.fillRect(gut, row * rowH, W - gut, rowH)
      g.fillStyle = '#1b2225'
      g.fillRect(gut, row * rowH + rowH - 1, W - gut, 1)
    }
    for (let b = 0; b <= r.lengthBeats; b += 1) {
      g.fillStyle = b % barBeats() === 0 ? '#243034' : '#192124'
      g.fillRect(gut + b * beatW, 0, 1, H)
    }
    r.notes.forEach((n) => {
      const row = rows - 1 - (n.midi - r.lowMidi)
      if (row < 0 || row >= rows) return
      g.fillStyle = opts.preview ? '#4e86c9' : '#6fa8ff'
      g.fillRect(gut + n.start * beatW, row * rowH + 2, Math.max(3, n.dur * beatW), Math.max(3, rowH - 3))
    })
    if (gut) drawPitchLabels(g, W, H, rows, r.lowMidi)
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
    const GUT = 26
    const x = e.clientX - box.left - GUT
    const beat = Math.min(r.lengthBeats - 0.05, Math.max(0, (x / (box.width - GUT)) * r.lengthBeats))
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

  // The persist module owns these: it edits the active roll *or* the take notes
  // and records the edit on the editor's undo stack. The inline path is only the
  // fallback for a build without it.
  $('btn-quantize').addEventListener('click', () => {
    if (state.persist?.quantize?.()) return
    const r = activeRoll()
    if (!r) return
    state.undoRoll.push(roll.cloneRoll(r))
    roll.quantize(r, Number($('in-quant').value), Number($('in-snap').value) / 100)
    drawRoll(); refreshRollUi()
    app.log('roll quantized')
  })
  $('btn-lock-scale').addEventListener('click', () => {
    if (state.persist?.lockScale?.()) return
    const r = activeRoll()
    if (!r) return
    state.undoRoll.push(roll.cloneRoll(r))
    const root = Number($('in-root').value)
    roll.lockToScale(r, scalePitchClasses($('in-mode').value, root), root + 48)
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
  const fxCat = { value: 'recommended', query: '' }
  const FX_BLURB = {
    reverb: 'Room, hall and cathedral spaces.',
    chorus: 'Widening modulation for doubles.',
    eq3: 'Low, mid and high shelves.',
    comp: 'Level control with a makeup stage.',
    limiter: 'Ceiling that never lets a peak through.',
    gain: 'One knob of level.',
    widener: 'Push the sides apart or fold to mono.',
    tremolo: 'Amplitude movement.',
    gate: 'Silence below the threshold.',
    dist: 'Drive, tone and mix.',
    delay: 'Echo with feedback and ping-pong.',
    phaser: 'Sweeping notches.',
    bitcrush: 'Bit and rate reduction.',
    filter: 'Resonant low and high pass.',
  }
  function renderFxBrowser() {
    $('fx-cats').innerHTML = fx.FX_CATEGORIES
      .map(c => `<button type="button" data-cat="${c.id}" class="${c.id === fxCat.value ? 'on' : ''}">${c.label}</button>`).join('')
    $('fx-list').innerHTML = fx.FX_LIST
      .filter(e => e.cats.includes(fxCat.value) && (!fxCat.query || e.name.toLowerCase().includes(fxCat.query)))
      .map(e => `<button type="button" role="listitem" data-add="${e.slug}">${fx.EFFECT_TIER?.[e.slug] === 'membership' ? '<em class="crown" aria-hidden="true">&#128081;</em>' : ''}<b>${e.name}</b><i>${FX_BLURB[e.slug] || ''}</i></button>`).join('')
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

  $('btn-fx-preset-none').addEventListener('click', () => {
    const t = findTrack(state.active)
    if (!t) return
    t.chain = fx.createChain({ isMember: state.member })
    renderChain(t)
    syncTrackDom(t)
    app.log('fx preset: none')
  })
  $('btn-fx-preset-save').addEventListener('click', () => {
    const t = findTrack(state.active)
    if (!t) return
    localStorage.setItem('apollo.fxpreset', JSON.stringify(t.chain.effects.map(e => ({ slug: e.slug, params: e.params }))))
    app.log('fx preset saved')
  })
  $('in-fx-blend').addEventListener('input', (e) => { $('out-fx-blend').textContent = `${e.target.value} %` })
  function promptEffect() {
    const t = findTrack(state.active)
    if (!t) return
    const words = (window.prompt('Describe the sound you want', 'wider, brighter vocal') || '').toLowerCase()
    if (!words) return
    const guess = words.includes('wider') || words.includes('brighter') ? 'comp' : words.includes('echo') ? 'delay' : 'eq3'
    try {
      const effect = fx.addEffect(t.chain, guess, { isMember: state.member })
      renderChain(t)
      syncTrackDom(t)
      app.log(`fx prompt: ${words} → ${guess} ${effect.id}`)
    } catch (err) { app.log(`fx prompt: ${err.message}`) }
  }
  function openFxBrowser() {
    if (!findTrack(state.fxTarget)) state.fxTarget = state.active
    renderFxBrowser()
    openModal('fx')
  }
  $('btn-fx-add').addEventListener('click', openFxBrowser)

  function renderChain(t) {
    const host = $('fx-chain')
    host.innerHTML = ''
    const used = t.chain.effects.length
    const cap = t.chain.capacity ?? 8
    $('fx-capacity').textContent = used >= cap ? 'Maximum amount of effects reached' : ''
    $('btn-fx-add').disabled = used >= cap
    $('fxp-name').textContent = t.name
    const shown = t.chain.effects.filter(e => e.slug !== fx.LIMITER_SLUG)
    if (!shown.length) {
      // empty chains offer the two ways in, as tiles
      host.innerHTML = `
        <button class="fxtile ai" type="button" id="btn-fx-prompt"><span class="spark" aria-hidden="true">&#10022;</span><em class="ai">AI</em>Generate With Prompt</button>
        <button class="fxtile add" type="button" id="btn-fx-add-tile" aria-label="Add an effect to the active track"><span class="plus" aria-hidden="true">+</span>Add Effect</button>`
      $('btn-fx-add-tile').addEventListener('click', openFxBrowser)
      $('btn-fx-prompt').addEventListener('click', promptEffect)
      return
    }
    t.chain.effects.forEach((effect) => {
      const row = document.createElement('div')
      row.className = `fxrow${effect.bypass ? ' off' : ''}`
      row.setAttribute('role', 'listitem')
      const spec = fx.FX_LIST.find(e => e.slug === effect.slug)
      row.innerHTML = `<b>${spec.name}</b><span class="lit">${effect.bypass ? 'bypassed' : 'active'}</span>
        <button class="ic mini" type="button" aria-label="Edit ${spec.name}" data-edit="${effect.id}"><span data-icon="edit" aria-hidden="true"></span></button>
        <button class="ic mini" type="button" aria-label="Bypass ${spec.name}" data-bypass="${effect.id}"><span data-icon="bypass" aria-hidden="true"></span></button>`
      host.append(row)
    })
    const fc = document.querySelector(`[data-fx-count="${t.id}"]`)
    if (fc) {
      fc.textContent = t.chain.effects.length ? `${t.chain.effects.length} effect${t.chain.effects.length === 1 ? '' : 's'}` : 'no effects'
      const fb = document.querySelector(`[data-fx="${t.id}"]`)
      if (fb) fb.title = fc.textContent
    }
    const slot = document.querySelector(`.strip [data-insert="${t.id}"]`)
    if (slot) {
      const n2 = t.chain.effects.length
      slot.textContent = `fx ${n2}`
      slot.classList.toggle('loaded', n2 > 0)
    }
  }

  $('btn-fx-close').addEventListener('click', () => openPanel('take'))
  $('btn-fx-preset-menu').addEventListener('click', () => {
    const more = $('fxp-more')
    more.hidden = !more.hidden
  })
  $('btn-fx-bypass').addEventListener('click', () => {
    const t = findTrack(state.active)
    if (!t) return
    const on = $('btn-fx-bypass').getAttribute('aria-pressed') !== 'true'
    $('btn-fx-bypass').setAttribute('aria-pressed', String(on))
    t.chain.effects.forEach(e => { if (e.slug !== fx.LIMITER_SLUG) e.bypass = on })
    renderChain(t)
    app.log(`fx ${on ? 'bypassed' : 'active'}`)
  })
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
  // Layout and wording follow the shipping product: a power switch, a category
  // dropdown over a tile grid, a Heaviest knob, a scale dropdown over a piano
  // key grid, and an advanced strip behind the sliders button. There is no
  // Apply — the panel is live, so every control re-pitches sounding notes.
  const KNOWN_NAMES = ['C', 'C\u266F', 'D', 'D\u266F', 'E', 'F', 'F\u266F', 'G', 'G\u266F', 'A', 'A\u266F', 'B']
  const KNOB_LABELS = [[0, 'Off'], [0.15, 'Light'], [0.4, 'Medium'], [0.7, 'Firm'], [0.9, 'Heaviest']]
  const knobLabel = (v) => KNOB_LABELS.filter(([at]) => v >= at).pop()[1]

  function paintAp() {
    const s = state.apState
    $('ap-power').setAttribute('aria-checked', String(s.enabled))
    $('out-ap-category').textContent = autopitch.CATEGORIES.find(c => c.slug === s.category).name
    $('out-ap-scale').textContent = autopitch.SCALE_LABELS[s.scale]
    $('in-ap-scale')?.replaceChildren()
    const pct = Math.round(s.strength * 100)
    $('in-ap-strength').value = String(pct)
    $('knob-ap').setAttribute('aria-valuenow', String(pct))
    $('knob-ap').querySelector('.needle').style.transform =
      `rotate(${-135 + 2.7 * pct}deg)`
    $('out-ap-strength').textContent = pct === 0 ? 'Off' : (pct > 92 ? 'Heaviest' : knobLabel(s.strength))
    document.querySelectorAll('[data-ap]').forEach(b => {
      const on = b.dataset.ap === s.preset
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    document.querySelectorAll('[data-tonic]').forEach(b => {
      const pc = Number(b.dataset.tonic)
      const scaleName = s.scale === 'project' ? s.projectScale : s.scale
      const degrees = autopitch.SCALES[scaleName]
      const root = s.scale === 'project' ? s.projectTonic : s.tonic
      const inScale = degrees.length === 12 || degrees.includes((pc - root + 12) % 12)
      b.classList.toggle('root', pc === (s.scale === 'project' ? s.projectTonic : s.tonic))
      b.classList.toggle('in-scale', inScale)
      b.setAttribute('aria-pressed', String(pc === s.tonic))
    })
    document.querySelectorAll('#knob-ap .ticks line').forEach((line, i) => {
      line.classList.toggle('on', i / 30 <= s.strength + 0.001)
    })
    $('ap-category').setAttribute('aria-expanded', String(!$('ap-cat-menu').hidden))
    $('ap-scale').setAttribute('aria-expanded', String(!$('ap-scale-menu').hidden))
    $('in-ap-algorithm').value = s.algorithm
    $('in-ap-harmonymix').value = String(Math.round(s.harmonyMix * 100))
    $('out-ap-harmonymix').textContent = `${Math.round(s.harmonyMix * 100)}%`
  }

  // 31 ticks over the 270 degree sweep, drawn once; `paintAp` lights them
  ;(() => {
    const svg = document.querySelector('#knob-ap .ticks')
    const ns = 'http://www.w3.org/2000/svg'
    for (let i = 0; i < 31; i++) {
      const a = (-135 + i * 9) * Math.PI / 180
      const r1 = 62, r2 = i % 5 === 0 ? 55 : 58
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', String(70 + Math.sin(a) * r1))
      line.setAttribute('y1', String(70 - Math.cos(a) * r1))
      line.setAttribute('x2', String(70 + Math.sin(a) * r2))
      line.setAttribute('y2', String(70 - Math.cos(a) * r2))
      svg.appendChild(line)
    }
  })()

  function paintCategory() {
    $('ap-cat-menu').innerHTML = autopitch.CATEGORIES.map(c =>
      `<button type="button" role="option" data-cat="${c.slug}" aria-selected="${c.slug === state.apState.category}">${c.name}</button>`).join('')
    $('ap-scale-menu').innerHTML = autopitch.SCALE_NAMES.map(n =>
      `<button type="button" role="option" data-scale="${n}" aria-selected="${n === state.apState.scale}">${autopitch.SCALE_LABELS[n]}</button>`).join('')
  }

  function paintTiles() {
    $('ap-presets').innerHTML = autopitch.presetsFor(state.apState.category).map(p =>
      `<button type="button" class="ap-tile" data-ap="${p.slug}" aria-pressed="false"><span class="ic" data-icon="${p.duet ? 'duet' : 'autopitch'}" aria-hidden="true"></span>${p.name}${p.tier === 'membership' ? '<span class="crown" aria-label="Apollo Pro">\u2665</span>' : ''}</button>`).join('')
    icons.hydrate($('ap-presets'))
  }

  $('tonic-grid').innerHTML = [
    ...autopitch.TONIC_GRID.filter(t => t.name.includes(' ')),
    ...autopitch.TONIC_GRID.filter(t => !t.name.includes(' ')),
  ].map(t => `<button type="button" data-tonic="${t.pitchClass}" class="${t.name.includes(' ') ? 'acc' : 'nat'}" aria-label="${t.name.replace(' ', ' / ')}">${t.name.replace(' ', '<br>')}</button>`).join('')
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

  // ---------------------------------------  paintCategory()
  paintTiles()
  paintAp()

  $('ap-category').addEventListener('click', () => {
    $('ap-scale-menu').hidden = true
    $('ap-cat-menu').hidden = !$('ap-cat-menu').hidden
    paintAp()
  })
  $('ap-scale').addEventListener('click', () => {
    $('ap-cat-menu').hidden = true
    $('ap-scale-menu').hidden = !$('ap-scale-menu').hidden
    paintAp()
  })
  $('ap-cat-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]')
    if (!b) return
    autopitch.setCategory(state.apState, b.dataset.cat)
    $('ap-cat-menu').hidden = true
    paintCategory()
    paintTiles()
    paintAp()
    app.liveRefresh()
    app.log(`autopitch category ${b.textContent}`)
  })
  $('ap-scale-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scale]')
    if (!b) return
    autopitch.setScale(state.apState, b.dataset.scale)
    $('ap-scale-menu').hidden = true
    paintCategory()
    paintAp()
    app.liveRefresh()
    app.log(`scale ${b.textContent}`)
  })
  $('ap-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ap]')
    if (!b) return
    const p = autopitch.presetBySlug(b.dataset.ap)
    if (autopitch.isMembership(p) && !state.member) { app.log(`${p.name} needs Apollo Pro`); openModal('get'); return }
    autopitch.setPreset(state.apState, b.dataset.ap)
    autopitch.setEnabled(state.apState, true)
    paintAp()
    app.liveRefresh()
  })
  $('tonic-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tonic]')
    if (!b) return
    autopitch.setTonic(state.apState, Number(b.dataset.tonic))
    paintAp()
    app.liveRefresh()
  })
  $('ap-power').addEventListener('click', () => {
    autopitch.setEnabled(state.apState, !state.apState.enabled)
    paintAp()
    app.liveRefresh()
    app.log(`autopitch ${state.apState.enabled ? 'on' : 'off'}`)
  })
  $('btn-autodetect').addEventListener('click', () => {
    if (!state.notes.length) { app.log('autodetect: load a take first'); return }
    const midis = state.notes.map(n => n.midi)
    let found = autopitch.detectKey(midis)
    // material that visits every degree scores best as chromatic, which tunes
    // nothing — so ask again for the best keyed scale and prefer that
    if (found.scale === 'chromatic' && found.confidence >= 0.3) {
      found = autopitch.detectKey(midis, ['major', 'minor'])
    }
    if (found.confidence < 0.25) { app.log('autodetect: too little material for a key'); return }
    autopitch.setTonic(state.apState, found.tonic)
    autopitch.setScale(state.apState, found.scale === 'pentatonic' ? 'pentatonic' : found.scale)
    // the editor's key pill mirrors what was detected
    $('in-root').value = String(found.tonic)
    $('in-mode').value = found.scale === 'major' ? 'major' : 'minor'
    paintAp()
    app.liveRefresh()
    app.log(`autodetect: ${KNOWN_NAMES[found.tonic]} ${found.scale} (${Math.round(found.confidence * 100)}% sure)`)
  })
  $('btn-ap-adv').addEventListener('click', () => {
    const adv = $('ap-adv')
    adv.hidden = !adv.hidden
    $('btn-ap-adv').setAttribute('aria-expanded', String(!adv.hidden))
  })
  $('in-ap-algorithm').addEventListener('change', (e) => {
    autopitch.setAlgorithm(state.apState, e.target.value)
    app.liveRefresh()
  })
  $('in-ap-harmonymix').addEventListener('input', (e) => {
    autopitch.setHarmonyMix(state.apState, Number(e.target.value) / 100)
    $('out-ap-harmonymix').textContent = `${e.target.value}%`
    app.liveRefresh()
  })

  // the knob: drag vertically, wheel, or arrow keys
  ;(() => {
    const knob = $('knob-ap')
    let from = 0, startY = 0, dragging = false
    const set = (v) => {
      autopitch.setStrength(state.apState, Math.max(0, Math.min(1, v)))
      paintAp()
      app.liveRefresh()
    }
    knob.addEventListener('pointerdown', (e) => {
      dragging = true
      startY = e.clientY
      from = state.apState.strength
      knob.setPointerCapture(e.pointerId)
    })
    knob.addEventListener('pointermove', (e) => {
      if (!dragging) return
      set(from + (startY - e.clientY) / 160)
    })
    knob.addEventListener('pointerup', () => { dragging = false })
    knob.addEventListener('wheel', (e) => {
      e.preventDefault()
      set(state.apState.strength - Math.sign(e.deltaY) * 0.04)
    }, { passive: false })
    knob.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(state.apState.strength + step); e.preventDefault() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(state.apState.strength - step); e.preventDefault() }
    })
  })()

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
        <button class="ic mini${isFav(s.slug) ? ' fav' : ''}" type="button" aria-label="Favourite ${escapeHtml(s.name)}" data-fav="${s.slug}"><span data-icon="heart" aria-hidden="true"></span></button></div>`).join('')
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

  // ---------------------------------------------------------------- snap grid
  // Values are beats, so the division is the same unit the timeline drags use.
  // A triplet is 2/3 or 1/3 of a beat; Off is 0 and returns the input untouched.
  const GRID = [
    ['4', '1/1'], ['2', '1/2'], ['1', '1/4'], ['0.5', '1/8'], ['0.25', '1/16'],
    ['0.125', '1/32'], ['0.6666666667', '1/4T'], ['0.3333333333', '1/8T'], ['0', 'Off'],
  ]
  const gridSel = $('in-grid')
  gridSel.innerHTML = GRID.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')
  gridSel.value = '1'
  state.snapBeats = 1
  gridSel.addEventListener('change', () => {
    state.snapBeats = Number(gridSel.value) || 0
    app.log(`snap grid: ${gridSel.selectedOptions[0]?.textContent || 'Off'}`)
  })

  const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))
  const barBeats = () => TIME_SIGS[state.timesig] || 4

  /* Pitch classes the active key calls in-scale. `snap()`'s pitch half and the
     roll's row tint read this, so changing the key moves the target. */
  function scalePcs() {
    const scale = $('in-mode')?.value || 'chromatic'
    const root = Number($('in-root')?.value) || 0
    const offsets = tune.SCALES[scale] || tune.SCALES.chromatic
    return new Set(offsets.map((i) => (((i + root) % 12) + 12) % 12))
  }
  /* Pitch snap: pulls toward the key by the snap strength. A chromatic key or a
     zero strength is the identity, exactly like the beat grid's Off. */
  function snapPitch(midi, strength = Number($('in-snap').value) / 100) {
    const n = Number(midi)
    if (!Number.isFinite(n)) return 0
    const amount = clamp01(strength)
    const scale = $('in-mode')?.value || 'chromatic'
    if (amount <= 0 || scale === 'chromatic') return n
    const root = Number($('in-root')?.value) || 0
    return n + (tune.nearestInScale(n, root, scale) - n) * amount
  }
  /* Blend the raw position toward the division by the strength slider. Off (or
     a zero strength) is the identity, so nothing is nudged. A division of a bar
     or more follows the time signature instead of the fixed four beats. */
  function snap(beats, strength = Number($('in-snap').value) / 100) {
    const n = Number(beats)
    if (!Number.isFinite(n)) return 0
    const div = state.snapBeats >= 4 ? barBeats() : state.snapBeats
    const amount = clamp01(strength)
    if (!div || div <= 0 || amount <= 0) return n
    return n + (Math.round(n / div) * div - n) * amount
  }

  /* The beat pixel scale is derived: zoom is pixels per 4/4 bar at 120 bpm, the
     tempo stretches or compresses that, and a bar is as wide as the meter says.
     Both --bar and --ppb carry the bar width (app.js and timeline.js map clicks
     through those), --beat carries the subdivision the lane grid draws. */
  const bpmNow = () => Number($('in-bpm').value) || 96
  const pxPerBeat = () => (state.zoom / 4) * (bpmNow() / BASE_BPM)
  const barPx = () => pxPerBeat() * barBeats()
  const beatsOf = (px) => px / pxPerBeat()
  const pxOf = (beats) => beats * pxPerBeat()
  const playheadBeats = () => Math.max(0, state.playhead * bpmNow() / 60)

  /* Re-derive every pixel from the current tempo, meter and zoom, then snap the
     transport marks back onto the (possibly new) grid. */
  function applyScale() {
    const root = document.documentElement
    root.style.setProperty('--bar', `${barPx()}px`)
    root.style.setProperty('--ppb', `${barPx()}px`)
    root.style.setProperty('--beat', `${pxPerBeat()}px`)
    // clips with an explicit pixel width only repaint when their row signature
    // changes, so clear it and nudge the observer timeline keeps on the rows
    document.querySelectorAll('.lane-row').forEach((row) => { row.dataset.tlSig = '' })
    const rows = $('lane-rows')
    if (rows) rows.append(document.createComment('scale'))
    zoomSlider.value = String(state.zoom)
    rebuildRuler()
    laneSpan()
    const head = $('playhead')
    if (head) head.style.left = `${pxOf(playheadBeats())}px`
    if (state.loop) paintLoop()
    return state.zoom
  }

  function placePlayhead(beats) {
    state.playhead = Math.max(0, beats) * 60 / bpmNow()
    const head = $('playhead')
    if (head) head.style.left = `${pxOf(Math.max(0, beats))}px`
  }
  function snapPlayhead() { placePlayhead(snap(playheadBeats())) }
  /* both edges of the loop band land on the grid together, so a ruled loop is
     always whole beats (and Off leaves the drag exactly as drawn) */
  function snapLoop() {
    if (!state.loop) return
    const pp = pxPerBeat()
    const a = Math.max(0, snap(beatsOf(state.loop.from)) * pp)
    const b = Math.max(0, snap(beatsOf(state.loop.to)) * pp)
    state.loop = { from: Math.min(a, b), to: Math.max(a, b) }
    paintLoop()
  }


  // the lane (app.js) and the ruler (timeline) both set the playhead; snap after
  // they have run, and snap the loop band after every ruler drag
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#lane, #ruler')) return
    snapPlayhead()
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#lane, #ruler')) return
    snapPlayhead()
    snapLoop()
  })
  document.addEventListener('pointerup', (e) => {
    if (!e.target.closest('#ruler')) return
    snapLoop()
  })

  // ---------------------------------------------------------------- zoom
  const ZOOM_MIN = 24
  const ZOOM_MAX = 220
  const zoomIn = document.createElement('label')
  zoomIn.className = 'zoomsel'
  zoomIn.innerHTML = '<input id="in-zoom" type="range" min="24" max="220" step="1" value="77" aria-label="Timeline zoom">'
  $('btn-zoom-out').before(zoomIn)
  const zoomSlider = $('in-zoom')

  function arrangementBars() {
    let beats = 16
    state.tracks.forEach((t) => {
      [t.clip, ...(Array.isArray(t.clips) ? t.clips : [])].filter(Boolean).forEach((c) => {
        beats = Math.max(beats, (c.startBeat || 0) + (c.lengthBeats || 0))
      })
    })
    return Math.ceil(beats / barBeats()) + 8
  }

  // the ruler re-derives its own bar count from the arrangement and the zoom
  function rebuildRuler() {
    const ruler = $('ruler')
    if (!ruler) return 0
    const lane = $('lane')
    const bars = Math.max(24, arrangementBars(), Math.ceil((lane?.clientWidth || 0) / barPx()) + 2)
    ruler.innerHTML = Array.from({ length: bars }, (_, i) => `<span class="bar${i === 0 ? ' on' : ''}">${i + 1}</span>`).join('')
    const band = document.createElement('span')
    band.className = 'loop-region'
    band.id = 'loop-region'
    band.hidden = true
    ruler.append(band)
    paintLoop()
    return bars
  }

  // rows carry the zoomed length so the lane can scroll at all
  function laneSpan() {
    const bars = document.querySelectorAll('#ruler .bar').length || 24
    const width = `${bars * barPx()}px`
    const rows = $('lane-rows')
    if (rows) rows.style.width = width
    document.querySelectorAll('.lane-row').forEach((row) => { row.style.width = width })
  }

  function keepPlayheadInView() {
    const lane = $('lane')
    if (!lane) return
    const x = pxOf(playheadBeats())
    const margin = 24
    if (x < lane.scrollLeft + margin || x > lane.scrollLeft + lane.clientWidth - margin) {
      lane.scrollLeft = Math.max(0, x - lane.clientWidth / 2)
    }
    const row = $('ruler-row')
    if (row) row.scrollLeft = lane.scrollLeft
  }

  function setZoom(value) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(Number(value) || state.zoom)))
    state.zoom = next
    applyScale()
    // the lane is only scrollable if it is actually wider than the viewport:
    // applyScale already gave the rows and their host the full zoomed length
    keepPlayheadInView()
    return next
  }
  zoomSlider.value = String(state.zoom)
  zoomSlider.addEventListener('input', (e) => setZoom(e.target.value))
  $('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom + 14))
  $('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom - 14))
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key === '0') return
    if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom(state.zoom + 14) }
    if (e.key === '-') { e.preventDefault(); setZoom(state.zoom - 14) }
  })

  // ---------------------------------------------------------------- meter + key
  // The header's static "4 / 4" becomes a real meter picker: the meter regroups
  // the ruler, moves the beat scale and decides where the metronome accent lands.
  function buildMeter() {
    const slot = document.querySelector('.tb-left .ts')
    if (!slot || slot.tagName === 'SELECT') return
    const sel = document.createElement('select')
    sel.id = 'in-timesig'
    sel.className = 'ts'
    sel.setAttribute('aria-label', 'Time signature')
    sel.innerHTML = Object.keys(TIME_SIGS)
      .map((sig) => `<option value="${sig}"${sig === state.timesig ? ' selected' : ''}>${sig.replace('/', ' / ')}</option>`).join('')
    slot.replaceWith(sel)
    sel.addEventListener('change', () => {
      const next = TIME_SIGS[sel.value] ? sel.value : '4/4'
      state.timesig = next
      writeStore(TIMESIG_KEY, next)
      applyScale()
      snapLoop()
      snapPlayhead()
      drawRoll()
      if (transport.playing) startLoopPlay({ from: transport.from, to: transport.to })
      app.log(`meter ${next} — bars regroup every ${barBeats()} beats`)
    })
  }
  buildMeter()

  /* The key feeds snap()'s pitch target: the roll tints in-key rows and a drag
     lands on the scale at the snap strength. app.js keeps the take in tune. */
  function syncKey() {
    state.key = { root: Number($('in-root')?.value) || 0, scale: $('in-mode')?.value || 'chromatic' }
    if (activeRoll()) drawRoll()
    state.edit?.paint?.()
  }
  $('in-root')?.addEventListener('change', syncKey)
  $('in-mode')?.addEventListener('change', syncKey)

  // ---------------------------------------------------------------- metronome
  let metroCtx = null
  let countTimer = 0
  function metroContext() {
    if (!metroCtx || metroCtx.state === 'closed') metroCtx = new AudioContext()
    if (metroCtx.state === 'suspended') metroCtx.resume().catch(() => {})
    return metroCtx
  }
  /* a 1 kHz square blip with a 4 ms attack and a 45 ms tail — short enough to
     sit under the take, loud enough to follow at 40 bpm */
  function blip(at, accent) {
    const ctx = metroCtx
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 1000
    const peak = Math.max(0.0002, state.metroLevel * (accent ? 0.4 : 0.26))
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + 0.06)
  }

  function metroStart(fromBeat = 0) {
    if (!state.metronome) return
    const ctx = metroContext()
    transport.metroBeat = fromBeat
    let next = ctx.currentTime + 0.05
    if (transport.timer) clearInterval(transport.timer)
    const tick = () => {
      const spb = 60 / bpmNow()
      while (next < ctx.currentTime + 0.16) {
        blip(next, state.metroAccent && transport.metroBeat % barBeats() === 0)
        transport.metroBeat += 1
        next += spb
      }
    }
    tick()
    transport.timer = setInterval(tick, 25)
  }
  function metroStop() {
    if (transport.timer) clearInterval(transport.timer)
    transport.timer = 0
  }
  function paintMetro() {
    $('btn-metro').setAttribute('aria-pressed', String(state.metronome))
    $('btn-metro').classList.toggle('on', state.metronome)
  }
  $('btn-metro').addEventListener('click', () => {
    state.metronome = !state.metronome
    paintMetro()
    if (state.metronome) {
      metroContext()
      if (transport.playing || state.ctx) metroStart(playheadBeats())
    } else metroStop()
  })
  paintMetro()

  // level lives in the metronome menu, which already had a volume row
  const levelRow = document.createElement('label')
  levelRow.className = 'menu-range'
  levelRow.innerHTML = `<span>Click level</span><input id="in-metro-level" type="range" min="0" max="100" step="1" value="${Math.round(state.metroLevel * 100)}" aria-label="Metronome click level"><output id="out-metro-level">${Math.round(state.metroLevel * 100)}%</output>`
  $('menu-metro').prepend(levelRow)
  $('in-metro-level').addEventListener('input', (e) => {
    state.metroLevel = Number(e.target.value) / 100
    $('out-metro-level').textContent = `${e.target.value}%`
    const row = $('menu-metro').querySelector('[data-metro="volume"]')
    if (row) row.textContent = `Click volume: ${e.target.value}%`
  })
  $('menu-metro').addEventListener('click', (e) => {
    const item = e.target.closest('[data-metro]')
    if (!item) return
    if (item.dataset.metro === 'count') {
      state.countIn = (state.countIn + 1) % 3
      $('in-countin').value = String(state.countIn)
      $('metro-countin').textContent = state.countIn ? `${state.countIn} bar${state.countIn === 1 ? '' : 's'}` : 'off'
    }
    if (item.dataset.metro === 'accent') {
      state.metroAccent = !state.metroAccent
      item.textContent = `Accent bar 1: ${state.metroAccent ? 'on' : 'off'}`
    }
  })

  // ---------------------------------------------------------------- input column
  // The inspector's left column: device list, channel select, Input Level /
  // Monitoring tabs, and a meter fed by a real analyser. The stream is opened
  // only while a track is armed or monitoring is on, so the mic light is honest.
  const AUDIO_TYPES = new Set(['voice', 'guitar', 'bass', 'sampler', 'loop'])
  const isAudioTrack = (t) => Boolean(t && AUDIO_TYPES.has(t.type))
  const insDb = () => document.querySelector('.ins-db')
  const insFill = () => document.querySelector('.ins-meter i')
  let inputTimer = 0
  let inputBuf = null
  let lastDbPaint = 0
  const monitoring = () => $('btn-monitor')?.getAttribute('aria-pressed') === 'true'
  const masterDb = () => {
    const v = Number($('in-gain')?.value)
    return Number.isFinite(v) ? v : 0
  }

  function paintMeter(db) {
    const pct = Number.isFinite(db) ? Math.min(100, Math.max(0, ((db + 60) / 60) * 100)) : 0
    const fill = insFill()
    if (fill) fill.style.width = `${pct.toFixed(1)}%`
    document.querySelector('.ins-meter')?.toggleAttribute('data-hot', Number.isFinite(db) && db > -9)
    const now = performance.now()
    if (now - lastDbPaint < 80) return
    lastDbPaint = now
    const el = insDb()
    if (el) {
      el.textContent = Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '-∞ dBFS'
      el.classList.remove('denied')
    }
  }

  function meterFrame() {
    const input = state.input
    if (!input) return
    if (!inputBuf || inputBuf.length !== input.analyser.fftSize) inputBuf = new Float32Array(input.analyser.fftSize)
    input.analyser.getFloatTimeDomainData(inputBuf)
    let peak = 0
    for (let i = 0; i < inputBuf.length; i++) {
      const v = Math.abs(inputBuf[i])
      if (v > peak) peak = v
    }
    paintMeter(peak > 1e-7 ? 20 * Math.log10(peak) : -Infinity)
  }

  function startMeter() {
    if (!inputTimer) inputTimer = setInterval(meterFrame, 60)
  }

  function stopMeter() {
    if (inputTimer) clearInterval(inputTimer)
    inputTimer = 0
    inputBuf = null
    const fill = insFill()
    if (fill) fill.style.width = '0%'
    document.querySelector('.ins-meter')?.removeAttribute('data-hot')
    const el = insDb()
    if (el && !state.micDenied) el.textContent = '-∞ dBFS'
  }

  async function refreshDevices() {
    const sel = $('in-device')
    if (!sel) return
    const prev = sel.value
    let inputs = []
    try {
      inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    } catch (err) { /* enumeration can fail before permission on some builds */ }
    const labelled = inputs.some((d) => d.label)
    sel.innerHTML = ''
    const fallback = document.createElement('option')
    fallback.value = ''
    fallback.textContent = state.micDenied
      ? 'Default microphone — permission denied'
      : labelled && inputs[0]?.label
        ? `Default — ${inputs[0].label}`
        : 'Default microphone'
    sel.append(fallback)
    sel.title = fallback.textContent
    inputs.forEach((d, i) => {
      const opt = document.createElement('option')
      opt.value = d.deviceId
      opt.textContent = d.label || `Input ${i + 1}`
      sel.append(opt)
    })
    sel.value = [...sel.options].some((o) => o.value === prev) ? prev : ''
    refreshChannels()
  }

  function refreshChannels() {
    const sel = $('in-channel')
    if (!sel) return
    const want = sel.value
    const track = state.input?.stream?.getAudioTracks?.()[0]
    let count = 1
    try { count = track?.getSettings().channelCount || 1 } catch (err) { count = 1 }
    sel.innerHTML = '<option>Channel 1</option>' + (count > 1 ? '<option>Channel 2</option>' : '')
    if (want === 'Channel 2' && count > 1) sel.value = 'Channel 2'
    if (count > 1) sel.removeAttribute('title')
    else sel.title = 'the selected device is mono'
  }

  function channelIndex() {
    return $('in-channel')?.value === 'Channel 2' ? 1 : 0
  }

  function applyMonitor() {
    if (!state.input) return
    state.input.setMonitorDb(monitoring() ? masterDb() : -80)
  }

  function paintMonitorButton() {
    const btn = $('btn-monitor')
    if (!btn) return
    const on = monitoring()
    btn.setAttribute('aria-pressed', String(on))
    btn.textContent = on ? 'Monitoring on' : 'Monitoring off'
    btn.classList.toggle('on', on)
  }

  async function ensureInput() {
    if (state.inputStale) { state.inputStale = false; closeInput() }
    if (state.input?.stream?.active) return state.input
    if (state.inputOpen) return state.inputOpen
    state.inputOpen = (async () => {
      try {
        const input = await capture.openInput({
          deviceId: $('in-device')?.value || '',
          channels: 2,
        })
        state.input = input
        state.micDenied = false
        $('ins-denial')?.setAttribute('hidden', '')
        startMeter()
        await refreshDevices()
        const label = input.stream.getAudioTracks?.()[0]?.label || 'microphone'
        app.log(`input ready: ${label}`)
        if (!state.rec && $('mic-state')) $('mic-state').textContent = 'input armed'
        if (monitoring()) applyMonitor()
        return input
      } catch (err) {
        state.input = null
        const denied = err?.message === 'mic denied'
        state.micDenied = denied
        stopMeter()
        app.log(denied
          ? 'mic denied — allow the microphone in Chrome, the demo take is kept'
          : `input: ${err?.message || err}`)
        const el = insDb()
        if (el) {
          el.textContent = denied ? 'denied' : 'unavailable'
          el.classList.add('denied')
        }
        $('ins-denial')?.removeAttribute('hidden')
        refreshDevices().catch(() => {})
        return null
      } finally {
        state.inputOpen = null
      }
    })()
    return state.inputOpen
  }

  function closeInput() {
    const input = state.input
    state.input = null
    stopMeter()
    if (!state.rec && $('mic-state')) $('mic-state').textContent = 'mic idle'
    try { input?.close() } catch (err) { /* already torn down */ }
  }

  function onArmChanged(t) {
    if (!t) return
    if (t.armed && isAudioTrack(t)) { ensureInput().catch(() => {}) }
    else if (t.armed) app.log(`${t.name} is a MIDI track — arm a Voice/Audio track to record`)
    else if (!state.tracks.some((x) => x.armed) && !monitoring()) closeInput()
  }

  function buildInputColumn() {
    const left = document.querySelector('.ins-left')
    const level = left?.querySelector('.ins-level')
    const subtabs = left?.querySelector('.ins-subtabs')
    const tabs = [...(left?.querySelectorAll('.ins-sub') || [])]
    if (!left || !level || !subtabs || tabs.length < 2) return

    const meter = level.querySelector('.ins-meter')
    if (meter && !meter.id) meter.id = 'ins-meter'
    const db = level.querySelector('.ins-db')
    if (db && !db.id) db.id = 'ins-db'

    const bodies = document.createElement('div')
    bodies.className = 'ins-bodies'
    const levelPane = document.createElement('div')
    levelPane.className = 'ins-pane'
    levelPane.dataset.pane = 'level'
    level.replaceWith(levelPane)
    levelPane.append(level)

    const denial = document.createElement('p')
    denial.id = 'ins-denial'
    denial.className = 'ins-note ins-denied'
    denial.hidden = true
    denial.textContent = 'Microphone blocked — allow it in Chrome, then arm again.'
    levelPane.append(denial)

    const monPane = document.createElement('div')
    monPane.className = 'ins-pane'
    monPane.dataset.pane = 'monitor'
    monPane.hidden = true
    monPane.innerHTML = `<button class="pill ins-monitor" id="btn-monitor" type="button" aria-pressed="false">Monitoring off</button>
      <p class="ins-note">Routes the mic straight to the master. Use headphones so the speakers do not feed back.</p>`
    bodies.append(levelPane, monPane)
    subtabs.after(bodies)

    const select = (index) => {
      tabs.forEach((tab, i) => {
        const on = i === index
        tab.classList.toggle('on', on)
        tab.setAttribute('aria-selected', String(on))
        tab.tabIndex = on ? 0 : -1
      })
      levelPane.hidden = index !== 0
      monPane.hidden = index === 0
    }
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => select(i))
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
        e.preventDefault()
        const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
        tabs[next].focus()
        select(next)
      })
    })
    select(0)

    $('btn-monitor').addEventListener('click', async () => {
      const on = !monitoring()
      const btn = $('btn-monitor')
      btn.setAttribute('aria-pressed', String(on))
      paintMonitorButton()
      if (on) {
        const input = await ensureInput()
        if (!input) {
          btn.setAttribute('aria-pressed', 'false')
          paintMonitorButton()
          app.log('monitoring needs mic access')
          return
        }
        applyMonitor()
        app.log(`monitoring on — mic routed to master (${masterDb().toFixed(1)} dB)`)
        return
      }
      applyMonitor()
      app.log('monitoring off')
      if (!state.tracks.some((x) => x.armed)) closeInput()
    })
  }

  buildInputColumn()
  function inputChanged() {
    if (state.rec) {
      state.inputStale = true
      app.log('input change: applies to the next take')
      return
    }
    closeInput()
    ensureInput().catch(() => {})
  }
  $('in-device')?.addEventListener('change', () => {
    inputChanged()
    const sel = $('in-device')
    if (sel) sel.title = sel.selectedOptions[0]?.textContent || ''
  })
  refreshDevices()
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
  $('in-channel')?.addEventListener('change', () => {
    if (!state.input) return
    if (state.rec) { state.inputStale = true; app.log('input change: applies to the next take'); return }
    closeInput()
    ensureInput().catch(() => {})
  })
  $('in-gain')?.addEventListener('input', () => { if (monitoring()) applyMonitor() })
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { refreshDevices().catch(() => {}) })
  refreshDevices().catch(() => {})
  window.addEventListener('pagehide', () => closeInput())
  state.input = null
  state.inputOpen = null
  state.inputStale = false
  state.micDenied = false

  // ---------------------------------------------------------------- count-in
  const countBadge = document.createElement('span')
  countBadge.id = 'count-in'
  countBadge.className = 'count-in'
  countBadge.hidden = true
  countBadge.setAttribute('role', 'status')
  countBadge.setAttribute('aria-live', 'assertive')
  $('rec-timer').before(countBadge)

  function countIn(bars, done) {
    const ctx = metroContext()
    const total = bars * barBeats()
    const spb = 60 / bpmNow()
    const badge = $('count-in')
    const first = ctx.currentTime + 0.1
    let step = 0
    transport.counting = true
    document.body.classList.add('counting')
    badge.hidden = false
    const tick = () => {
      if (step >= total) {
        clearInterval(countTimer)
        countTimer = 0
        transport.counting = false
        badge.hidden = true
        document.body.classList.remove('counting')
        done()
        return
      }
      blip(first + step * spb, step % 4 === 0)
      badge.textContent = String(total - step)
      step += 1
    }
    tick()
    countTimer = setInterval(tick, spb * 1000)
  }

  function cancelCountIn() {
    if (!transport.counting) return
    clearInterval(countTimer)
    countTimer = 0
    transport.counting = false
    $('count-in').hidden = true
    document.body.classList.remove('counting')
    metroStop()
  }

  // capture phase so the count-in can hold app.js's record handler back
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-record')) return
    if (state.countSkip) { state.countSkip = false; return }
    if (state.rec) { metroStop(); return }
    // a second press during the count-in skips the wait and records now.
    // The click is deferred: a click() nested inside a dispatched click is
    // swallowed by the click-in-progress flag.
    if (transport.counting) {
      cancelCountIn()
      e.preventDefault()
      e.stopPropagation()
      setTimeout(() => {
        state.countSkip = true
        $('btn-record').click()
      }, 0)
      if (state.metronome) setTimeout(() => metroStart(0), 120)
      return
    }
    if (!state.countIn) {
      if (state.metronome) setTimeout(() => metroStart(0), 120)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    countIn(state.countIn, () => {
      state.countSkip = true
      $('btn-record').click()
      if (state.metronome) setTimeout(() => metroStart(0), 120)
    })
  }, true)

  // ---------------------------------------------------------------- loop play
  function loopBeats() {
    if (!state.loop) return null
    const from = Math.max(0, beatsOf(Math.min(state.loop.from, state.loop.to)))
    const to = Math.max(0, beatsOf(Math.max(state.loop.from, state.loop.to)))
    return to - from < 0.06 ? null : { from, to }
  }

  function scheduleCycle(ctx, buffer, gain, when, live) {
    const spb = 60 / bpmNow()
    const fromSec = transport.from * spb
    const toSec = transport.to * spb
    state.notes.forEach((note) => {
      const start = note.start
      const end = start + note.dur
      if (end <= fromSec || start >= toSec) return
      const skip = Math.max(0, fromSec - start)
      const dur = Math.min(note.dur - skip, toSec - (start + skip))
      if (dur <= 0.02) return
      const shift = Number.isFinite(note.shift) ? note.shift : (Number(note.cents) || 0) / 100
      const src = ctx.createBufferSource()
      src.buffer = buffer
      // same live path as plain playback: a node seeded with the current shift
      // so a parameter drag moves it
      const entry = live ? { index: state.notes.indexOf(note), node: shifter.create(ctx, shift) } : null
      if (entry) {
        src.connect(entry.node).connect(gain)
        state.live.push(entry)
      } else {
        src.playbackRate.value = Math.pow(2, shift / 12)
        src.connect(gain)
      }
      tapSource(src)
      const at = when + Math.max(0, start - fromSec) * 1
      src.start(at, start + skip, dur)
      transport.sources.push(src)
    })
  }

  function loopFrame() {
    if (!transport.playing || !transport.ctx) return
    const elapsed = Math.max(0, transport.ctx.currentTime - transport.t0)
    const pos = transport.from * 60 / bpmNow() + (elapsed % transport.len)
    state.playhead = pos
    const head = $('playhead')
    if (head) head.style.left = `${pxOf(pos * bpmNow() / 60)}px`
    if (state.follow) keepPlayheadInView()
    transport.raf = requestAnimationFrame(loopFrame)
  }

  function stopLoopPlay() {
    if (!transport.playing) return
    const ctx = transport.ctx
    transport.playing = false
    if (transport.timer) clearInterval(transport.timer)
    transport.timer = 0
    if (transport.raf) cancelAnimationFrame(transport.raf)
    transport.raf = 0
    transport.sources.forEach((src) => { try { src.stop() } catch { /* ended */ } })
    transport.sources = []
    ctx?.close()
    transport.ctx = null
    state.playing = state.playing.filter((src) => src.context !== ctx)
    $('btn-play').disabled = !state.notes.length
    $('btn-stop').disabled = true
    metroStop()
  }

  async function startLoopPlay(spec) {
    stopLoopPlay()
    const ctx = new AudioContext({ sampleRate: state.sampleRate })
    ctx.resume?.().catch(() => {})
    const spb = 60 / bpmNow()
    transport.ctx = ctx
    transport.from = spec.from
    transport.to = spec.to
    transport.len = (spec.to - spec.from) * spb
    transport.t0 = ctx.currentTime + 0.08
    transport.sources = []
    transport.playing = true
    const gain = ctx.createGain()
    gain.gain.value = Math.pow(10, Number($('in-gain').value) / 20)
    gain.connect(ctx.destination)
    const buffer = ctx.createBuffer(1, state.take.length, state.sampleRate)
    buffer.copyToChannel(state.take, 0)
    const live = await shifter.ready(ctx)
    state.live = []
    placePlayhead(spec.from)
    let cycle = transport.t0
    const pump = () => {
      while (cycle < ctx.currentTime + 0.4) {
        scheduleCycle(ctx, buffer, gain, cycle, live)
        cycle += transport.len
      }
    }
    pump()
    transport.timer = setInterval(pump, 60)
    transport.raf = requestAnimationFrame(loopFrame)
    $('btn-play').disabled = true
    $('btn-stop').disabled = false
    app.status(`looping ${spec.from.toFixed(2)}–${spec.to.toFixed(2)} beats`)
    metroStart(spec.from)
    startMeter()
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#btn-play')) return
    const spec = loopBeats()
    if (!spec || !state.notes.length) {
      // app.js owns plain playback; let it start, then tap the sources for the
      // meters once they exist
      setTimeout(() => { attachAnalyser(); startMeter() }, 80)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    if (transport.playing) { stopLoopPlay(); app.status('stopped'); return }
    startLoopPlay(spec)
  }, true)

  $('btn-stop').addEventListener('click', () => {
    if (transport.playing) { stopLoopPlay(); placePlayhead(transport.from); return }
    metroStop()
  })
  $('in-bpm').addEventListener('change', () => {
    applyScale()
    snapLoop()
    snapPlayhead()
    drawRoll()
    if (transport.playing) { const spec = { from: transport.from, to: transport.to }; startLoopPlay(spec) }
  })
  // the spinner fires input before change: keep the grid under the pointer
  $('in-bpm').addEventListener('input', () => { if (document.activeElement === $('in-bpm')) applyScale() })
  $('in-countin').addEventListener('change', (e) => {
    state.countIn = Number(e.target.value)
    $('metro-countin').textContent = state.countIn ? `${state.countIn} bar${state.countIn === 1 ? '' : 's'}` : 'off'
  })

  $('in-grid').parentElement.hidden = false
  $('in-snap').parentElement.hidden = false
  $('btn-snap').addEventListener('click', () => {
    const on = $('btn-snap').getAttribute('aria-pressed') !== 'true'
    $('btn-snap').setAttribute('aria-pressed', String(on))
    $('in-grid').parentElement.hidden = !on
    $('in-snap').parentElement.hidden = !on
    app.log(`snap ${on ? 'on' : 'off'}`)
  })
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
    // the registry keys are dotted and these are the tails; the last segment is
    // the contract, so a new binding only needs a matching entry here
    cut: () => state.timeline?.cut(), copy: () => state.timeline?.copy(),
    paste: () => state.timeline?.paste(), duplicate: () => state.timeline?.duplicate(),
    delete: () => state.timeline?.delete(), deleteBack: () => state.timeline?.delete(),
    selectAll: () => state.timeline?.selectAll(), join: () => state.timeline?.join(),
    fit: () => state.timeline?.fit(), close: () => app.openPanel('take'),
    countIn: () => $('menu-metro').querySelector('[data-metro="count"]').click(),
    punch: () => $('btn-punch') ? $('btn-punch').click() : $('btn-loop').click(),
    playStop: () => ($('btn-play').disabled ? null : $('btn-play').click()),
    toStart: () => $('btn-stop').click(),
    openEditor: () => app.openPanel('take'), toggleAutomation: () => toggleAutomation(),
    history: () => app.openPanel('versions'), newTrack: () => openModal('addtrack'),
    open: () => app.openPanel('take'), export: () => $('btn-export').click(),
  }
  document.addEventListener('keydown', (e) => {
    if (shortcuts.isTypingTarget(e.target)) return
    const binding = shortcuts.find(e)
    if (!binding) return
    const fn = ACTIONS[binding.action.split('.').pop()] || ACTIONS[binding.action]
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
  $('btn-export-confirm')?.addEventListener('click', () => { app.exportWav(); closeModal($('m-export')) })
  $('in-track-vol')?.addEventListener('input', (e) => {
    const t = findTrack(state.active)
    if (!t) return
    tracks.setVolumeDb(t, Number(e.target.value))
    syncTrackDom(t)
    renderMixer()
  })
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
  if (new URLSearchParams(location.search).get('mixer') === '1') { $('mixer').hidden = false }
  renderFxBrowser()
  renderTrackList()
  renderSounds()
  renderVersions()
  paintAp()
  paintMaster()
  renderChain(state.tracks[0])
  drawRoll()
  setZoom(state.zoom)
  paintLoop()

  return {
    state,
    renderAll() { renderTrackList(); syncAll(); drawRoll(); renderSounds(); renderVersions() },
    drawRoll,
    snap,
    snapPitch,
    barBeats: () => barBeats(),
    timesig: (value) => {
      const sel = $('in-timesig')
      if (value !== undefined && sel && TIME_SIGS[value]) { sel.value = value; sel.dispatchEvent(new Event('change')) }
      return state.timesig
    },
    rail: (collapsed) => {
      if (collapsed !== undefined) setRail(!!collapsed)
      return document.body.classList.contains('rail-collapsed') ? 'collapsed' : 'open'
    },
    grid: (value) => {
      if (value !== undefined) { gridSel.value = String(value); gridSel.dispatchEvent(new Event('change')) }
      return { value: gridSel.value, label: gridSel.selectedOptions[0]?.textContent, beats: state.snapBeats }
    },
    zoom: (value) => (value === undefined ? state.zoom : setZoom(value)),
    metronome: (on) => {
      if (on === undefined) return state.metronome
      if (state.metronome !== !!on) $('btn-metro').click()
      return state.metronome
    },
    metroLevel: (v) => {
      if (v !== undefined) {
        state.metroLevel = Math.min(1, Math.max(0, v))
        $('in-metro-level').value = String(Math.round(state.metroLevel * 100))
      }
      return state.metroLevel
    },
    countIn: (bars) => {
      if (bars !== undefined) { state.countIn = bars; $('in-countin').value = String(bars) }
      return state.countIn
    },
    input: {
      ensure: () => ensureInput(),
      close: () => closeInput(),
      analyser: () => state.input?.analyser || null,
      stream: () => state.input?.stream || null,
      channel: () => channelIndex(),
      device: () => $('in-device')?.value || '',
      label: () => document.querySelector('#in-device option:checked')?.textContent || 'microphone',
      monitoring: () => monitoring(),
      refresh: () => refreshDevices(),
      syncArmed: () => {
        if (state.tracks.some((t) => t.armed && isAudioTrack(t))) {
          ensureInput().then((input) => {
            // permission can still be settling at boot; one retry after a beat
            if (!input) setTimeout(() => { ensureInput().catch(() => {}) }, 700)
          })
        } else if (!monitoring()) closeInput()
      },
      refreshIfStale: () => { if (state.inputStale) ensureInput().catch(() => {}) },
    },
    addTrack: (type) => { const t = tracks.addTrack(state.tracks, { type, name: tracks.typeInfo(type).label }); if (tracks.typeInfo(type).midi) state.rolls.set(t.id, roll.createRoll()); if (type === 'drums') state.patterns.set(t.id, drums.createPattern()); renderTrackList(); return t.id },
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

// ---------------------------------------------------------------- roll geometry
// Appended so the renderer, `rollPoint` above and js/edit.js all share one
// mapping. ROWS / the 26 px gutter / the 32-beat voice axis are the values
// renderRoll and its pointer handler already use; keep them in step.
export const ROLL_ROWS = 24
export const ROLL_GUTTER = 26
export const VOICE_BEATS = 32

// Visible pitch window for the active track, mirroring renderRoll's `low`:
// an instrument roll uses its own lowMidi, a voice track hangs under its
// lowest note the way the read-only take view draws it.
export function rollBounds(state) {
  const r = state.rolls?.get(state.active)
  if (r) return { low: r.lowMidi, rows: ROLL_ROWS, beats: r.lengthBeats }
  const lowest = state.notes.length ? Math.min(...state.notes.map((n) => Math.floor(n.midi))) : 48
  return { low: Math.max(24, lowest - 2), rows: ROLL_ROWS, beats: VOICE_BEATS }
}

// Pointer position -> { beat, midi } in the active roll, unclamped so a drag
// keeps tracking past the edges. `midiF` is fractional for pitch drags, `row`
// is the raw row index.
export function rollPoint(state, box, clientX, clientY) {
  const b = rollBounds(state)
  const span = Math.max(1, box.width - ROLL_GUTTER)
  const beat = ((clientX - box.left - ROLL_GUTTER) / span) * b.beats
  const rowF = ((clientY - box.top) / Math.max(1, box.height)) * b.rows
  return { beat, midiF: b.low + b.rows - 1 - rowF, midi: b.low + b.rows - 1 - Math.floor(rowF), row: Math.floor(rowF), ...b }
}
