// js/edit.js — direct manipulation in the roll: drag a note in time and pitch,
// nudge its cents from the keyboard, marquee a group and delete it together,
// plus the undo stack the whole studio shares (Ctrl+Z / Shift+Ctrl+Z).
//
// Everything is delegated from `document` in the *capture* phase. studio.js
// binds a pointerdown on #roll that adds a note on every press; while a note is
// being grabbed or a marquee is running that handler must not also fire, so this
// layer claims the event first and stops it. A press on the pitch gutter is left
// alone — studio's own mapping owns that column.
//
// Geometry comes from studio.js (rollBounds / rollPoint): the renderer, not this
// file, decides where a row and a beat sit, so the hit boxes always match the
// pixels. A voice track edits `state.notes` (seconds, fractional midi + cents);
// an instrument track edits its roll (beats, integer midi + a detune `cents`).
import * as roll from './roll.js'
import * as tune from './tune.js'
import * as tracks from './tracks.js'
import * as fx from './fx.js'
import { rollBounds, rollPoint, ROLL_GUTTER } from './studio.js'

const $ = (id) => document.getElementById(id)

const MAX_UNDO = 50
const HIT_PAD = 3
const TAP_PX = 3
const GHOST_MS = 1400
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const centsOf = (n) => (Number.isFinite(n) ? Math.round(n) : 0)
// Every stack entry carries a kind only so the log line reads honestly.
const KIND_LABEL = { roll: 'roll edit', voice: 'take notes', mixer: 'mixer move' }
const kindLabel = (k) => KIND_LABEL[k] || 'mixer move'
const panRead = (p) => (p === 0 ? 'C' : p < 0 ? `L${Math.round(-p * 100)}` : `R${Math.round(p * 100)}`)
const noteName = (midi) => {
  const m = Math.round(midi)
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}
const signed = (c) => `${c > 0 ? '+' : ''}${c}c`
/* Per-note character, both stored on the note next to its cents: formant is a
   semitone shift of the vocal body (not the pitch), vibrato is the depth of a
   5.5 Hz wobble in percent. */
const FORMANT_LIMIT = 12
const VIBRATO_LIMIT = 100
const formantOf = (n) => clamp(Math.round(Number(n.formant) || 0), -FORMANT_LIMIT, FORMANT_LIMIT)
const vibratoOf = (n) => clamp(Math.round(Number(n.vibrato) || 0), 0, VIBRATO_LIMIT)
const stRead = (v) => `${v > 0 ? '+' : ''}${v} st`

const STYLES = `
#roll { touch-action: none; }
#roll.edit-hot { cursor: grab; }
body.edit-dragging #roll { cursor: grabbing; }
.roll-wrap .edit-overlay { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.roll-wrap .edit-ghost { position: absolute; z-index: 5; pointer-events: none; transform: translateY(-100%);
  padding: 2px 6px; border: 1px solid var(--cyan, #00c6d1); border-radius: 4px;
  background: rgba(4, 18, 22, 0.94); color: #d6f6f8;
  font: 11px/1.3 ui-monospace, Menlo, monospace; white-space: nowrap; }
.roll-wrap .edit-marquee { position: absolute; z-index: 4; pointer-events: none;
  border: 1px dashed rgba(0, 198, 209, 0.9); background: rgba(0, 198, 209, 0.1); }
.roll-wrap .note-insp { position: absolute; left: 10px; bottom: 10px; z-index: 6; width: 210px;
  display: grid; gap: 5px; padding: 7px 9px 8px; border-radius: 8px;
  border: 1px solid #24343a; background: rgba(6, 12, 14, 0.94); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  font: 10px/1.2 ui-monospace, Menlo, monospace; color: #9fb4ba; }
.roll-wrap .note-insp[hidden] { display: none; }
.roll-wrap .note-insp .ni-head { display: flex; align-items: baseline; gap: 6px; }
.roll-wrap .note-insp .ni-head b { font-size: 10px; font-weight: 600; color: #d6f6f8; letter-spacing: 0.04em; }
.roll-wrap .note-insp .ni-head span { margin-left: auto; color: #f5b800; }
.roll-wrap .note-insp label { display: grid; grid-template-columns: 52px 1fr 34px; align-items: center; gap: 5px; }
.roll-wrap .note-insp input { width: 100%; height: 3px; accent-color: var(--gold, #f5b800); }
.roll-wrap .note-insp output { text-align: right; color: #d6f6f8; font-variant-numeric: tabular-nums; }
.roll-wrap .note-insp .ni-hint { color: #5d7076; font-size: 9px; }
`

export function install({ state, log } = {}) {
  const rollEl = $('roll')
  const wrap = rollEl?.closest('.roll-wrap')
  if (!state || !rollEl || !wrap || state.edit) return

  if (!document.getElementById('edit-styles')) {
    const style = document.createElement('style')
    style.id = 'edit-styles'
    style.textContent = STYLES
    document.head.append(style)
  }

  const ui = { sel: new Set(), primary: null, drag: null, marquee: null, undo: [], redo: [], eid: 0, hideTimer: 0 }
  state.edit = ui
  state.editSel = ui.sel

  const overlay = document.createElement('canvas')
  overlay.className = 'edit-overlay'
  const ghost = document.createElement('div')
  ghost.className = 'edit-ghost'
  ghost.hidden = true
  const band = document.createElement('div')
  band.className = 'edit-marquee'
  band.hidden = true
  const insp = document.createElement('div')
  insp.className = 'note-insp'
  insp.hidden = true
  insp.setAttribute('role', 'group')
  insp.setAttribute('aria-label', 'Note character')
  insp.innerHTML = `<div class="ni-head"><b>CHARACTER</b><span id="ni-name">—</span></div>
    <label>Formant <input id="in-note-formant" type="range" min="-12" max="12" step="1" value="0" aria-label="Formant"><output id="out-note-formant">0 st</output></label>
    <label>Vibrato <input id="in-note-vibrato" type="range" min="0" max="100" step="1" value="0" aria-label="Vibrato"><output id="out-note-vibrato">0 %</output></label>
    <span class="ni-hint">[ ] formant · ; ' vibrato</span>`
  wrap.append(overlay, ghost, band, insp)

  // ---------------------------------------------------------------- model
  const kind = () => (state.rolls?.get(state.active) ? 'roll' : 'voice')
  const activeNotes = () => (kind() === 'roll' ? state.rolls.get(state.active).notes : state.notes)
  const secPerBeat = () => 60 / (Number($('in-bpm')?.value) || 120)
  const grid = () => {
    const v = Number($('in-quant')?.value)
    return Number.isFinite(v) && v > 0 ? v : 0.25
  }
  // pitch target from studio's snap(): the key at the snap strength
  const snapPitch = (midi) => (state.studio?.snapPitch ? state.studio.snapPitch(midi) : midi)
  const eid = (n) => (n._eid ?? (n._eid = `v${(ui.eid += 1)}`))
  const keyOf = (n, k = kind()) => (k === 'roll' ? `r:${n.id}` : `v:${eid(n)}`)
  const startBeatOf = (n, k) => (k === 'voice' ? n.start / secPerBeat() : n.start)
  const durBeatOf = (n, k) => (k === 'voice' ? n.dur / secPerBeat() : n.dur)

  function setSel(next) {
    ui.sel = next
    state.editSel = ui.sel
  }

  function collect() {
    const k = kind()
    if (!ui.sel.size) return []
    return activeNotes().filter((n) => ui.sel.has(keyOf(n, k)))
  }

  function syncSelectedIndex() {
    if (kind() !== 'voice' || !ui.primary) { state.selected = null; return }
    const i = state.notes.findIndex((n) => keyOf(n) === ui.primary)
    state.selected = i >= 0 ? i : null
  }

  // ---------------------------------------------------------------- character
  const primNote = () => collect().find((n) => keyOf(n) === ui.primary) || collect()[0] || null

  /* The inspector mirrors the primary note and writes to the whole selection;
     it hides the moment nothing is selected. */
  function paintInspector() {
    const note = primNote()
    if (!note) { insp.hidden = true; return }
    insp.hidden = false
    $('ni-name').textContent = noteName(note.midi)
    const f = formantOf(note)
    const v = vibratoOf(note)
    if (document.activeElement !== $('in-note-formant')) $('in-note-formant').value = String(f)
    if (document.activeElement !== $('in-note-vibrato')) $('in-note-vibrato').value = String(v)
    $('out-note-formant').textContent = stRead(f)
    $('out-note-vibrato').textContent = `${v} %`
  }

  const gesture = { open: false }
  function beginFxEdit() {
    if (gesture.open || !collect().length) return
    pushUndo(snapshot())
    gesture.open = true
  }

  function setFx(field, value) {
    const notes = collect()
    if (!notes.length) return
    for (const note of notes) {
      if (field === 'formant') note.formant = clamp(Math.round(value), -FORMANT_LIMIT, FORMANT_LIMIT)
      else note.vibrato = clamp(Math.round(value), 0, VIBRATO_LIMIT)
    }
    const first = notes[0]
    log(field === 'formant'
      ? `formant ${stRead(formantOf(first))}: ${noteName(first.midi)}`
      : `vibrato ${vibratoOf(first)}%: ${noteName(first.midi)}`)
    paint()
  }

  function nudgeFx(field, delta) {
    const notes = collect()
    if (!notes.length) return
    const base = notes[0]
    pushUndo(snapshot())
    gesture.open = false
    setFx(field, (field === 'formant' ? formantOf(base) : vibratoOf(base)) + delta)
  }

  // ---------------------------------------------------------------- snapshots
  const cloneEffect = (effect) => ({ ...effect, params: { ...effect.params } })
  const sameChain = (a, b) => a.length === b.length && a.every((e, i) => e.id === b[i].id)
  const nextFxId = (list) => list.reduce((max, e) => Math.max(max, Number(String(e.id).replace(/[^\d]/g, '')) || 0), 0) + 1

  /* One row per track: every value a strip owns. A gesture that only touches a
     note still records the mixer, so one Ctrl+Z always lands on a whole mixer
     state instead of a half-applied one. */
  function mixerRows() {
    return state.tracks.map((t) => ({
      id: t.id,
      volumeDb: t.volumeDb,
      pan: t.pan,
      mute: t.mute === true,
      solo: t.solo === true,
      sends: { reverb: t.sends?.reverb || 0, delay: t.sends?.delay || 0 },
      chain: (t.chain?.effects || []).map(cloneEffect),
    }))
  }

  function snapshot(kindOverride) {
    return {
      kind: kindOverride || kind(),
      active: state.active,
      selected: state.selected,
      notes: state.notes.map((n) => ({ ...n })),
      sel: [...ui.sel],
      primary: ui.primary,
      rolls: new Map([...state.rolls].map(([id, r]) => [id, roll.cloneRoll(r)])),
      mixer: mixerRows(),
    }
  }

  const mixSnapshot = () => snapshot('mixer')

  function pushUndo(snap) {
    ui.undo.push(snap)
    if (ui.undo.length > MAX_UNDO) ui.undo.shift()
    ui.redo.length = 0
    // the roll panel's own "Undo edit" button keeps working off the same stacks
    if (snap.kind === 'roll' && state.undoRoll) {
      const past = snap.rolls.get(snap.active)
      if (past) state.undoRoll.push(past)
    }
    syncButtons()
  }

  /* Faders, sends, mutes, solos and chain slots come back here. The chain is
     restored as whole effect objects (params included) so an undo after a
     removal brings the slot back rather than leaving a hole. */
  function applyMixer(list) {
    if (!Array.isArray(list)) return
    const byId = new Map(list.map((m) => [m.id, m]))
    let chains = false
    for (const t of state.tracks) {
      const src = byId.get(t.id)
      if (!src) continue
      tracks.setVolumeDb(t, Number(src.volumeDb))
      tracks.setPan(t, Number(src.pan))
      tracks.setSend(t, 'reverb', Number(src.sends?.reverb))
      tracks.setSend(t, 'delay', Number(src.sends?.delay))
      t.mute = src.mute === true
      t.solo = src.solo === true
      if (!t.chain || !Array.isArray(src.chain)) continue
      const effects = src.chain.map(cloneEffect)
      if (sameChain(t.chain.effects, effects)) continue
      t.chain.effects = effects
      fx.ensureLimiterLast(t.chain)
      t.chain.nextId = nextFxId(effects)
      chains = true
    }
    paintMixer()
    if (chains) state.studio?.setActive?.(state.active)
  }

  function restore(snap) {
    if (!snap) return
    state.active = snap.active
    state.notes = snap.notes.map((n) => ({ ...n }))
    state.rolls.clear()
    snap.rolls.forEach((r, id) => state.rolls.set(id, r))
    setSel(new Set(snap.sel))
    ui.primary = snap.primary
    syncSelectedIndex()
    applyMixer(snap.mixer)
    redraw()
  }

  function undo() {
    const snap = ui.undo.pop()
    if (!snap) return
    ui.redo.push(snapshot())
    if (snap.kind === 'roll') state.undoRoll?.pop()
    restore(snap)
    log(`undo: ${kindLabel(snap.kind)} restored`)
  }

  function redo() {
    const snap = ui.redo.pop()
    if (!snap) return
    ui.undo.push(snapshot())
    restore(snap)
    log(`redo: ${kindLabel(snap.kind)} reapplied`)
  }

  // ---------------------------------------------------------------- buttons
  /* Depth is mirrored on the toolbar whichever surface pushed: a clip delete
     from the arrangement or a quantize from the panel land on the same stacks
     without passing through pushUndo, so the rAF tick is the safety net. */
  let btnSig = ''
  function syncButtons() {
    const sig = `${ui.undo.length}:${ui.redo.length}`
    if (sig === btnSig) return
    btnSig = sig
    for (const [id, depth, verb] of [['btn-undo', ui.undo.length, 'Undo'], ['btn-redo', ui.redo.length, 'Redo']]) {
      const btn = $(id)
      if (!btn) continue
      const off = depth === 0
      btn.disabled = off
      btn.setAttribute('aria-disabled', String(off))
      btn.title = off ? `Nothing to ${verb.toLowerCase()}` : `${verb} (${depth})`
    }
  }
  function watchButtons() {
    syncButtons()
    ui.btnRaf = requestAnimationFrame(watchButtons)
  }
  ui.syncButtons = syncButtons
  ui.mixerRows = mixerRows

  // ---------------------------------------------------------------- redraw
  // The note list renderer is app.js's `renderNotes`, reached through the
  // window.VS hook it already publishes; state.studio.drawRoll is the roll.
  function renderList() {
    if (typeof window !== 'undefined' && window.VS?.setState) window.VS.setState({ notes: state.notes })
    else state.studio?.drawRoll?.()
    if (kind() === 'roll') {
      const r = state.rolls.get(state.active)
      const n = r?.notes.length ?? 0
      $('note-count').textContent = `${n} roll note${n === 1 ? '' : 's'}`
    }
  }

  function redraw() {
    state.studio?.drawRoll?.()
    renderList()
    paint()
  }

  function rectOf(note, box, b) {
    const gut = Math.min(ROLL_GUTTER, box.width)
    const beatW = (box.width - gut) / b.beats
    const rowH = box.height / b.rows
    const x = gut + startBeatOf(note, kind()) * beatW
    const y = (b.rows - 1 - (note.midi - b.low)) * rowH
    return { x, y: y + 2, w: Math.max(3, durBeatOf(note, kind()) * beatW), h: Math.max(2, rowH - 4) }
  }

  function paint() {
    if (!overlay.isConnected) return
    const box = rollEl.getBoundingClientRect()
    if (!box.width || !box.height) return
    const w = Math.round(box.width)
    const h = Math.round(box.height)
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h }
    const g = overlay.getContext('2d')
    g.clearRect(0, 0, w, h)
    syncSelectedIndex()
    const b = rollBounds(state)
    for (const note of collect()) {
      const rc = rectOf(note, box, b)
      g.fillStyle = 'rgba(0, 198, 209, 0.26)'
      g.fillRect(rc.x, rc.y, rc.w, rc.h)
      g.strokeStyle = 'rgba(0, 220, 233, 1)'
      g.lineWidth = 1.5
      g.strokeRect(Math.round(rc.x) + 0.5, Math.round(rc.y) + 0.5, Math.max(1, Math.round(rc.w) - 1), Math.max(1, Math.round(rc.h) - 1))
      // the character dot: left/right is formant, size is vibrato depth
      const f = formantOf(note)
      const v = vibratoOf(note)
      if (f || v) {
        const cx = rc.x + 4 + ((f + FORMANT_LIMIT) / (FORMANT_LIMIT * 2)) * Math.max(0, rc.w - 8)
        const cy = rc.y + Math.max(3, rc.h / 2)
        g.beginPath()
        g.arc(cx, cy, 1.6 + (v / VIBRATO_LIMIT) * 2.2, 0, Math.PI * 2)
        g.fillStyle = `rgba(245, 184, 0, ${(0.5 + v / 220).toFixed(2)})`
        g.fill()
      }
    }
    paintInspector()
  }
  ui.paint = paint

  // ---------------------------------------------------------------- mixer
  /* Undo has to put the pixels back too, so a restore repaints every strip from
     the model instead of asking for a re-render that would drop focus. */
  function paintMixer() {
    const audible = tracks.resolveSolo(state.tracks)
    for (const t of state.tracks) {
      document.querySelector(`[data-strip="${t.id}"]`)?.classList.toggle('off', !audible.has(t.id))
      document.querySelectorAll(`[data-vol="${t.id}"]`).forEach((el) => {
        el.value = String(t.volumeDb)
        const db = el.closest('.strip')?.querySelector('.db')
        if (db) db.textContent = t.volumeDb.toFixed(1)
      })
      document.querySelectorAll(`[data-vol-read="${t.id}"]`).forEach((el) => { el.textContent = `${t.volumeDb.toFixed(1)} dB` })
      document.querySelectorAll(`[data-pan="${t.id}"]`).forEach((el) => { el.value = String(t.pan * 100) })
      document.querySelectorAll(`[data-pan-read="${t.id}"]`).forEach((el) => { el.textContent = panRead(t.pan) })
      for (const key of ['reverb', 'delay']) {
        const send = t.sends?.[key] || 0
        document.querySelectorAll(`[data-send="${t.id}:${key}"]`).forEach((el) => {
          el.value = String(Math.round(send * 100))
          const knob = el.closest('.sendknob')
          if (!knob) return
          knob.classList.toggle('on', send > 0)
          const out = knob.querySelector('output')
          if (out) out.textContent = send > 0 ? `${Math.round(send * 100)}%` : '–'
        })
      }
      document.querySelectorAll(`[data-mute="${t.id}"], [data-solo="${t.id}"]`).forEach((b) => {
        const on = b.dataset.mute ? t.mute : t.solo
        b.setAttribute('aria-pressed', String(on))
        b.classList.toggle('on', !!on)
      })
      const inserts = t.chain?.effects.filter((e) => e.slug !== fx.LIMITER_SLUG).length || 0
      document.querySelectorAll(`[data-fx-count="${t.id}"]`).forEach((el) => {
        el.textContent = t.chain?.effects.length ? `${t.chain.effects.length} effects` : 'no effects'
      })
      document.querySelectorAll(`[data-insert="${t.id}"]`).forEach((el) => {
        el.classList.toggle('loaded', inserts > 0)
        el.textContent = `fx ${inserts}`
      })
    }
    const panelVol = $('in-track-vol')
    if (panelVol) {
      const t = state.tracks.find((x) => x.id === state.active)
      if (t) panelVol.value = String(t.volumeDb)
    }
  }
  ui.paintMixer = paintMixer

  /* One snapshot per gesture, not per pixel: the snapshot is taken in the
     capture phase — before studio's `input` writer has touched the model — and
     only lands on the stack if the control actually ended somewhere else. */
  const mix = { open: false, el: null, snap: null, before: '', what: '' }
  const MIX_CONTROLS = '[data-vol],[data-pan],[data-send],#in-track-vol'

  function beginMix(control) {
    if (mix.open || !control) return
    const what = control.dataset.send ? (control.dataset.send.endsWith('reverb') ? 'send A' : 'send B')
      : control.dataset.pan ? 'pan' : 'volume'
    mix.open = true
    mix.el = control
    mix.before = control.value
    mix.snap = mixSnapshot()
    mix.what = what
  }

  function endMix() {
    if (!mix.open) return
    const el = mix.el
    const changed = !!el && el.value !== mix.before
    const what = mix.what
    const snap = mix.snap
    const trackId = el?.dataset.vol || el?.dataset.pan || el?.dataset.send?.split(':')[0]
    const track = trackId ? state.tracks.find((t) => t.id === trackId) : state.tracks.find((t) => t.id === state.active)
    mix.open = false
    mix.el = null
    mix.snap = null
    mix.what = ''
    if (!changed) return
    pushUndo(snap)
    if (!track) return
    const read = what === 'volume' ? `${track.volumeDb.toFixed(1)} dB`
      : what === 'pan' ? panRead(track.pan)
        : `${Math.round((what === 'send A' ? track.sends?.reverb : track.sends?.delay) * 100)}%`
    log(`${what} ${read}: ${track.name}`)
  }

  function showGhostAt(left, top, note) {
    const c = kind() === 'voice' ? centsOf((note.midi - Math.round(note.midi)) * 100) : centsOf(note.cents)
    ghost.textContent = `${noteName(note.midi)} ${signed(c)}`
    ghost.hidden = false
    ghost.style.left = `${left + 12}px`
    ghost.style.top = `${top - 6}px`
    clearTimeout(ui.hideTimer)
    if (!ui.drag) ui.hideTimer = setTimeout(() => { ghost.hidden = true }, GHOST_MS)
  }

  // ---------------------------------------------------------------- drag
  function hitTest(box, clientX, clientY) {
    const b = rollBounds(state)
    const px = clientX - box.left
    const py = clientY - box.top
    const notes = activeNotes()
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const rc = rectOf(notes[i], box, b)
      if (px >= rc.x - HIT_PAD && px <= rc.x + rc.w + HIT_PAD && py >= rc.y - HIT_PAD && py <= rc.y + rc.h + HIT_PAD) return notes[i]
    }
    return null
  }

  const capture = (id) => { try { rollEl.setPointerCapture(id) } catch { /* capture is a nicety */ } }
  const release = (id) => { try { rollEl.releasePointerCapture(id) } catch { /* already gone */ } }

  function setStart(note, beat, k) {
    note.start = k === 'voice' ? beat * secPerBeat() : beat
  }

  function setMidi(note, midi, k) {
    if (k === 'roll') { note.midi = Math.round(midi); return }
    note.midi = midi
    note.cents = centsOf((midi - Math.round(midi)) * 100)
    note.hz = tune.midiToHz(midi)
  }

  function onDown(e) {
    if (!rollEl.isConnected || !e.isPrimary || e.button > 2) return
    if (e.target !== rollEl) return
    const box = rollEl.getBoundingClientRect()
    if (!box.width || !box.height) return
    // the gutter column belongs to studio's own rollPoint
    if (e.clientX - box.left < ROLL_GUTTER) return
    const k = kind()
    const hit = hitTest(box, e.clientX, e.clientY)

    if (e.button === 2) {
      if (!hit) return
      e.preventDefault()
      e.stopPropagation()
      pushUndo(snapshot())
      removeNotes([hit])
      redraw()
      log(`deleted ${noteName(hit.midi)}`)
      return
    }
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()

    if (hit) {
      const key = keyOf(hit, k)
      const wasSelected = ui.sel.has(key)
      if (e.shiftKey) {
        if (wasSelected) ui.sel.delete(key)
        else ui.sel.add(key)
        state.editSel = ui.sel
      } else if (!wasSelected) {
        setSel(new Set([key]))
      }
      ui.primary = key
      syncSelectedIndex()
      paint()
      renderList()
      if (e.shiftKey && !ui.sel.has(key)) return
      if (!ui.sel.size) return
      const p = rollPoint(state, box, e.clientX, e.clientY)
      const items = collect()
      // keep the grabbed note first so the ghost always reads the one under the pointer
      const grabbed = items.findIndex((n) => keyOf(n, k) === key)
      if (grabbed > 0) items.unshift(items.splice(grabbed, 1)[0])
      ui.drag = {
        pointerId: e.pointerId, kind: k, startX: e.clientX, startY: e.clientY,
        fromBeat: p.beat, fromMidi: p.midiF, moved: false, pushed: false,
        snapshot: snapshot(),
        items: items.map((n) => ({ note: n, startBeat: startBeatOf(n, k), durBeat: durBeatOf(n, k), midi: n.midi })),
      }
      capture(e.pointerId)
      return
    }

    // empty grid: marquee (a tap without movement adds one note, as before)
    if (!e.shiftKey) {
      setSel(new Set())
      ui.primary = null
      syncSelectedIndex()
      paint()
      renderList()
    }
    ui.marquee = {
      pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY,
      base: new Set(ui.sel), moved: false,
    }
    capture(e.pointerId)
  }

  function hitsInRect(box, from, to) {
    const b = rollBounds(state)
    const k = kind()
    const out = []
    for (const note of activeNotes()) {
      const rc = rectOf(note, box, b)
      if (rc.x + rc.w < from.x || rc.x > to.x || rc.y + rc.h < from.y || rc.y > to.y) continue
      out.push(keyOf(note, k))
    }
    return out
  }

  function onMove(e) {
    const drag = ui.drag
    if (drag) {
      if (e.pointerId !== drag.pointerId) return
      moveDrag(e, drag)
      return
    }
    const marquee = ui.marquee
    if (marquee) {
      if (e.pointerId !== marquee.pointerId) return
      marquee.x1 = e.clientX
      marquee.y1 = e.clientY
      const box = rollEl.getBoundingClientRect()
      if (Math.abs(marquee.x1 - marquee.x0) > TAP_PX || Math.abs(marquee.y1 - marquee.y0) > TAP_PX) marquee.moved = true
      if (!marquee.moved) { band.hidden = true; return }
      const from = { x: Math.min(marquee.x0, marquee.x1) - box.left, y: Math.min(marquee.y0, marquee.y1) - box.top }
      const to = { x: Math.max(marquee.x0, marquee.x1) - box.left, y: Math.max(marquee.y0, marquee.y1) - box.top }
      band.hidden = false
      band.style.left = `${from.x}px`
      band.style.top = `${from.y}px`
      band.style.width = `${to.x - from.x}px`
      band.style.height = `${to.y - from.y}px`
      // the notes under the band light up as it grows, not only on release
      const next = new Set(marquee.base)
      for (const key of hitsInRect(box, from, to)) next.add(key)
      setSel(next)
      ui.primary = [...next][0] ?? null
      paint()
      return
    }
    if (e.target === rollEl) rollEl.classList.toggle('edit-hot', !!hitTest(rollEl.getBoundingClientRect(), e.clientX, e.clientY))
  }

  function moveDrag(e, drag) {
    const box = rollEl.getBoundingClientRect()
    const b = rollBounds(state)
    const p = rollPoint(state, box, e.clientX, e.clientY)
    if (!drag.moved && Math.abs(e.clientX - drag.startX) <= TAP_PX && Math.abs(e.clientY - drag.startY) <= TAP_PX) return
    if (!drag.pushed) { pushUndo(drag.snapshot); drag.pushed = true }
    drag.moved = true

    const step = grid()
    let beatDelta = p.beat - drag.fromBeat
    if (!e.altKey) beatDelta = Math.round(beatDelta / step) * step
    let midiDelta = p.midiF - drag.fromMidi
    if (drag.kind === 'roll') midiDelta = Math.round(midiDelta)

    const midiLo = b.low - (drag.kind === 'voice' ? 0.49 : 0)
    const midiHi = b.low + b.rows - 1 + (drag.kind === 'voice' ? 0.49 : 0)
    for (const item of drag.items) {
      setStart(item.note, clamp(item.startBeat + beatDelta, 0, Math.max(0.05, b.beats - item.durBeat)), drag.kind)
      const raw = clamp(item.midi + midiDelta, midiLo, midiHi)
      setMidi(item.note, e.altKey ? raw : snapPitch(raw), drag.kind)
    }
    document.body.classList.add('edit-dragging')
    showGhostAt(e.clientX - box.left, e.clientY - box.top, drag.items[0].note)
    state.studio?.drawRoll?.()
    paint()
  }

  function onUp(e) {
    const drag = ui.drag
    if (drag) {
      if (e.pointerId !== drag.pointerId) return
      ui.drag = null
      release(e.pointerId)
      document.body.classList.remove('edit-dragging')
      ghost.hidden = true
      if (drag.moved) {
        const first = drag.items[0].note
        const c = centsOf(drag.kind === 'voice' ? (first.midi - Math.round(first.midi)) * 100 : first.cents)
        log(`${drag.items.length > 1 ? `${drag.items.length} notes` : noteName(first.midi)} ${drag.items.length > 1 ? 'moved' : `to ${noteName(first.midi)} ${signed(c)}`}`)
      }
      redraw()
      return
    }
    const marquee = ui.marquee
    if (!marquee || e.pointerId !== marquee.pointerId) return
    ui.marquee = null
    release(e.pointerId)
    band.hidden = true
    const box = rollEl.getBoundingClientRect()
    if (!marquee.moved) { addNoteAt(box, e.clientX, e.clientY); return }
    const from = { x: Math.min(marquee.x0, marquee.x1) - box.left, y: Math.min(marquee.y0, marquee.y1) - box.top }
    const to = { x: Math.max(marquee.x0, marquee.x1) - box.left, y: Math.max(marquee.y0, marquee.y1) - box.top }
    const next = new Set(marquee.base)
    for (const key of hitsInRect(box, from, to)) next.add(key)
    setSel(next)
    ui.primary = [...next][0] ?? null
    redraw()
    log(`selected ${next.size} note${next.size === 1 ? '' : 's'}`)
  }

  function onCancel(e) {
    if (ui.drag && e.pointerId === ui.drag.pointerId) {
      const drag = ui.drag
      ui.drag = null
      release(e.pointerId)
      document.body.classList.remove('edit-dragging')
      ghost.hidden = true
      if (drag.pushed) restore(drag.snapshot)
    }
    if (ui.marquee && e.pointerId === ui.marquee.pointerId) {
      ui.marquee = null
      band.hidden = true
      release(e.pointerId)
    }
  }

  // ---------------------------------------------------------------- mutations
  function removeNotes(list) {
    const k = kind()
    const doomed = new Set(list)
    if (k === 'roll') {
      const r = state.rolls.get(state.active)
      for (const note of list) roll.deleteNote(r, note.id)
      return
    }
    state.notes = state.notes.filter((n) => !doomed.has(n))
  }

  function addNoteAt(box, clientX, clientY) {
    const b = rollBounds(state)
    const p = rollPoint(state, box, clientX, clientY)
    const k = kind()
    const step = grid()
    const startBeat = clamp(Math.round(p.beat / step) * step, 0, Math.max(0.05, b.beats - 0.5))
    const midi = clamp(Math.round(snapPitch(p.midi)), b.low, b.low + b.rows - 1)
    pushUndo(snapshot())
    let added
    if (k === 'roll') {
      added = roll.addNote(state.rolls.get(state.active), { midi, start: startBeat, dur: 0.5 })
    } else {
      added = { start: startBeat * secPerBeat(), dur: 0.5 * secPerBeat(), midi, cents: 0, hz: tune.midiToHz(midi), origMidi: midi }
      state.notes.push(added)
      state.notes.sort((x, y) => x.start - y.start)
    }
    setSel(new Set([keyOf(added, k)]))
    ui.primary = keyOf(added, k)
    added.formant = 0
    added.vibrato = 0
    redraw()
    log(`added ${noteName(midi)} at beat ${startBeat.toFixed(2)}`)
  }

  function nudgeCents(delta) {
    const notes = collect()
    if (!notes.length) return
    const k = kind()
    pushUndo(snapshot())
    for (const note of notes) {
      if (k === 'voice') {
        const midi = clamp(note.midi + delta / 100, 0, 127)
        setMidi(note, midi, k)
      } else {
        note.cents = clamp(centsOf(note.cents) + delta, -99, 99)
      }
    }
    const first = notes[0]
    const box = rollEl.getBoundingClientRect()
    if (box.width) {
      const rc = rectOf(first, box, rollBounds(state))
      showGhostAt(rc.x + rc.w / 2, rc.y, first)
    }
    renderList()
    paint()
    const c = k === 'voice' ? centsOf((first.midi - Math.round(first.midi)) * 100) : centsOf(first.cents)
    log(`cents ${signed(delta)}: ${noteName(first.midi)} ${signed(c)}`)
  }

  function deleteSelection() {
    const notes = collect()
    if (!notes.length) return
    pushUndo(snapshot())
    removeNotes(notes)
    setSel(new Set())
    ui.primary = null
    redraw()
    log(`deleted ${notes.length} note${notes.length === 1 ? '' : 's'}`)
  }

  function clearSelection() {
    ghost.hidden = true
    if (!ui.sel.size) return
    setSel(new Set())
    ui.primary = null
    syncSelectedIndex()
    redraw()
  }

  // ---------------------------------------------------------------- keyboard
  function typing(el) {
    if (!el) return false
    const tag = String(el.tagName || '').toUpperCase()
    // a range or checkbox keeps focus after a gesture; Ctrl+Z must still work
    if (tag === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes(el.type)
    return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true
  }

  function onKey(e) {
    if (typing(e.target)) return
    const cmd = e.metaKey || e.ctrlKey
    if (cmd && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.shiftKey) redo()
      else undo()
      return
    }
    if (e.key === 'Escape') {
      if (!ui.sel.size && !ui.marquee && !ui.drag) return
      e.preventDefault()
      e.stopPropagation()
      clearSelection()
      return
    }
    if (e.key === '[' || e.key === ']') {
      if (!collect().length) return
      e.preventDefault()
      e.stopPropagation()
      nudgeFx('formant', e.key === '[' ? -1 : 1)
      return
    }
    if (e.key === ';' || e.key === "'" || e.key === '"') {
      if (!collect().length) return
      e.preventDefault()
      e.stopPropagation()
      nudgeFx('vibrato', e.key === ';' ? -5 : 5)
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (!collect().length) return
      e.preventDefault()
      e.stopPropagation()
      nudgeCents(e.key === 'ArrowLeft' ? (e.shiftKey ? -1 : -5) : (e.shiftKey ? 1 : 5))
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!collect().length) return
      e.preventDefault()
      e.stopPropagation()
      deleteSelection()
    }
  }

  // ---------------------------------------------------------------- wiring
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('pointercancel', onCancel, true)
  document.addEventListener('keydown', onKey, true)

  // the note list is the same selection: a row click selects that note, its
  // Del button snapshots first so Ctrl+Z brings the note back
  document.addEventListener('click', (e) => {
    const row = e.target.closest?.('#note-list .note')
    if (!row) return
    const index = [...row.parentElement.children].indexOf(row)
    const note = state.notes[index]
    if (e.target.tagName === 'BUTTON') {
      pushUndo(snapshot())
      return
    }
    if (!note) return
    setSel(new Set([keyOf(note, 'voice')]))
    ui.primary = keyOf(note, 'voice')
    state.selected = index
    paint()
  }, true)

  $('btn-undo')?.addEventListener('click', () => undo())
  $('btn-redo')?.addEventListener('click', () => redo())

  // mixer gestures: snapshot in capture (pre-write), commit on release
  document.addEventListener('pointerdown', (e) => {
    const control = e.target.closest?.(MIX_CONTROLS)
    if (!control) return
    // a release lost outside the window must not wedge the next gesture
    if (mix.open && mix.el !== control) endMix()
    beginMix(control)
  }, true)
  document.addEventListener('input', (e) => {
    // keyboard arrows and programmatic writes have no pointerdown to lean on
    if (!mix.open) beginMix(e.target.closest?.(MIX_CONTROLS))
  }, true)
  document.addEventListener('change', (e) => {
    if (mix.open && e.target === mix.el) endMix()
  }, true)
  for (const ev of ['pointerup', 'pointercancel']) {
    document.addEventListener(ev, () => endMix(), true)
  }
  window.addEventListener('blur', () => endMix())

  // discrete mixer steps: one entry each, taken before studio's own handlers run
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-mute], [data-solo], #btn-fx-up, #btn-fx-down, #btn-fx-remove, [data-add], [data-bypass]')
    if (!el || el.disabled) return
    pushUndo(snapshot('mixer'))
  }, true)
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest?.('[data-pan]')) pushUndo(snapshot('mixer'))
  }, true)

  watchButtons()

  // character sliders: one undo entry per gesture, not per pixel
  $('in-note-formant').addEventListener('pointerdown', beginFxEdit)
  $('in-note-vibrato').addEventListener('pointerdown', beginFxEdit)
  $('in-note-formant').addEventListener('input', (e) => { beginFxEdit(); setFx('formant', Number(e.target.value)) })
  $('in-note-vibrato').addEventListener('input', (e) => { beginFxEdit(); setFx('vibrato', Number(e.target.value)) })
  for (const id of ['in-note-formant', 'in-note-vibrato']) {
    $(id).addEventListener('change', () => { gesture.open = false })
  }
  document.addEventListener('pointerup', () => { gesture.open = false }, true)

  // ---------------------------------------------------------------- persistence
  // persist.js rebuilds roll notes field by field, so formant and vibrato ride
  // the saved JSON yet have to be re-attached after a load. Nothing in that file
  // changes: the stored payload is read back here and matched onto fresh notes.
  const SLOT = 'apollo.project.v1'
  const fxKey = (n) => `${Math.round(n.midi)}|${(Number(n.start) || 0).toFixed(3)}`

  function graftFx(data) {
    if (!data || typeof data !== 'object') return
    const take = new Map((Array.isArray(data.notes) ? data.notes : []).map((n) => [fxKey(n), n]))
    state.notes.forEach((n) => {
      const src = take.get(fxKey(n))
      if (!src) return
      if (src.formant) n.formant = formantOf(src)
      if (src.vibrato) n.vibrato = vibratoOf(src)
    })
    for (const [id, r] of data.rolls || []) {
      const target = state.rolls.get(id)
      if (!target || !Array.isArray(r?.notes)) continue
      const src = new Map(r.notes.map((n) => [fxKey(n), n]))
      target.notes.forEach((n) => {
        const from = src.get(fxKey(n))
        if (!from) return
        if (from.formant) n.formant = formantOf(from)
        if (from.vibrato) n.vibrato = vibratoOf(from)
      })
    }
    // persist leaves the note list alone on a restore (the take is not stored),
    // so only repaint the roll and the overlay instead of re-rendering the rows
    paint()
    state.studio?.drawRoll?.()
  }

  const readStored = () => {
    try { return JSON.parse(localStorage.getItem(SLOT) || 'null') } catch { return null }
  }

  function wrapLoad() {
    const api = state.persist
    if (!api || api.fxGraft) return
    api.fxGraft = true
    const openFile = api.openFile
    api.openFile = async (file) => {
      const out = await openFile?.(file)
      try { graftFx(JSON.parse(await file.text())) } catch { /* not our file */ }
      return out
    }
  }
  // the menu's own "Open saved project" item calls persist's private restore, so
  // catch the click and graft once its synchronous apply has landed
  document.addEventListener('click', (e) => {
    const item = e.target.closest?.('#menu-app [role="menuitem"]')
    if (!item || !/open saved project/i.test(item.textContent)) return
    setTimeout(() => graftFx(readStored()), 0)
  }, true)
  // boot restore has already run by the time this fires
  setTimeout(() => { wrapLoad(); graftFx(readStored()) }, 0)

  window.addEventListener('resize', () => paint())
  if (state.selected != null) {
    const note = state.notes[state.selected]
    if (note) { setSel(new Set([keyOf(note, 'voice')])); ui.primary = keyOf(note, 'voice') }
  }
  paint()
  log('editor: drag to move, arrows nudge cents, marquee to select, ⌘Z undoes')
}
