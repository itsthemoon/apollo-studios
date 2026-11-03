// js/persist.js — project persistence (one local slot + a downloaded
// `.apollo.json`), the 30 s autosave, the restored-project toast, and the header
// chrome the shell only sketched: a notification list seeded from the session
// log, the account menu, the editable project tag and the Apollo Pro sheet.
//
// install() is called once from app.js after the studio, panels, timeline and
// editor attach: a restore runs against a live model and has to be able to push
// the editor's undo stack.
//
// Stored shape (format `apollo.project`, schema 1) is plain JSON — no audio, so
// a take has to be re-recorded after a reload, but every editable thing
// survives: tracks, clips, rolls, notes, fx chains, tempo, key, mastering
// state, versions and the tag. Everything goes in one localStorage slot; a
// project too big for it falls back to the download path with a log line rather
// than a crash.
//
// Every read is validated with guard clauses before a single field touches the
// live state, so a hand-edited file can only fail loudly, never half-apply.
import * as tracks from './tracks.js'
import * as fx from './fx.js'
import * as roll from './roll.js'
import * as drums from './drums.js'
import * as mastering2 from './mastering2.js'
import * as versions from './versions.js'
import * as tune from './tune.js'

const $ = (id) => document.getElementById(id)

const SLOT = 'apollo.project.v1'
const FORMAT = 'apollo.project'
const SCHEMA = 1
const MAX_STORE_BYTES = 4_500_000
const TAG_MAX = 24
const NOTIFICATIONS = 6
const AUTOSAVE_MS = 30_000
const MAX_UNDO = 50

/* Take audio is far too big for the localStorage slot (one 20 s stereo-ish
   take is megabytes), so the samples live in IndexedDB beside the JSON. A
   record is one track's buffer under a project key; a buffer over the take
   limit is left out rather than filling the quota, and only the newest
   KEEP_PROJECTS projects keep audio. */
const TAKE_DB = 'apollo.takes'
const TAKE_STORE = 'takes'
const TAKE_DB_VERSION = 1
const MAX_TAKE_BYTES = 40 * 1024 * 1024
const KEEP_PROJECTS = 5

const STYLES = `
.ptag { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); margin-left: 6px;
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px;
  border: 1px solid var(--line, #24343a); border-radius: 999px; color: var(--mute, #9fb0b5);
  background: rgba(255, 255, 255, 0.03); font: 10.5px/1 var(--mono, ui-monospace, Menlo, monospace);
  letter-spacing: 0.04em; text-transform: lowercase; outline: none; }
.ptag::before { content: '#'; opacity: 0.55; margin-right: 2px; }
.ptag:focus { border-color: var(--cyan, #00c6d1); color: #d6f6f8; background: #04252a; }
.ptag:empty::after { content: 'tag'; opacity: 0.4; }
.apollo-toast { position: fixed; left: 50%; bottom: 64px; z-index: 90; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--line, #24343a); background: rgba(6, 12, 14, 0.96); color: #dcedf0;
  font: 12px/1.3 var(--sans, system-ui, sans-serif); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45); }
.apollo-toast[data-tone="good"] { border-color: rgba(0, 198, 209, 0.7); }
.apollo-toast[data-tone="bad"] { border-color: rgba(255, 120, 120, 0.7); }
.apollo-toast.out { opacity: 0; transition: opacity 220ms ease; }
#menu-notifications { width: 300px; }
#menu-notifications .nhead { padding: 7px 10px 5px; font: 10px/1 var(--mono, ui-monospace, monospace);
  letter-spacing: 0.12em; text-transform: uppercase; color: var(--dim, #6c7c81); }
#menu-notifications .ntext { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 226px; }
#menu-notifications button { font-size: 11.5px; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 10px; }
.split section { border: 1px solid var(--line, #24343a); border-radius: 8px; padding: 9px 11px; }
.split section.pro { border-color: rgba(0, 198, 209, 0.55); background: rgba(0, 198, 209, 0.06); }
.split h3 { margin: 0 0 5px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim, #6c7c81); }
.split ul { margin: 0; padding-left: 15px; font-size: 12px; line-height: 1.65; color: var(--mute, #9fb0b5); }
.split .num { color: #dcedf0; font-variant-numeric: tabular-nums; }
`

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (v, fallback, lo, hi) => (Number.isFinite(v) ? clamp(v, lo, hi) : fallback)
const clone = (v) => JSON.parse(JSON.stringify(v))
const slug = (s) => String(s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'

// The scale table the roll's "Lock to scale" needs; the editor keeps the same
// one privately, and it is two lines, so it is mirrored rather than exported.
const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9], pentatonicminor: [0, 3, 5, 7, 10],
}

export function install({ state, log } = {}) {
  if (!state || state.persist) return
  const savedEl = $('saved-at')
  const logEl = $('log')
  if (!savedEl) return

  if (!document.getElementById('persist-styles')) {
    const style = document.createElement('style')
    style.id = 'persist-styles'
    style.textContent = STYLES
    document.head.append(style)
  }

  const ui = { dirty: false, restoring: false, savedAt: 0, toastTimer: 0 }
  state.persist = {
    ui, save: () => save(), exportFile: () => exportFile(), openStored: () => openStored(),
    openFile: (file) => openFile(file),
    quantize: () => quantize(), lockScale: () => lockScale(), serialise: () => serialise(),
  }
  state.tag = typeof state.tag === 'string' ? state.tag : 'skin'
  state.lyrics = Array.isArray(state.lyrics) ? state.lyrics : []
  state.projectId = typeof state.projectId === 'string' && state.projectId ? state.projectId : newProjectId()
  state.takes = state.takes instanceof Map ? state.takes : new Map()

  const bpm = () => Number($('in-bpm')?.value) || 96
  const secPerBeat = () => 60 / bpm()
  const gridBeats = () => {
    const v = Number($('in-quant')?.value)
    return Number.isFinite(v) && v > 0 ? v : 0.25
  }
  const activeRoll = () => state.rolls?.get(state.active) || null

  // ---------------------------------------------------------------- toast
  function toast(text, tone = 'info', ms = 3200) {
    document.querySelectorAll('.apollo-toast').forEach((n) => n.remove())
    const el = document.createElement('div')
    el.className = 'apollo-toast'
    el.dataset.tone = tone
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.innerHTML = `<span data-icon="${tone === 'bad' ? 'close' : tone === 'good' ? 'save' : 'sparkle'}" aria-hidden="true"></span><span>${esc(text)}</span>`
    document.body.append(el)
    clearTimeout(ui.toastTimer)
    ui.toastTimer = setTimeout(() => {
      el.classList.add('out')
      setTimeout(() => el.remove(), 260)
    }, ms)
  }

  function stamp(at = new Date()) {
    const when = at instanceof Date && Number.isFinite(at.getTime()) ? at : new Date()
    savedEl.textContent = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    savedEl.title = when.toLocaleString()
    ui.savedAt = when.getTime()
  }

  // ---------------------------------------------------------------- shape
  function normaliseClip(raw) {
    const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    return {
      startBeat: num(c.startBeat, 0, 0, 4096),
      lengthBeats: num(c.lengthBeats, 4, 0.25, 4096),
      gain: num(c.gain, 1, 0, 4),
      fadeIn: num(c.fadeIn, 0, 0, 1),
      fadeOut: num(c.fadeOut, 0, 0, 1),
      stretch: num(c.stretch, 1, 0.25, 4),
      reverse: c.reverse === true,
      name: typeof c.name === 'string' ? c.name : '',
    }
  }

  function normalisePoints(list, lo, hi) {
    if (!Array.isArray(list)) return []
    return list
      .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.value))
      .map((p) => ({ t: clamp(p.t, 0, 1), value: clamp(p.value, lo, hi) }))
      .sort((a, b) => a.t - b.t)
  }

  // Rebuild the chain through the module's own mutators so defaults, ids and
  // the limiter-last invariant all come from fx.js instead of the file.
  function normaliseChain(raw, isMember) {
    const chain = fx.createChain({ isMember })
    const list = Array.isArray(raw?.effects) ? raw.effects : []
    for (const effect of list) {
      if (!effect || typeof effect.slug !== 'string') continue
      let made
      try { made = fx.addEffect(chain, effect.slug) } catch { continue }
      if (effect.bypass) fx.setBypass(chain, made.id, true)
      const params = effect.params && typeof effect.params === 'object' ? effect.params : {}
      for (const [key, value] of Object.entries(params)) {
        if (!Number.isFinite(value)) continue
        try { fx.setParam(chain, made.id, key, value) } catch { /* not a param of this effect */ }
      }
    }
    fx.ensureLimiterLast(chain)
    return chain
  }

  function normaliseTrack(raw, index, isMember) {
    const t = tracks.createTrack({
      id: typeof raw.id === 'string' && raw.id ? raw.id : undefined,
      type: typeof raw.type === 'string' ? raw.type : 'voice',
      name: typeof raw.name === 'string' ? raw.name : undefined,
      index,
    })
    t.volumeDb = num(raw.volumeDb, 0, -60, 6)
    t.pan = num(raw.pan, 0, -1, 1)
    t.mute = raw.mute === true
    t.solo = raw.solo === true
    t.armed = raw.armed === true
    t.sends = { reverb: num(raw.sends?.reverb, 0, 0, 1), delay: num(raw.sends?.delay, 0, 0, 1) }
    t.automation = {
      volume: normalisePoints(raw.automation?.volume, -60, 6),
      pan: normalisePoints(raw.automation?.pan, -1, 1),
    }
    t.clip = normaliseClip(raw.clip)
    t.clips = Array.isArray(raw.clips) ? raw.clips.map(normaliseClip) : []
    t.chain = normaliseChain(raw.chain, isMember)
    return t
  }

  function normaliseRoll(raw) {
    if (!raw || typeof raw !== 'object') return null
    const r = roll.createRoll(
      num(raw.lengthBeats, 32, roll.MIN_DURATION_BEATS, 4096),
      num(raw.octaves, 4, 1, 10),
      num(raw.lowMidi, 48, 0, 127),
    )
    const notes = Array.isArray(raw.notes) ? raw.notes : []
    for (const n of notes) {
      if (!n || !Number.isFinite(n.midi)) continue
      try {
        const added = roll.addNote(r, { midi: n.midi, start: num(n.start, 0, 0, 4096), dur: num(n.dur, 0.5, 0, 4096), velocity: num(n.velocity, 100, 1, 127) })
        if (Number.isFinite(n.cents)) added.cents = num(n.cents, 0, -99, 99)
      } catch { /* off-grid note */ }
    }
    return r
  }

  function normalisePattern(raw) {
    const p = drums.createPattern()
    if (!raw || typeof raw !== 'object') return p
    if (Array.isArray(raw.hits)) {
      raw.hits.forEach((row, lane) => {
        if (!Array.isArray(row) || !p.hits[lane]) return
        row.forEach((on, i) => { if (i < p.hits[lane].length) p.hits[lane][i] = on ? 1 : 0 })
      })
    }
    if (Array.isArray(raw.gains)) raw.gains.forEach((g, i) => { if (Number.isFinite(g) && i < p.gains.length) p.gains[i] = clamp(g, 0, 2) })
    if (Number.isFinite(raw.swing)) p.swing = clamp(raw.swing, 0, 1)
    return p
  }

  // ---------------------------------------------------------------- serialise
  function serialise() {
    return {
      format: FORMAT,
      schema: SCHEMA,
      at: new Date().toISOString(),
      projectId: state.projectId,
      name: $('proj-name')?.value || 'untitled',
      tag: state.tag,
      tempo: bpm(),
      bpm: bpm(),
      key: { root: num(Number($('in-root')?.value), 0, 0, 11), scale: $('in-mode')?.value || 'chromatic' },
      quantize: $('in-quantize')?.checked === true,
      snapBeats: num(state.snapBeats, 0, 0, 4),
      timesig: String(state.studio?.state?.timesig || '4/4'),
      tracks: clone(state.tracks),
      rolls: [...state.rolls].map(([id, r]) => [id, r ? roll.cloneRoll(r) : null]),
      patterns: [...state.patterns].map(([id, p]) => [id, clone(p)]),
      notes: clone(state.notes),
      // selection travels with the project: the clip keys are "trackId/index",
      // the note keys the editor's own. Both are filtered on load.
      sel: {
        clips: [...(state.tlSel || [])].map(String),
        notes: [...(state.editSel || state.edit?.sel || [])].map(String),
        primary: typeof state.edit?.primary === 'string' ? state.edit.primary : null,
      },
      lyrics: clone(state.lyrics),
      chat: clone(state.chat || []),
      master: { ...state.masterState },
      bands: Array.isArray(state.bands) ? clone(state.bands) : [],
      versions: clone(state.versions || []),
      member: state.member === true,
    }
  }

  // ---------------------------------------------------------------- validate
  function validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('project: not an object')
    if (data.format !== FORMAT) throw new Error('project: not an Apollo project file')
    if (data.schema !== SCHEMA) throw new Error(`project: schema ${String(data.schema)} is not ${SCHEMA}`)
    if (!Array.isArray(data.tracks) || !data.tracks.length) throw new Error('project: no tracks')
    data.tracks.forEach((t, i) => {
      if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error(`project: track ${i + 1} is not an object`)
      if (typeof t.id !== 'string' || !t.id) throw new Error(`project: track ${i + 1} has no id`)
    })
    if (!Array.isArray(data.notes)) throw new Error('project: notes missing')
    data.notes.forEach((n, i) => {
      if (!n || typeof n !== 'object') throw new Error(`project: note ${i + 1} is not an object`)
      if (!Number.isFinite(n.start) || n.start < 0) throw new Error(`project: note ${i + 1} has no start`)
      if (!Number.isFinite(n.midi)) throw new Error(`project: note ${i + 1} has no pitch`)
    })
    if (data.rolls !== undefined) {
      if (!Array.isArray(data.rolls)) throw new Error('project: rolls must be a list')
      for (const entry of data.rolls) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string') throw new Error('project: bad roll entry')
        const r = entry[1]
        if (r && (!r || !Array.isArray(r.notes))) throw new Error(`project: roll ${entry[0]} has no notes`)
      }
    }
    if (data.versions !== undefined && !Array.isArray(data.versions)) throw new Error('project: versions must be a list')
    if (data.bands !== undefined && !Array.isArray(data.bands)) throw new Error('project: bands must be a list')
    if (data.sel !== undefined && (!data.sel || typeof data.sel !== 'object' || Array.isArray(data.sel))) throw new Error('project: sel must be an object')
    if (data.tempo !== undefined && !Number.isFinite(Number(data.tempo))) throw new Error('project: bad tempo')
    return data
  }

  // ---------------------------------------------------------------- apply
  function apply(data) {
    validate(data)
    ui.restoring = true
    try {
      state.member = data.member === true
      const memberBox = $('in-member')
      if (memberBox) memberBox.checked = state.member

      // audio lives in IndexedDB keyed by project; a swapped-in project must
      // not inherit the old take while its own buffers load
      state.projectId = typeof data.projectId === 'string' && /^[\w-]{1,64}$/.test(data.projectId) ? data.projectId : newProjectId()
      state.takes = new Map()
      state.take = null
      state.takeTrack = null
      state.tlSel?.clear?.()

      state.tracks = data.tracks.map((t, i) => normaliseTrack(t, i, state.member))
      state.active = state.tracks[0].id

      state.rolls = new Map()
      for (const [id, r] of data.rolls || []) {
        const made = normaliseRoll(r)
        if (made) state.rolls.set(id, made)
        else state.rolls.set(id, null)
      }
      state.patterns = new Map()
      for (const [id, p] of data.patterns || []) state.patterns.set(id, normalisePattern(p))
      state.undoRoll = []

      state.notes = data.notes.map((n) => ({
        ...n,
        start: num(n.start, 0, 0, 1e6),
        dur: num(n.dur, 0.2, 0.02, 1e6),
        midi: num(n.midi, 60, 0, 127),
      })).sort((a, b) => a.start - b.start)

      state.lyrics = Array.isArray(data.lyrics) ? clone(data.lyrics) : []
      state.chat = Array.isArray(data.chat) ? clone(data.chat) : []
      state.versions = (Array.isArray(data.versions) ? data.versions : [])
        .filter((v) => v && typeof v === 'object' && v.snapshot)
        .map((v) => ({ id: String(v.id || versions.createVersion({}).id), label: String(v.label || 'Untitled version').slice(0, 80), at: typeof v.at === 'string' ? v.at : new Date().toISOString(), rev: Number(v.rev) || 0, snapshot: clone(v.snapshot) }))
      state.versions = versions.prune(state.versions, state.member ? 50 : 20)

      state.masterState = mastering2.clampState(data.master || {})
      const bands = Array.isArray(data.bands) ? data.bands : []
      if (bands.length === state.bands.length) {
        state.bands = bands.map((b, i) => ({
          kind: typeof b?.kind === 'string' ? b.kind : state.bands[i].kind,
          freq: num(b?.freq, state.bands[i].freq, 20, 20000),
          q: num(b?.q, state.bands[i].q, 0.1, 10),
          gainDb: num(b?.gainDb, 0, -12, 12),
        }))
      }

      if ($('proj-name')) $('proj-name').value = String(data.name || 'untitled').slice(0, 80)
      state.tag = String(data.tag || 'skin').slice(0, TAG_MAX)
      if ($('in-bpm')) $('in-bpm').value = String(num(Number(data.tempo), 96, 40, 220))
      if (data.timesig && state.studio?.state) {
        const ts = document.getElementById('in-timesig')
        const sig = String(data.timesig)
        if (ts && [...ts.options].some((o) => o.value === sig)) {
          ts.value = sig
          setTimeout(() => ts.dispatchEvent(new Event('change', { bubbles: true })), 0)
        }
      }
      if ($('in-root') && data.key) $('in-root').value = String(num(Number(data.key.root), 0, 0, 11))
      if ($('in-mode') && data.key?.scale) {
        const option = [...$('in-scale').options].find((o) => o.value === data.key.scale)
        if (option) $('in-scale').value = data.key.scale
      }
      if ($('in-quantize')) $('in-quantize').checked = data.quantize === true
      state.snapBeats = num(data.snapBeats, 1, 0, 4)
      const gridOption = [...($('in-grid')?.options || [])].find((o) => Math.abs(Number(o.value) - state.snapBeats) < 1e-6)
      if (gridOption) $('in-grid').value = gridOption.value
      else state.snapBeats = Number($('in-grid')?.value) || 1
      if ($('in-lyrics')) {
        $('in-lyrics').value = state.lyrics.map((l) => l.text).join('\n')
        if ($('lyrics-count')) $('lyrics-count').textContent = `${state.lyrics.length} lines`
      }

      paintTag()
      state.selected = null
      state.edit?.sel?.clear?.()
      if (state.edit) state.edit.primary = null
      // a restored note keeps the `_eid` it was saved with, so the editor's
      // counter has to start past the highest one or new notes collide
      const topEid = state.notes.reduce((max, n) => {
        const m = /^v(\d+)$/.exec(String(n._eid || ''))
        return m ? Math.max(max, Number(m[1])) : max
      }, 0)
      if (state.edit && topEid > state.edit.eid) state.edit.eid = topEid
      state.studio?.renderAll?.()
      applySelection(data.sel)
      state.studio?.drawRoll?.()
      // notes belong to a take that is not in storage: keep the list empty so
      // nothing pretends to be playable, and say where the notes went
      $('note-count').textContent = state.notes.length ? `${state.notes.length} take notes · load the take to play` : 'no notes'
      $('btn-play').disabled = true
      paintMaster()
      paintAp()
      if (Number.isFinite(Date.parse(data.at))) stamp(new Date(data.at))
      ui.dirty = false
      state.active = state.tracks[0].id
      void restoreTakes(state.projectId)
    } finally {
      ui.restoring = false
    }
  }

  // The studio keeps its paint helpers private; the pickers are the contract.
  function paintMaster() {
    const s = state.masterState
    if (!s) return
    document.querySelectorAll('[data-mpreset]').forEach((b) => b.classList.toggle('on', b.dataset.mpreset === s.preset))
    if ($('in-intensity')) $('in-intensity').value = String(Math.round(s.intensity * 100))
    if ($('out-intensity')) $('out-intensity').textContent = mastering2.intensityLabel(s.intensity)
    for (const band of ['low', 'mid', 'high']) {
      if ($(`in-${band}`)) $(`in-${band}`).value = String(s[band])
      if ($(`out-${band}`)) $(`out-${band}`).textContent = `${s[band].toFixed(1)} dB`
    }
    if ($('in-eq-bypass')) $('in-eq-bypass').checked = s.eqBypass
    if ($('master-preset-label')) $('master-preset-label').textContent = mastering2.presetBySlug(s.preset).name
  }

  function paintAp() {
    const s = state.apState
    if (!s) return
    document.querySelectorAll('[data-ap]').forEach((b) => {
      const on = b.dataset.ap === s.preset
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    if ($('in-ap-strength')) $('in-ap-strength').value = String(Math.round(s.strength * 100))
    if ($('out-ap-strength')) $('out-ap-strength').textContent = `${Math.round(s.strength * 100)} %`
  }

  // ---------------------------------------------------------------- selection
  const regionAt = (track, index) => {
    if (!track) return null
    if (index === 0) return track.clip || null
    return Array.isArray(track.clips) ? track.clips[index - 1] || null : null
  }

  function paintClips(live) {
    document.querySelectorAll('.clip').forEach((node) => {
      const key = `${node.dataset.clip}/${Number(node.dataset.regionIndex || 0)}`
      const on = live.has(key)
      node.classList.toggle('sel', on)
      node.classList.toggle('tl-selected-source', on)
      if (on) node.setAttribute('aria-selected', 'true')
      else node.removeAttribute('aria-selected')
    })
  }

  /* A stored selection is a set of keys, and a key only survives if its track,
     region or note is still in the restored project. The live Sets are mutated
     in place so the timeline and the editor keep pointing at the same ones. */
  function applySelection(sel) {
    const clips = Array.isArray(sel?.clips) ? sel.clips.map(String) : []
    const notes = Array.isArray(sel?.notes) ? sel.notes.map(String) : []
    const live = state.tlSel
    if (live?.clear) {
      live.clear()
      for (const key of clips) {
        const at = key.lastIndexOf('/')
        if (at < 1) continue
        const track = state.tracks.find((t) => t.id === key.slice(0, at))
        const index = Number(key.slice(at + 1)) || 0
        if (regionAt(track, index)) live.add(`${track.id}/${index}`)
      }
      paintClips(live)
    }

    const edit = state.edit
    if (!edit?.sel) return
    edit.sel.clear()
    const activeRoll = state.rolls.get(state.active)
    const pool = new Set(activeRoll
      ? activeRoll.notes.map((n) => `r:${n.id}`)
      : state.notes.filter((n) => n._eid).map((n) => `v:${n._eid}`))
    for (const key of notes) if (pool.has(key)) edit.sel.add(key)
    const primary = typeof sel?.primary === 'string' && pool.has(sel.primary) ? sel.primary : [...edit.sel][0] ?? null
    edit.primary = primary
    state.editSel = edit.sel
    state.selected = primary?.startsWith('v:') ? state.notes.findIndex((n) => `v:${n._eid}` === primary) : null
    if (state.selected === -1) state.selected = null
    // the note list and the roll overlay both draw from the live selection
    if (window.VS?.setState) window.VS.setState({ notes: state.notes })
    edit.paint?.()
  }

  // ---------------------------------------------------------------- take audio
  // The JSON in the slot carries the arrangement; the samples go to IndexedDB
  // under this project's key, one record per track. Everything here is
  // best-effort: a browser that refuses IDB still saves the editable project.
  let dbPromise = null

  function openDb() {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return }
      const req = indexedDB.open(TAKE_DB, TAKE_DB_VERSION)
      // another tab holding a blocked delete/upgrade can park open() forever
      const timer = setTimeout(() => reject(new Error('indexedDB open timed out')), 4000)
      req.onupgradeneeded = () => {
        const d = req.result
        const store = d.objectStoreNames.contains(TAKE_STORE)
          ? req.transaction.objectStore(TAKE_STORE)
          : d.createObjectStore(TAKE_STORE, { keyPath: 'id' })
        if (!store.indexNames.contains('project')) store.createIndex('project', 'project')
      }
      req.onsuccess = () => { clearTimeout(timer); resolve(req.result) }
      req.onerror = () => { clearTimeout(timer); reject(req.error || new Error('indexedDB open failed')) }
      req.onblocked = () => { /* wait for the timeout, the request is still queued */ }
    }).catch((err) => { dbPromise = null; throw err })
    return dbPromise
  }

  async function inStore(mode, work) {
    const d = await openDb()
    return new Promise((resolve, reject) => {
      const t = d.transaction(TAKE_STORE, mode)
      const store = t.objectStore(TAKE_STORE)
      let out
      try { out = work(store) } catch (err) { reject(err); return }
      t.oncomplete = () => resolve(out)
      t.onerror = () => reject(t.error || new Error('take transaction failed'))
      t.onabort = () => reject(t.error || new Error('take transaction aborted'))
    })
  }

  function newProjectId() {
    const raw = globalThis.crypto?.randomUUID?.() || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    return raw
  }

  // One record per track that actually carries a buffer. `state.takes` is the
  // map app.js keeps; the single `state.take` is the fallback for a build that
  // has not moved over.
  function takeEntries() {
    const out = []
    if (state.takes instanceof Map && state.takes.size) {
      for (const [trackId, entry] of state.takes) {
        if (trackId && entry?.data?.length) out.push({ trackId, data: entry.data, rate: entry.rate })
      }
    } else if (state.take?.length) {
      const trackId = state.takeTrack || state.tracks?.[0]?.id
      if (trackId) out.push({ trackId, data: state.take, rate: state.sampleRate })
    }
    return out.filter((e) => state.tracks?.some((t) => t.id === e.trackId))
  }

  // Keep the newest KEEP_PROJECTS projects, never the one being written.
  async function pruneTakes(keepKey) {
    let rows
    try {
      rows = await inStore('readonly', (store) => {
        const found = []
        const req = store.openCursor()
        req.onsuccess = () => {
          const cursor = req.result
          if (!cursor) return
          found.push({ key: cursor.primaryKey, project: cursor.value?.project, at: Number(cursor.value?.at) || 0 })
          cursor.continue()
        }
        return found
      })
    } catch { return 0 }
    const newest = new Map()
    for (const row of rows) {
      if (!row.project) continue
      newest.set(row.project, Math.max(newest.get(row.project) || 0, row.at))
    }
    const doomed = [...newest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(KEEP_PROJECTS)
      .map(([key]) => key)
      .filter((key) => key !== keepKey)
    if (!doomed.length) return 0
    try {
      await inStore('readwrite', (store) => {
        for (const row of rows) if (doomed.includes(row.project)) store.delete(row.key)
      })
    } catch { return 0 }
    return doomed.length
  }

  async function saveTakes(projectKey) {
    if (!projectKey) return { saved: 0, bytes: 0, skipped: 0 }
    const entries = takeEntries()
    if (!entries.length) return { saved: 0, bytes: 0, skipped: 0 }
    const kept = entries.filter((e) => e.data.byteLength <= MAX_TAKE_BYTES)
    const skipped = entries.length - kept.length
    for (const entry of entries) {
      if (entry.data.byteLength > MAX_TAKE_BYTES) {
        log(`take on ${trackName(entry.trackId)} is ${(entry.data.byteLength / 1048576).toFixed(1)} MB — over the 40 MB take limit, reload restores the previous take`)
      }
    }
    if (!kept.length) { await pruneTakes(projectKey); return { saved: 0, bytes: 0, skipped } }
    let bytes = 0
    try {
      await inStore('readwrite', (store) => {
        const at = Date.now()
        for (const entry of kept) {
          const size = entry.data.byteLength
          bytes += size
          store.put({
            id: `${projectKey}/${entry.trackId}`,
            project: projectKey,
            trackId: entry.trackId,
            rate: Number(entry.rate) || state.sampleRate,
            bytes: size,
            at,
            data: entry.data,
          })
        }
      })
    } catch (err) {
      log(`take audio: store failed (${err?.message || err})`)
      return { saved: 0, bytes: 0, skipped }
    }
    const pruned = await pruneTakes(projectKey)
    if (pruned) log(`take audio: pruned ${pruned} older project${pruned === 1 ? '' : 's'}`)
    return { saved: kept.length, bytes, skipped }
  }

  const trackName = (id) => state.tracks?.find((t) => t.id === id)?.name || id

  async function loadTakes(projectKey) {
    if (!projectKey) return []
    try {
      return await inStore('readonly', (store) => {
        const found = []
        const req = store.index('project').getAll(projectKey)
        req.onsuccess = () => { if (Array.isArray(req.result)) found.push(...req.result) }
        return found
      })
    } catch (err) {
      log(`take audio: read failed (${err?.message || err})`)
      return []
    }
  }

  // Re-attach a restored buffer to its clip: the waveform, the play button and
  // the note editor all hang off app.js, so it owns the repaint.
  async function restoreTakes(projectKey) {
    state.takes = new Map()
    state.take = null
    state.takeTrack = null
    const rows = await loadTakes(projectKey)
    if (!rows.length) return 0
    let first = null
    let bytes = 0
    for (const row of rows) {
      if (!row?.data?.length) continue
      const track = state.tracks?.find((t) => t.id === row.trackId)
      if (!track) continue
      const data = row.data instanceof Float32Array ? row.data : new Float32Array(row.data)
      const rate = Number(row.rate) || state.sampleRate
      state.takes.set(track.id, { data, rate })
      bytes += data.byteLength
      if (!first) first = { id: track.id, data, rate }
    }
    if (!first) return 0
    state.take = first.data
    state.takeTrack = first.id
    state.sampleRate = first.rate
    for (const [id, entry] of state.takes) window.VS?.attachTake?.(id, entry.data, entry.rate)
    if (state.notes.length) {
      $('btn-play').disabled = false
      window.VS?.setState?.({ notes: state.notes })
    } else {
      $('note-count').textContent = 'no notes'
    }
    log(`take audio restored: ${state.takes.size} track${state.takes.size === 1 ? '' : 's'}, ${(bytes / 1048576).toFixed(1)} MB`)
    toast('Take audio restored from this browser', 'good')
    return state.takes.size
  }

  // ---------------------------------------------------------------- save
  function write(payload, { announce = true } = {}) {
    const text = JSON.stringify(payload)
    // the payload has to survive its own parse before it is trusted anywhere
    validate(JSON.parse(text))
    let stored = false
    if (text.length <= MAX_STORE_BYTES) {
      try { localStorage.setItem(SLOT, text); stored = true } catch { stored = false }
    }
    stamp(new Date())
    ui.dirty = false
    if (stored) {
      log(`project saved (${(text.length / 1024).toFixed(1)} kB to this browser)`)
      if (announce) toast('Project saved to this browser', 'good')
    } else {
      log(`project is ${(text.length / 1024).toFixed(0)} kB — too big to store, export it instead`)
      if (announce) toast('Too big to store — use Export project file', 'bad', 4600)
    }
    void saveTakes(payload.projectId).then(({ saved, bytes: audio }) => {
      if (saved) log(`take audio stored: ${saved} track${saved === 1 ? '' : 's'}, ${(audio / 1048576).toFixed(1)} MB in this browser`)
    })
    return { stored, bytes: text.length }
  }

  function save() {
    try {
      const payload = serialise()
      return write(payload)
    } catch (err) {
      log(`save failed: ${err.message}`)
      toast('Save failed', 'bad')
      return { stored: false, bytes: 0 }
    }
  }

  function exportFile() {
    try {
      const payload = serialise()
      write(payload)
      const text = JSON.stringify(payload, null, 2)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug(payload.name)}.apollo.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      log(`project exported: ${a.download}`)
      toast('Project exported', 'good')
    } catch (err) {
      log(`export failed: ${err.message}`)
      toast('Export failed', 'bad')
    }
  }

  // ---------------------------------------------------------------- open
  function open(text, source) {
    const data = JSON.parse(text)
    apply(data)
    log(`project opened from ${source}: ${data.name || 'untitled'} — ${data.tracks.length} tracks, ${data.notes.length} notes`)
    toast(`Opened “${String(data.name || 'untitled').slice(0, 40)}”`)
  }

  async function openFile(file) {
    if (!file) return
    try {
      open(await file.text(), file.name || 'file')
    } catch (err) {
      log(`open failed: ${err.message}`)
      toast(`Open failed — ${err.message}`, 'bad', 4600)
    }
  }

  function openStored() {
    let text = ''
    try { text = localStorage.getItem(SLOT) || '' } catch { text = '' }
    if (!text) { log('no stored project in this browser'); toast('Nothing stored yet', 'bad'); return false }
    try {
      open(text, 'this browser')
      return true
    } catch (err) {
      log(`open failed: ${err.message}`)
      toast(`Stored project is damaged — ${err.message}`, 'bad', 4600)
      return false
    }
  }

  // ---------------------------------------------------------------- undo hook
  // A snapshot in the editor's own shape, so Ctrl+Z and Redo replay these edits
  // exactly like a drag does.
  function editSnapshot() {
    const uiEdit = state.edit
    return {
      kind: activeRoll() ? 'roll' : 'voice',
      active: state.active,
      selected: state.selected,
      notes: state.notes.map((n) => ({ ...n })),
      sel: [...(uiEdit?.sel || [])],
      primary: uiEdit?.primary ?? null,
      rolls: new Map([...state.rolls].map(([id, r]) => [id, r ? roll.cloneRoll(r) : null])),
      mixer: uiEdit?.mixerRows ? uiEdit.mixerRows() : undefined,
    }
  }

  function pushEditUndo(snapshot) {
    const uiEdit = state.edit
    if (!uiEdit) return false
    uiEdit.undo.push(snapshot)
    if (uiEdit.undo.length > MAX_UNDO) uiEdit.undo.shift()
    uiEdit.redo.length = 0
    if (snapshot.kind === 'roll') state.undoRoll?.push(snapshot.rolls.get(snapshot.active))
    uiEdit.syncButtons?.()
    return true
  }

  function redraw() {
    state.studio?.drawRoll?.()
    if (activeRoll()) {
      $('note-count').textContent = `${activeRoll().notes.length} roll note${activeRoll().notes.length === 1 ? '' : 's'}`
      return
    }
    if (window.VS?.setState) window.VS.setState({ notes: state.notes })
    else $('note-count').textContent = state.notes.length ? `${state.notes.length} take notes` : 'no notes'
  }

  // ---------------------------------------------------------------- quantize / lock
  function quantize() {
    const r = activeRoll()
    const grid = gridBeats()
    const snapshot = editSnapshot()
    if (r) {
      if (!r.notes.length) { log('quantize: the roll is empty'); return true }
      pushEditUndo(snapshot)
      roll.quantize(r, grid, 1)
      redraw()
      log(`quantized ${r.notes.length} roll notes to ${$('in-quant')?.selectedOptions[0]?.textContent || `${grid} beats`}`)
      return true
    }
    if (!state.notes.length) { log('quantize: nothing to move'); return true }
    pushEditUndo(snapshot)
    state.notes = tune.quantizeStarts(state.notes, { bpm: bpm(), division: 1 / grid })
    redraw()
    log(`quantized ${state.notes.length} take notes to ${$('in-quant')?.selectedOptions[0]?.textContent || `${grid} beats`}`)
    return true
  }

  function lockScale() {
    const root = num(Number($('in-root')?.value), 0, 0, 11)
    const name = $('in-scale')?.value || 'chromatic'
    const classes = (SCALES[name] || SCALES.chromatic).map((i) => (i + root) % 12)
    const r = activeRoll()
    const snapshot = editSnapshot()
    if (r) {
      if (!r.notes.length) { log('lock to scale: the roll is empty'); return true }
      pushEditUndo(snapshot)
      roll.lockToScale(r, classes, root + 48)
      redraw()
      log(`locked ${r.notes.length} roll notes to ${$('in-scale')?.selectedOptions[0]?.textContent || name}`)
      return true
    }
    if (!state.notes.length) { log('lock to scale: nothing to move'); return true }
    pushEditUndo(snapshot)
    const before = state.notes.map((n) => n.midi)
    state.notes = tune.snapStrength(state.notes, { root, scale: name, amount: 1 })
    const moved = state.notes.filter((n, i) => Math.abs(n.midi - before[i]) > 1e-6).length
    // repeated locks must not compound: the take pitch is the reference
    redraw()
    log(`locked ${moved} take notes to the key`)
    return true
  }

  // ---------------------------------------------------------------- tag
  let tagEl = null
  function paintTag() {
    if (!tagEl) return
    if (tagEl.textContent !== state.tag) tagEl.textContent = state.tag
    tagEl.title = `Project tag — click to edit (${state.tag})`
  }

  function buildTag() {
    const wrap = document.querySelector('.projwrap')
    if (!wrap || $('proj-tag')) { tagEl = $('proj-tag'); return }
    tagEl = document.createElement('span')
    tagEl.id = 'proj-tag'
    tagEl.className = 'ptag'
    tagEl.setAttribute('contenteditable', 'true')
    tagEl.setAttribute('role', 'textbox')
    tagEl.setAttribute('aria-label', 'Project tag')
    tagEl.setAttribute('spellcheck', 'false')
    tagEl.textContent = state.tag
    wrap.append(tagEl)
    const commit = () => {
      const text = tagEl.textContent.replace(/\s+/g, ' ').trim().slice(0, TAG_MAX)
      state.tag = text || 'untagged'
      tagEl.textContent = state.tag
      markDirty()
    }
    tagEl.addEventListener('blur', commit)
    tagEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); tagEl.blur() }
      if (e.key === 'Escape') { tagEl.textContent = state.tag; tagEl.blur() }
    })
    tagEl.addEventListener('paste', (e) => {
      e.preventDefault()
      const text = (e.clipboardData?.getData('text') || '').replace(/\s+/g, ' ').trim()
      document.execCommand('insertText', false, text.slice(0, TAG_MAX))
    })
    paintTag()
  }

  // ---------------------------------------------------------------- chrome: notifications
  function renderNotifications() {
    const host = $('menu-notifications')
    if (!host) return
    const lines = (logEl?.textContent || '').split('\n').filter(Boolean)
    const recent = lines.slice(-NOTIFICATIONS).reverse()
    const badge = document.querySelector('.bell .badge')
    const seeded = recent.map((text) => `
      <button role="menuitem" type="button" data-note>
        <span data-icon="chat" aria-hidden="true"></span><span class="ntext">${esc(text)}</span>
      </button>`).join('')
    host.innerHTML = `<div class="nhead">This session${ui.savedAt ? ` · saved ${savedEl.textContent}` : ''}</div>` + (seeded ||
      `<button role="menuitem" type="button" data-note><span data-icon="sparkle" aria-hidden="true"></span><span class="ntext">Nothing yet — actions land here</span></button>`)
    if (badge) {
      badge.textContent = String(Math.min(9, recent.length))
      badge.hidden = recent.length === 0
    }
  }

  // ---------------------------------------------------------------- chrome: account
  function renderAccount() {
    const host = $('menu-account')
    if (!host) return
    host.innerHTML = `
      <button role="menuitem" type="button" data-acct="profile">
        <span data-icon="user" aria-hidden="true"></span>Jackson — ${state.member ? 'Apollo Pro' : 'free tier'}
      </button>
      <button role="menuitem" type="button" data-acct="settings" data-modal="settings">
        <span data-icon="settings" aria-hidden="true"></span>Settings
      </button>
      <button role="menuitem" type="button" data-acct="signout">
        <span data-icon="close" aria-hidden="true"></span>Sign out (local only)
      </button>`
  }

  function signOut() {
    save()
    const blank = tracks.createTrack({ type: 'voice', name: 'Voice/Audio', index: 0 })
    blank.chain = fx.createChain({ isMember: state.member })
    state.tracks = [blank]
    state.active = blank.id
    state.rolls = new Map()
    state.patterns = new Map()
    state.notes = []
    state.versions = []
    state.lyrics = []
    state.take = null
    state.takeTrack = null
    state.takes = new Map()
    state.projectId = newProjectId()
    window.VS?.drawWave?.()
    state.undoRoll = []
    state.edit?.undo?.splice?.(0)
    state.edit?.redo?.splice?.(0)
    state.edit?.syncButtons?.()
    if ($('proj-name')) $('proj-name').value = 'untitled'
    state.tag = 'skin'
    paintTag()
    if ($('in-lyrics')) $('in-lyrics').value = ''
    $('note-count').textContent = 'no notes'
    state.studio?.renderAll?.()
    state.studio?.drawRoll?.()
    if (window.VS?.setState) window.VS.setState({ notes: state.notes })
    ui.dirty = false
    log('signed out — the session stays in this browser')
    toast('Signed out (local only)', 'good')
  }

  // ---------------------------------------------------------------- chrome: pro sheet
  function augmentGet() {
    const sheet = $('m-get')?.querySelector('.sheet')
    if (!sheet || sheet.querySelector('.split')) return
    const freeFx = fx.maxEffects(false)
    const proFx = fx.maxEffects(true)
    const freePresets = ['Classic', 'Duet', 'Big Harmony']
    const proPresets = ['Natural', 'Third', 'Chip']
    const split = document.createElement('div')
    split.className = 'split'
    split.setAttribute('role', 'table')
    split.innerHTML = `
      <section class="col" role="rowgroup">
        <h3>Free · what you have</h3>
        <ul role="list">
          <li><span class="num">${freeFx}</span> effects per chain</li>
          <li>AutoPitch: ${freePresets.join(', ')}</li>
          <li><span class="num">20</span> version snapshots</li>
          <li>Local save + 30 s autosave</li>
        </ul>
      </section>
      <section class="col pro" role="rowgroup">
        <h3>Member · what Pro adds</h3>
        <ul role="list">
          <li><span class="num">${proFx}</span> effects per chain</li>
          <li>AutoPitch: ${proPresets.join(', ')}</li>
          <li><span class="num">50</span> version snapshots</li>
          <li>Membership sample packs</li>
        </ul>
      </section>`
    const perks = sheet.querySelector('.perks')
    if (perks) perks.replaceWith(split)
    else sheet.querySelector('.sheet-head')?.after(split)
  }

  // ---------------------------------------------------------------- dirty + autosave
  function markDirty() {
    if (ui.restoring) return
    ui.dirty = true
  }

  function autosave() {
    if (!ui.dirty) return
    const { bytes } = save()
    log(`autosave: ${(bytes / 1024).toFixed(1)} kB`)
  }

  // ---------------------------------------------------------------- boot
  function restoreOnBoot() {
    let text = ''
    try { text = localStorage.getItem(SLOT) || '' } catch { text = '' }
    if (!text) return
    try {
      apply(JSON.parse(text))
      toast('Restored — last session loaded from this browser', 'good', 4200)
      log('project restored from this browser')
    } catch (err) {
      log(`restore failed: ${err.message}`)
      toast(`Restore failed — ${err.message}`, 'bad', 4600)
      state.tag = 'skin'
      paintTag()
    }
  }

  // ---------------------------------------------------------------- wiring
  buildTag()
  augmentGet()

  $('btn-save').addEventListener('click', (e) => {
    e.preventDefault()
    save()
  })
  document.addEventListener('click', (e) => {
    const exp = e.target.closest('#btn-menu-export-project')
    if (!exp) return
    e.preventDefault()
    e.stopPropagation()
    exportFile()
    $('menu-app').hidden = true
  }, true)
  // #file-project is bound in app.js (it owns the input); it calls state.persist.openFile

  // open the stored copy: a menu item beside "Export project file"
  if (!$('btn-open-stored') && $('menu-app')) {
    const item = document.createElement('button')
    item.id = 'btn-open-stored'
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.innerHTML = '<span data-icon="history" aria-hidden="true"></span>Open saved project'
    item.addEventListener('click', () => { $('menu-app').hidden = true; openStored() })
    $('btn-menu-export-project').after(item)
  }

  const bell = document.querySelector('.bell')
  bell?.addEventListener('click', () => renderNotifications())
  $('menu-notifications')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-note]')) $('menu-notifications').hidden = true
  })
  const avatar = document.querySelector('.avatar')
  avatar?.addEventListener('click', () => renderAccount())
  $('menu-account')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-acct]')
    if (!b) return
    if (b.dataset.acct === 'signout') { $('menu-account').hidden = true; signOut() }
    if (b.dataset.acct === 'profile') { $('menu-account').hidden = true; toast(`Jackson · ${state.member ? 'Apollo Pro' : 'free tier'}`) }
  })

  // Save/Export shortcuts and the editor buttons keep working through the DOM.
  for (const event of ['input', 'change']) document.addEventListener(event, markDirty, true)
  document.addEventListener('pointerup', (e) => {
    if (e.target.closest('.menu, .modal, .apollo-toast')) return
    markDirty()
  }, true)
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (['Shift', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
    markDirty()
  })

  setInterval(autosave, AUTOSAVE_MS)

  window.addEventListener('pagehide', () => { if (ui.dirty) save() })

  renderNotifications()
  renderAccount()
  restoreOnBoot()
  log('persistence: ⌘S saves to this browser, Export writes an .apollo.json')
}
