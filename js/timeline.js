// js/timeline.js — timeline interactions: clip trim/fade/gain handles, region
// menu, loop drag, split at the playhead, automation point drawing.
//
// Everything is delegated from `document` in the *capture* phase. app.js already
// owns a pointerdown on #lane that scrubs and studio.js binds clicks on the same
// surfaces, so capture is the only place where this layer can claim an event
// before those run. app.html is untouched: clips, handles, the region menu item
// and the stylesheet are all appended at runtime.
//
// A region is one clip object. `track.clip` is always region 0; extra regions
// split off or duplicated from it live in `track.clips` (plain array, so the
// project still JSON-dumps). Only region 0 ever carries an automation lane.
import * as automation from './automation.js'
import * as icons from './icons.js'

const MIN_BEATS = 0.25
const MAX_BEATS = 512
const HIT_PX = 7
const DEFAULT_LENGTH = 4
const MIN_LOOP_PX = 4
const STYLES_ID = 'tl-styles'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round2 = (v) => Math.round(v * 100) / 100
const round4 = (v) => Math.round(v * 1e4) / 1e4
const norm01 = (v) => clamp(Number.isFinite(v) ? v : 0, 0, 1)

const CSS = `
.clip.tl-clip { touch-action: none; }
/* a lane that owns a real region no longer needs its dashed placeholder */
.lane-row:has(> .clip.tl-clip) > .ghost-clip { display: none; }
.clip .tl-trim { position: absolute; top: 18px; bottom: 0; width: 8px; z-index: 4; cursor: ew-resize; }
.clip .tl-trim.left { left: 0; }
.clip .tl-trim.right { right: 0; }
.clip .tl-trim::after { content: ''; position: absolute; top: 50%; width: 2px; height: 16px;
  margin-top: -8px; border-radius: 1px; background: rgba(0, 198, 209, 0.85); opacity: 0;
  transition: opacity 120ms ease; }
.clip .tl-trim.left::after { left: 3px; }
.clip .tl-trim.right::after { right: 3px; }
.clip:hover .tl-trim::after, .clip.sel .tl-trim::after, body.tl-dragging .tl-trim::after { opacity: 1; }
.clip .tl-fade { position: absolute; top: 18px; width: 12px; height: 12px; z-index: 5; cursor: grab; }
.clip .tl-fade.in { left: 0; border-top: 12px solid rgba(0, 198, 209, 0.5); border-right: 12px solid transparent; }
.clip .tl-fade.out { right: 0; border-top: 12px solid rgba(0, 198, 209, 0.5); border-left: 12px solid transparent; }
.clip .tl-fade:hover, body.tl-dragging .clip .tl-fade { border-top-color: var(--cyan); }
.clip.sel { outline: 1px solid rgba(0, 198, 209, 0.9); outline-offset: -1px; }
.clip.tl-reversed #wave { transform: scaleX(-1); }
.clip.tl-stretched::before { content: ''; position: absolute; inset: 18px 0 0; z-index: 1; pointer-events: none;
  background: repeating-linear-gradient(45deg, rgba(0, 198, 209, 0.12) 0 6px, transparent 6px 12px); }
/* the fade shading is a wedge the length of the fade, not a rectangle */
.clip .fade { top: 18px; background: rgba(0, 198, 209, 0.22); }
.clip .fade.in { clip-path: polygon(0 0, 100% 0, 0 100%); border-right: 1px solid rgba(0, 198, 209, 0.5); }
.clip .fade.out { clip-path: polygon(100% 0, 0 0, 100% 100%); border-left: 1px solid rgba(0, 198, 209, 0.5); }
body.tl-auto .clip .fade { bottom: 46px; }
.clip .clip-head h3 { min-width: 0; }
.clip .clip-head .tnum { margin-right: 3px; }
.clip .clip-gain { flex: 0 0 auto; color: #cdedf2; }
.clip-gain input.tl-gain { width: 46px; height: 15px; padding: 0 3px; margin-left: auto;
  border: 1px solid var(--cyan); border-radius: 3px; background: #04252a; color: #d6f6f8;
  font: 9px/1 var(--mono); }
.auto-canvas { cursor: crosshair; touch-action: none; }
/* styles-ext puts the automation lane in normal flow, where the clip's fixed
   height clips it away. Overlay it and give the whole row back the 48px while
   automation is shown (body.tl-auto is set from state.showAutomation). */
.clip .automation-lane { position: absolute; left: 0; right: 0; bottom: 0; height: 46px; z-index: 2; }
.auto-legend { pointer-events: none; color: var(--text); }
.auto-legend button { pointer-events: auto; border: 1px solid var(--line); border-radius: 999px;
  padding: 2px 7px; color: var(--ink); }
body.tl-auto .lane-row { height: calc(var(--row-h) + 48px); }
body.tl-auto .track-head { flex: 0 0 calc(var(--row-h) + 48px); height: calc(var(--row-h) + 48px); }
body.tl-auto .clip { height: calc(var(--row-h) + 36px); }
body.tl-auto .clip #wave { height: calc(100% - 64px); }
#ruler { cursor: pointer; touch-action: none; }
.ruler-select { position: absolute; top: 0; bottom: 0; pointer-events: none;
  background: rgba(0, 198, 209, 0.10); border-top: 1px solid rgba(0, 198, 209, 0.55); }
body.tl-dragging { cursor: ew-resize; user-select: none; }
`

const makeClip = (over = {}) => ({
  startBeat: 0, lengthBeats: DEFAULT_LENGTH, gain: 1, fadeIn: 0, fadeOut: 0,
  stretch: 1, reverse: false, name: '', ...over,
})

const dbOf = (gain) => {
  const g = Number.isFinite(gain) && gain > 0 ? gain : 1
  return clamp(20 * Math.log10(g), -60, 6)
}

const gainOf = (db) => Number((10 ** (clamp(db, -60, 6) / 20)).toFixed(4))

export function install({ state, log }) {
  if (!state || state.tlReady) return
  const $ = (id) => document.getElementById(id)
  const lane = $('lane')
  const ruler = $('ruler')
  const menu = $('menu-region')
  if (!lane || !ruler || !menu) return
  state.tlReady = true

  const ui = { drag: null, ruler: null, menu: null, selected: null, suppressClick: false, loopBack: null }

  // ---------------------------------------------------------------- helpers
  function injectStyles() {
    if (document.getElementById(STYLES_ID)) return
    const style = document.createElement('style')
    style.id = STYLES_ID
    style.textContent = CSS
    document.head.append(style)
  }

  // px per beat, straight off the one-bar width the lane is zoomed to
  function pxPerBeat() {
    const raw = parseFloat(getComputedStyle(lane).getPropertyValue('--ppb'))
      || parseFloat(getComputedStyle(lane).getPropertyValue('--bar'))
    return (Number.isFinite(raw) && raw > 0 ? raw : 77) / 4
  }

  const bpm = () => Number($('in-bpm')?.value) || 96
  const trackOf = (id) => state.tracks.find((t) => t && t.id === id)
  /* studio's rebind() can only rewrite descendants, so the static first row
     keeps its placeholder data-row="1" — fall back to the clip it holds */
  function laneRowOf(id) {
    return document.querySelector(`.lane-row[data-row="${id}"]`)
      || document.querySelector(`.lane-row [data-clip="${id}"]`)?.closest('.lane-row')
      || null
  }
  const regionAt = (track, index) => {
    if (!track) return null
    if (index === 0) return track.clip || null
    const extra = Array.isArray(track.clips) ? track.clips : []
    return extra[index - 1] || null
  }
  const listOf = (track) => (Array.isArray(track.clips) ? track.clips : (track.clips = []))
  const playheadBeats = () => Math.max(0, (Number(state.playhead) || 0) * bpm() / 60)

  function pick(e) {
    const node = e.target.closest?.('.clip')
    if (!node) return null
    const track = trackOf(node.dataset.clip)
    const index = Number(node.dataset.regionIndex || 0)
    const region = regionAt(track, index)
    if (!track || !region || !(region.lengthBeats > 0)) return null
    return { node, track, index, region }
  }

  // ---------------------------------------------------------------- geometry
  function paintClip(node, track, region) {
    const pp = pxPerBeat()
    const pristine = region.startBeat === 0 && Math.abs(region.lengthBeats - DEFAULT_LENGTH) < 1e-6
    if (pristine) {
      // let the CSS one-bar width (and the demo take's data-full stretch) win
      node.style.left = ''
      node.style.width = ''
      node.style.minWidth = ''
    } else {
      node.style.left = `${region.startBeat * pp}px`
      node.style.width = `${Math.max(8, region.lengthBeats * pp)}px`
      node.style.minWidth = '0px'
    }
    const fin = node.querySelector('.fade.in')
    if (fin) fin.style.width = `${Math.max(0, region.fadeIn || 0) * pp}px`
    const fout = node.querySelector('.fade.out')
    if (fout) fout.style.width = `${Math.max(0, region.fadeOut || 0) * pp}px`
    node.classList.toggle('tl-reversed', !!region.reverse)
    node.classList.toggle('tl-stretched', region.stretch !== 1)
    node.style.setProperty('--tl-gain', String(Number.isFinite(region.gain) ? region.gain : 1))
  }

  function paintSelection() {
    document.querySelectorAll('.clip').forEach((node) => {
      const index = Number(node.dataset.regionIndex || 0)
      node.classList.toggle('sel', ui.selected?.track === node.dataset.clip && ui.selected?.index === index)
    })
  }

  function mark(track) {
    const row = laneRowOf(track.id)
    if (row) row.dataset.tlSig = ''
    syncLanes()
  }

  // ---------------------------------------------------------------- rendering
  function decorate(node, track, index) {
    node.classList.add('tl-clip')
    node.dataset.clip = track.id
    node.dataset.regionIndex = String(index)
    if (!node.classList.contains('clip')) node.classList.add('clip')
    if (!node.querySelector('.clip-head')) {
      const head = document.createElement('div')
      head.className = 'clip-head'
      head.innerHTML = `<h3>${track.name}</h3><span class="clip-gain">gain <output>0.0 dB</output></span>`
      node.prepend(head)
    }
    node.setAttribute('role', 'group')
    node.setAttribute('aria-label', `${track.name} region`)
    for (const edge of ['in', 'out']) {
      if (node.querySelector(`.tl-fade.${edge}`)) continue
      const tri = document.createElement('span')
      tri.className = `tl-fade ${edge}`
      tri.setAttribute('aria-hidden', 'true')
      tri.title = `Fade ${edge}`
      node.append(tri)
    }
    for (const edge of ['left', 'right']) {
      if (node.querySelector(`.tl-trim.${edge}`)) continue
      const grip = document.createElement('span')
      grip.className = `tl-trim ${edge}`
      grip.dataset.trim = edge
      grip.setAttribute('aria-hidden', 'true')
      grip.title = `${edge === 'left' ? 'Trim start' : 'Trim end'}`
      node.append(grip)
    }
  }

  function ensureClipNode(row, track, index) {
    const found = row.querySelector(`:scope > .clip[data-region-index="${index}"]`)
    if (found) return found
    if (index === 0) {
      // the static clip-1 is region 0; adopt it instead of building a twin
      const legacy = row.querySelector(':scope > .clip:not([data-region-index])')
      if (legacy) { decorate(legacy, track, 0); return legacy }
    }
    const node = document.createElement('div')
    node.className = 'clip tl-clip'
    decorate(node, track, index)
    const mine = regionAt(track, index)
    const after = [...row.querySelectorAll(':scope > .clip')].find((el) => {
      const other = regionAt(track, Number(el.dataset.regionIndex || 0))
      return other && mine && other.startBeat > mine.startBeat
    })
    row.insertBefore(node, after || null)
    return node
  }

  /* the index chip lives in its own <i>, so only the trailing text node is
     rewritten — a renamed region must not swallow the "01" prefix */
  function setHead(title, label) {
    let text = [...title.childNodes].find((n) => n.nodeType === 3)
    if (!text) { text = document.createTextNode(''); title.append(text) }
    const next = ` ${label}`
    if (text.textContent !== next) text.textContent = next
  }

  let busy = false
  function syncLanes() {
    if (busy) return
    busy = true
    try {
      document.body.classList.toggle('tl-auto', !!state.showAutomation)
      for (const track of state.tracks) {
        if (!track) continue
        if (!track.clip) track.clip = makeClip()
        const row = laneRowOf(track.id)
        if (!row) continue
        syncLane(row, track)
      }
    } finally {
      busy = false
    }
  }

  function syncLane(row, track) {
    const regions = [track.clip, ...(Array.isArray(track.clips) ? track.clips : [])]
      .map((clip, index) => ({ clip, index }))
      .filter((r) => r.clip && r.clip.lengthBeats > 0)
    const sig = regions.map((r) => [
      r.index, round2(r.clip.startBeat), round2(r.clip.lengthBeats), r.clip.gain ?? 1,
      round2(r.clip.fadeIn || 0), round2(r.clip.fadeOut || 0), r.clip.stretch ?? 1,
      r.clip.reverse ? 1 : 0, r.clip.name || '',
    ].join(':')).join('|')
    const present = [...row.querySelectorAll(':scope > .clip')]
    if (row.dataset.tlSig === sig && present.length === regions.length) return
    row.dataset.tlSig = sig
    present.forEach((node) => {
      const index = Number(node.dataset.regionIndex || 0)
      if (!regions.some((r) => r.index === index)) node.remove()
    })
    for (const { clip, index } of regions) {
      const node = ensureClipNode(row, track, index)
      decorate(node, track, index)
      paintClip(node, track, clip)
      const title = node.querySelector('.clip-head h3')
      if (title) setHead(title, clip.name || track.name)
      const out = node.querySelector('.clip-gain output, [data-clip-gain]')
      if (out) out.textContent = `${dbOf(clip.gain).toFixed(1)} dB`
      node.classList.toggle('sel', ui.selected?.track === track.id && ui.selected?.index === index)
    }
  }

  // ---------------------------------------------------------------- region ops
  function dropRegion(track, index) {
    const extra = listOf(track)
    if (index === 0) {
      if (extra.length) track.clip = extra.shift()
      else track.clip = { ...track.clip, lengthBeats: MIN_BEATS, fadeIn: 0, fadeOut: 0 }
      return
    }
    extra.splice(index - 1, 1)
  }

  function duplicateRegion(track, index) {
    const src = regionAt(track, index)
    if (!src) return null
    const copy = { ...src, startBeat: round2(src.startBeat + src.lengthBeats) }
    listOf(track).push(copy)
    return copy
  }

  function splitRegion(track, index, atBeat) {
    const region = regionAt(track, index)
    if (!region) return null
    const start = region.startBeat
    const end = start + region.lengthBeats
    if (atBeat <= start + MIN_BEATS || atBeat >= end - MIN_BEATS) return null
    const right = { ...region, startBeat: round2(atBeat), lengthBeats: round2(end - atBeat), fadeIn: 0 }
    right.fadeOut = Math.min(right.fadeOut || 0, right.lengthBeats)
    region.lengthBeats = round2(atBeat - start)
    region.fadeOut = Math.min(region.fadeOut || 0, region.lengthBeats)
    listOf(track).push(right)
    return right
  }

  function runRegionAction(action) {
    const target = ui.menu
    if (!target) return
    const track = trackOf(target.track)
    const region = regionAt(track, target.index)
    if (!track || !region) return
    if (action === 'split') {
      const at = playheadBeats()
      const out = splitRegion(track, target.index, at)
      log(out ? `split at ${at.toFixed(2)} beats` : 'split: playhead outside the region')
      if (!out) return
    } else if (action === 'duplicate') {
      const copy = duplicateRegion(track, target.index)
      log(copy ? `duplicated region to beat ${copy.startBeat}` : 'duplicate: no region')
    } else if (action === 'delete') {
      log('region deleted')
      dropRegion(track, target.index)
      ui.selected = null
    } else if (action === 'reverse') {
      region.reverse = !region.reverse
      log(`region ${region.reverse ? 'reversed' : 'forward'}`)
    } else if (action === 'stretch') {
      region.stretch = region.stretch === 1 ? 2 : 1
      log(`region stretch ${region.stretch === 1 ? 'off' : 'x2'}`)
    } else if (action === 'rename') {
      const next = window.prompt('Region name', region.name || track.name)
      if (next !== null) { region.name = next.trim().slice(0, 60); log(`region renamed: ${region.name || track.name}`) }
    } else return
    mark(track)
  }

  // ---------------------------------------------------------------- drags
  function beginDrag(spec, pointerId) {
    ui.drag = { ...spec, pointerId, moved: false, startX: spec.startX }
    document.body.classList.add('tl-dragging')
    try { spec.node.setPointerCapture(pointerId) } catch { /* capture is a nicety */ }
  }

  function endDrag() {
    const drag = ui.drag
    if (!drag) return
    ui.drag = null
    document.body.classList.remove('tl-dragging')
    try { drag.node.releasePointerCapture(drag.pointerId) } catch { /* already gone */ }
    if (drag.kind === 'trim') drag.node.classList.remove('trimming')
    mark(drag.track)
  }

  // ---------------------------------------------------------------- loop band
  const loopEl = () => document.getElementById('loop-region')

  function paintLoop() {
    const el = loopEl()
    if (!el) return
    const loop = state.loop
    if (!loop) { el.hidden = true; return }
    el.hidden = false
    el.style.left = `${loop.from}px`
    el.style.width = `${Math.max(MIN_LOOP_PX, loop.to - loop.from)}px`
  }

  function rulerX(e) {
    const box = ruler.getBoundingClientRect()
    const span = Math.max(ruler.scrollWidth, box.width)
    return clamp(e.clientX - box.left, 0, span)
  }

  function movePlayhead(x) {
    const barPx = pxPerBeat() * 4
    const barSeconds = (60 / bpm()) * 4
    state.playhead = Math.max(0, (x / barPx) * barSeconds)
    const head = $('playhead')
    if (head) head.style.left = `${x}px`
  }

  function paintSelectBand() {
    const existing = ruler.querySelector('.ruler-select')
    const sel = state.tlSelection
    if (!sel) { existing?.remove(); return }
    let band = existing
    if (!band) { band = document.createElement('span'); band.className = 'ruler-select'; ruler.append(band) }
    band.style.left = `${sel.from}px`
    band.style.width = `${Math.max(3, sel.to - sel.from)}px`
  }

  function extendSelection(x) {
    const anchorPx = (Number(state.playhead) || 0) / ((60 / bpm()) * 4) * pxPerBeat() * 4
    const from = Math.min(anchorPx, x)
    const to = Math.max(anchorPx, x)
    state.tlSelection = to - from >= 3 ? { from, to } : null
    paintSelectBand()
  }

  // ---------------------------------------------------------------- automation
  const paramOf = (canvas) => canvas.dataset.param || 'volume'
  const valueAt = (param, norm) => {
    const range = automation.PARAM_RANGES[param]
    return range.min + norm * (range.max - range.min)
  }
  const normOf = (param, value) => {
    const range = automation.PARAM_RANGES[param]
    return norm01((value - range.min) / (range.max - range.min))
  }

  function paintAuto(track, canvas) {
    const param = paramOf(canvas)
    const points = track.automation[param] || []
    const g = canvas.getContext('2d')
    if (!g) return
    const w = canvas.width
    const h = canvas.height
    g.clearRect(0, 0, w, h)
    const y = (value) => h - 3 - normOf(param, value) * (h - 6)
    if (!points.length) {
      g.strokeStyle = '#2c3a40'
      g.setLineDash([3, 4])
      g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke()
      g.setLineDash([])
      return
    }
    // read() holds the end values, so draw those flat tails too
    const x = (t) => 3 + norm01(t) * (w - 6)
    const last = points[points.length - 1]
    g.strokeStyle = '#6fa8ff'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(0, y(points[0].value))
    points.forEach((p) => g.lineTo(x(p.t), y(p.value)))
    g.lineTo(w, y(last.value))
    g.stroke()
    g.fillStyle = '#bfd8ff'
    points.forEach((p) => {
      g.beginPath()
      g.arc(x(p.t), y(p.value), 2.4, 0, Math.PI * 2)
      g.fill()
    })
  }

  function pointUnder(canvas, param, points, e) {
    const box = canvas.getBoundingClientRect()
    if (box.width < 1 || box.height < 4) return null
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    let best = null
    let bestD = HIT_PX
    for (const point of points) {
      const d = Math.hypot(norm01(point.t) * box.width - px, (1 - normOf(param, point.value)) * box.height - py)
      if (d <= bestD) { best = point; bestD = d }
    }
    return best
  }

  function autoTarget(canvas, e) {
    const lane = canvas.closest('[data-automation]')
    const track = trackOf(lane?.dataset.automation)
    if (!track || !state.showAutomation) return null
    const param = paramOf(canvas)
    if (!Array.isArray(track.automation[param])) track.automation[param] = []
    const box = canvas.getBoundingClientRect()
    if (box.width < 1) return null
    const t = norm01((e.clientX - box.left) / box.width)
    const value = valueAt(param, 1 - norm01((e.clientY - box.top) / box.height))
    return { canvas, track, param, points: track.automation[param], t, value }
  }

  const autoSort = (points) => points.sort((a, b) => a.t - b.t)

  // ---------------------------------------------------------------- gain editor
  function openGainEditor(node, track, region, wrap) {
    if (wrap.querySelector('input')) return
    const out = wrap.querySelector('output')
    if (!out) return
    const before = out.textContent
    const input = document.createElement('input')
    input.type = 'number'
    input.className = 'tl-gain'
    input.step = '0.5'
    input.min = '-60'
    input.max = '6'
    input.value = dbOf(region.gain).toFixed(1)
    input.setAttribute('aria-label', `${track.name} region gain in dB`)
    out.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const close = (commit) => {
      if (done) return
      done = true
      const next = document.createElement('output')
      next.textContent = before
      if (commit) {
        const db = clamp(Number(input.value), -60, 6)
        if (Number.isFinite(db)) {
          region.gain = gainOf(db)
          next.textContent = `${db.toFixed(1)} dB`
          state.clipGainDb = db
          log(`region gain ${db.toFixed(1)} dB`)
        }
      }
      input.replaceWith(next)
      mark(track)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); close(true) }
      else if (e.key === 'Escape') { e.preventDefault(); close(false) }
      e.stopPropagation()
    })
    input.addEventListener('blur', () => close(true))
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return
    const hit = pick(e)
    if (!hit) return
    const trim = e.target.closest('.tl-trim')
    const fade = e.target.closest('.tl-fade')
    if (!trim && !fade) return
    e.preventDefault()
    e.stopPropagation()
    ui.selected = { track: hit.track.id, index: hit.index }
    paintSelection()
    const kind = trim ? 'trim' : 'fade'
    const edge = trim ? trim.dataset.trim : fade.classList.contains('in') ? 'in' : 'out'
    if (trim && hit.node.hasAttribute('data-full') && hit.region.startBeat === 0
      && Math.abs(hit.region.lengthBeats - DEFAULT_LENGTH) < 1e-6) {
      // a stretched demo take is drawn wider than its beat length; adopt the
      // pixels on screen so the first trim starts from what the user can see
      hit.region.lengthBeats = round2(Math.max(MIN_BEATS, hit.node.getBoundingClientRect().width / pxPerBeat()))
    }
    hit.node.classList.add('trimming')
    beginDrag({
      kind,
      edge,
      node: hit.node,
      track: hit.track,
      region: hit.region,
      startX: e.clientX,
      startBeat: hit.region.startBeat,
      lengthBeats: hit.region.lengthBeats,
      fadeIn: hit.region.fadeIn || 0,
      fadeOut: hit.region.fadeOut || 0,
      stretch: hit.region.stretch ?? 1,
    }, e.pointerId)
  }, true)

  document.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return
    const canvas = e.target.closest?.('.auto-canvas')
    if (!canvas) return
    const target = autoTarget(canvas, e)
    if (!target) return
    e.preventDefault()
    e.stopPropagation()
    const hit = pointUnder(canvas, target.param, target.points, e)
    const point = hit || (() => {
      const made = { id: automation.makePointId(), t: round4(target.t), value: round2(target.value), curve: 'linear' }
      target.points.push(made)
      autoSort(target.points)
      return made
    })()
    paintAuto(target.track, canvas)
    if (!hit) log(`automation point added at ${target.t.toFixed(2)}`)
    beginDrag({
      kind: 'auto',
      node: canvas,
      track: target.track,
      canvas,
      param: target.param,
      points: target.points,
      point,
    }, e.pointerId)
  }, true)

  document.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return
    const hit = pick(e)
    if (!hit) return
    ui.selected = { track: hit.track.id, index: hit.index }
    paintSelection()
  }, true)

  document.addEventListener('pointermove', (e) => {
    const drag = ui.drag
    if (!drag || e.pointerId !== drag.pointerId) return
    const dx = e.clientX - drag.startX
    if (Math.abs(dx) > 2) drag.moved = true
    if (drag.kind === 'trim') {
      const delta = dx / pxPerBeat()
      const end = drag.startBeat + drag.lengthBeats
      if (drag.edge === 'left') {
        const start = clamp(drag.startBeat + delta, 0, end - MIN_BEATS)
        drag.region.startBeat = round2(start)
        drag.region.lengthBeats = Math.max(MIN_BEATS, round2(end - drag.region.startBeat))
      } else {
        const length = clamp(drag.lengthBeats + delta, MIN_BEATS, MAX_BEATS)
        if (drag.stretch !== 1) {
          drag.region.stretch = Number(clamp(drag.stretch * (length / drag.lengthBeats), 0.25, 4).toFixed(3))
        }
        drag.region.lengthBeats = Math.max(MIN_BEATS, round2(length))
      }
      paintClip(drag.node, drag.track, drag.region)
      return
    }
    if (drag.kind === 'fade') {
      const delta = dx / pxPerBeat()
      if (drag.edge === 'in') {
        drag.region.fadeIn = clamp(round2(drag.fadeIn + delta), 0, drag.region.lengthBeats)
      } else {
        drag.region.fadeOut = clamp(round2(drag.fadeOut - delta), 0, drag.region.lengthBeats)
      }
      paintClip(drag.node, drag.track, drag.region)
      return
    }
    if (drag.kind === 'auto') {
      const box = drag.canvas.getBoundingClientRect()
      if (box.width < 1) return
      drag.point.t = round4(norm01((e.clientX - box.left) / box.width))
      drag.point.value = round2(automation.clampValue(drag.param,
        valueAt(drag.param, 1 - norm01((e.clientY - box.top) / box.height))))
      autoSort(drag.points)
      paintAuto(drag.track, drag.canvas)
    }
  }, true)

  document.addEventListener('pointerup', (e) => {
    if (!ui.drag || e.pointerId !== ui.drag.pointerId) return
    const drag = ui.drag
    if (drag.kind === 'auto') paintAuto(drag.track, drag.canvas)
    endDrag()
  }, true)

  document.addEventListener('pointercancel', (e) => {
    if (!ui.drag || e.pointerId !== ui.drag.pointerId) return
    endDrag()
  }, true)

  // studio owns the automation toggle; re-apply the row height once it has run
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#btn-automation, [data-track-act="automation"]')) return
    queueMicrotask(() => {
      document.body.classList.toggle('tl-auto', !!state.showAutomation)
      syncLanes()
    })
  }, true)

  // clicks on the automation canvas: studio's handler still feeds the lane a
  // bare array, which automation.addPoint rejects, so this layer owns the click
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('.auto-canvas')) return
    e.stopImmediatePropagation()
    e.stopPropagation()
  }, true)

  // studio redraws the lane on a param switch with its own flat-pen version;
  // repaint with the tails once it has flipped canvas.dataset.param
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest?.('[data-auto-param]')
    if (!toggle) return
    queueMicrotask(() => {
      const canvas = toggle.closest('[data-automation]')?.querySelector('.auto-canvas')
      const track = trackOf(toggle.closest('[data-automation]')?.dataset.automation)
      if (canvas && track) paintAuto(track, canvas)
    })
  }, true)

  // right-click on a point removes it and keeps the region menu shut. The
  // legend sits over the canvas, so a right-click there still targets the lane.
  document.addEventListener('contextmenu', (e) => {
    const canvas = e.target.closest?.('.auto-canvas')
      || e.target.closest?.('.auto-legend')?.parentElement?.querySelector('.auto-canvas')
    if (!canvas) return
    e.preventDefault()
    e.stopPropagation()
    const target = autoTarget(canvas, e)
    if (!target) return
    const hit = pointUnder(canvas, target.param, target.points, e)
    if (!hit) return
    const at = target.points.indexOf(hit)
    if (at !== -1) target.points.splice(at, 1)
    paintAuto(target.track, canvas)
    log(`automation point removed at ${norm01(hit.t).toFixed(2)}`)
  }, true)

  document.addEventListener('contextmenu', (e) => {
    const hit = pick(e)
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    ui.menu = { track: hit.track.id, index: hit.index }
    ui.selected = { track: hit.track.id, index: hit.index }
    paintSelection()
    menu.hidden = false
    const box = menu.getBoundingClientRect()
    menu.style.left = `${clamp(e.clientX, 8, innerWidth - box.width - 12)}px`
    menu.style.top = `${clamp(e.clientY, 8, innerHeight - box.height - 12)}px`
    icons.hydrate(menu)
    menu.querySelector('[role="menuitem"]')?.focus({ preventScroll: true })
  }, true)

  // region menu actions (studio's own listener only logs and closes)
  document.addEventListener('click', (e) => {
    const item = e.target.closest('[data-region]')
    if (!item) return
    runRegionAction(item.dataset.region)
  })

  document.addEventListener('dblclick', (e) => {
    const wrap = e.target.closest?.('.clip-gain')
    if (!wrap) return
    const hit = pick(e)
    if (!hit) return
    e.preventDefault()
    e.stopPropagation()
    openGainEditor(hit.node, hit.track, hit.region, wrap)
  }, true)

  // ---------------------------------------------------------------- ruler
  ruler.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return
    if (e.target.closest('.ruler-tools, button, input, select')) return
    e.preventDefault()
    e.stopPropagation()
    ui.ruler = { pointerId: e.pointerId, startX: rulerX(e), moved: false }
    state.loop = { from: ui.ruler.startX, to: ui.ruler.startX }
    paintLoop()
    try { ruler.setPointerCapture(e.pointerId) } catch { /* capture is a nicety */ }
  })

  ruler.addEventListener('pointermove', (e) => {
    const drag = ui.ruler
    if (!drag || e.pointerId !== drag.pointerId) return
    const x = rulerX(e)
    if (Math.abs(x - drag.startX) > 2) drag.moved = true
    const from = Math.min(drag.startX, x)
    const to = Math.max(drag.startX, x)
    state.loop = { from, to }
    paintLoop()
  })

  ruler.addEventListener('pointerup', (e) => {
    const drag = ui.ruler
    if (!drag || e.pointerId !== drag.pointerId) return
    ui.ruler = null
    try { ruler.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
    if (drag.moved) {
      ui.suppressClick = true
      ui.loopBack = state.loop
      log(`loop ${(state.loop.from / (pxPerBeat() * 4)).toFixed(2)}–${(state.loop.to / (pxPerBeat() * 4)).toFixed(2)} bars`)
    }
  })

  ruler.addEventListener('pointercancel', () => { ui.ruler = null })

  ruler.addEventListener('click', (e) => {
    const x = rulerX(e)
    if (ui.suppressClick) {
      // studio's click listener refilled state.loop with the release point
      ui.suppressClick = false
      state.loop = ui.loopBack
      ui.loopBack = null
      paintLoop()
      return
    }
    if (e.shiftKey) { extendSelection(x); return }
    state.tlSelection = null
    paintSelectBand()
    movePlayhead(x)
    paintLoop()
  })

  ruler.addEventListener('dblclick', (e) => {
    if (e.target.closest('.ruler-tools')) return
    state.loop = null
    state.tlSelection = null
    paintLoop()
    paintSelectBand()
    log('loop cleared')
  })

  $('btn-split-region')?.addEventListener('click', () => {
    const track = trackOf(state.active)
    if (!track) return
    const at = playheadBeats()
    const index = [track.clip, ...(track.clips || [])].findIndex((region) => (
      region && at > region.startBeat + MIN_BEATS && at < region.startBeat + region.lengthBeats - MIN_BEATS
    ))
    if (index === -1) { log('split: playhead outside every region'); return }
    const out = splitRegion(track, index, at)
    log(out ? `split at ${at.toFixed(2)} beats` : 'split: region too short')
    mark(track)
  })

  // ---------------------------------------------------------------- boot
  function addRenameItem() {
    if (menu.querySelector('[data-region="rename"]')) return
    const item = document.createElement('button')
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.dataset.region = 'rename'
    item.innerHTML = '<span data-icon="edit" aria-hidden="true"></span>Rename region'
    menu.append(item)
    icons.hydrate(item)
  }

  injectStyles()
  addRenameItem()
  paintLoop()
  syncLanes()

  // renderTrackList() wipes #lane-rows; rebuild the clip layer whenever it does.
  // The per-row signature makes the observer settle after one extra pass.
  const host = $('lane-rows')
  if (host) new MutationObserver(() => syncLanes()).observe(host, { childList: true })
  const row1 = document.querySelector('.lane-row[data-row]')
  if (row1) new MutationObserver(() => syncLanes()).observe(row1, { childList: true })
}
