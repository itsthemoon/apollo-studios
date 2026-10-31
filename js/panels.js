// js/panels.js — the deep panels: Mastering, My Sounds, Versions, Chat,
// Lyrics/Notes, Publish, Invite, Create, More and the shortcuts sheet.
// install() is called once from app.js after the studio attaches.
//
// Panels render into the hosts app.html already ships. Where the studio or the
// app already own a control (Analyze, Apply, preset paint, chat send, snapshot)
// this module only re-renders the markup and leaves the existing handler alone;
// everything new is wired here.

import * as mastering2 from './mastering2.js'
import * as library from './library.js'
import * as shortcuts from './shortcuts.js'
import * as versions from './versions.js'
import { masterChain } from './master.js'

const $ = (id) => document.getElementById(id)

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const pad2 = (n) => String(n).padStart(2, '0')
const mmss = (seconds) => `${Math.floor(seconds / 60)}:${pad2(Math.round(seconds % 60))}`
const slugify = (s) => String(s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'

function openPanel(name) {
  const btn = document.querySelector(`[data-panel-open="p-${name}"]`) ||
    document.querySelector(`.tab[data-drawer="${name}"]`)
  btn?.click()
}

function openModal(name) {
  const el = document.getElementById('m-' + name)
  if (!el) return
  document.querySelectorAll('.menu').forEach((m) => { m.hidden = true })
  el.hidden = false
  el.querySelector('button, input, select')?.focus()
}

function openSubmenu(menu, r) {
  if (!menu) return
  document.querySelectorAll('.menu:not(#menu-more)').forEach((m) => { m.hidden = true })
  menu.hidden = false
  const box = menu.getBoundingClientRect()
  let left = r.right + 4
  if (left + box.width > innerWidth - 12) left = r.left - box.width - 4
  menu.style.left = `${clamp(left, 8, innerWidth - box.width - 12)}px`
  menu.style.top = `${clamp(r.top, 8, innerHeight - box.height - 12)}px`
}

function openMenuAt(menu, anchor) {
  openMenuAtRect(menu, anchor.getBoundingClientRect())
}

function openMenuAtRect(menu, r) {
  document.querySelectorAll('.menu').forEach((m) => { m.hidden = true })
  if (!menu) return
  menu.hidden = false
  const box = menu.getBoundingClientRect()
  menu.style.left = `${clamp(r.left, 8, innerWidth - box.width - 12)}px`
  menu.style.top = `${clamp(r.bottom + 6, 8, innerHeight - box.height - 12)}px`
}

const BINDING_FOR = new Map(shortcuts.BINDINGS.map((b) => [b.action, b]))
const combo = (action) => {
  const b = BINDING_FOR.get(action)
  return b ? shortcuts.format(b) : ''
}

export function install({ state, log }) {
  if ($('menu-more')) return
  state.folders = []
  state.masterAB = false
  state.publish = { title: '', visibility: 'Public', licence: 'All rights reserved' }

  const activeTrack = () => state.tracks.find((t) => t.id === state.active) || state.tracks[0] || null

  // ------------------------------------------------------------- mastering
  function renderMastering() {
    const host = $('p-master')
    if (!host) return
    host.innerHTML = `
      <div class="panel-head">
        <h2>Mastering</h2>
        <button id="btn-analyze" class="pill" type="button">Analyze</button>
        <label class="pill ghost file" role="button" tabindex="0">Reference<input id="file-reference" type="file" accept="audio/*" hidden aria-label="Import a reference track"></label>
        <button id="btn-apply-master" class="pill primary" type="button">Apply</button>
      </div>
      <div class="master-grid">
        <div class="master-col">
          <div class="subhead"><span>Preset</span><span class="hint">eight mastered curves</span></div>
          <div id="master-presets" class="master-presets grid" role="listbox" aria-label="Mastering preset"></div>
          <div class="row master-intensity">
            <label>Intensity <input id="in-intensity" type="range" min="0" max="100" value="50" aria-label="Mastering intensity"></label>
            <output id="out-intensity" aria-live="off">50</output>
            <span class="hint" id="out-intensity-word">Normal</span>
          </div>
        </div>
        <div class="master-col">
          <div class="subhead"><span>EQ · six bands</span><span class="hint" id="eq-gain-note">trim the preset</span></div>
          <div id="eq-bands" class="eq" role="group" aria-label="Mastering EQ bands"></div>
          <label class="check"><input id="in-eq-bypass" type="checkbox"> EQ bypass</label>
        </div>
        <div class="master-col">
          <div class="meterbox">
            <div class="subhead"><span>Dynamics</span><span class="hint">limiter ends the chain</span></div>
            <div class="dyn">
              <label>Threshold <input id="in-thresh" aria-label="Threshold" type="range" min="-60" max="0" value="-18"><output id="out-thresh">-18 dB</output></label>
              <label>Ratio <input id="in-ratio" aria-label="Ratio" type="range" min="1" max="12" value="3" step="0.5"><output id="out-ratio">3:1</output></label>
              <label>Ceiling <input id="in-ceiling" aria-label="Ceiling" type="range" min="-6" max="0" value="-1" step="0.1"><output id="out-ceiling">-1.0 dB</output></label>
              <label>Target <input id="in-target" aria-label="Loudness target" type="range" min="-24" max="-8" value="-14"><output id="out-target">-14 dB</output></label>
            </div>
          </div>
          <div class="tiltblock" hidden>
            <div class="subhead"><span>Tilt</span><span class="hint">±6 dB</span></div>
            <div class="eq3">
              <label>Low <input id="in-low" type="range" min="-6" max="6" value="0" step="0.1" aria-label="Low band gain"><output id="out-low">0.0 dB</output></label>
              <label>Mid <input id="in-mid" type="range" min="-6" max="6" value="0" step="0.1" aria-label="Mid band gain"><output id="out-mid">0.0 dB</output></label>
              <label>High <input id="in-high" type="range" min="-6" max="6" value="0" step="0.1" aria-label="High band gain"><output id="out-high">0.0 dB</output></label>
            </div>
          </div>
          <div class="meterbox">
            <div class="subhead"><span>Analyze</span><span class="hint" id="master-readout" role="status" aria-live="polite">not analysed</span></div>
            <div class="meterrow">
              <dl id="meter" class="meter">
                <dt>peak</dt><dd id="meter-peak">--</dd>
                <dt>loudness</dt><dd id="meter-rms">--</dd>
                <dt>gain</dt><dd id="meter-gain">--</dd>
              </dl>
              <button id="btn-ab" class="pill ghost ab" type="button" aria-pressed="false" aria-label="A/B compare against the bypassed curve">B · bypass</button>
            </div>
            <span class="hint" id="ab-hint">A is the mastered curve</span>
          </div>
        </div>
      </div>`

    $('master-presets').innerHTML = mastering2.PRESETS.map((p) => `
      <button type="button" role="option" data-mpreset="${p.slug}" aria-selected="false" title="${esc(p.desc)}">
        <b>${esc(p.name)}</b><i>${esc(p.desc)}</i>
      </button>`).join('')

    const bands = Array.isArray(state.bands) ? state.bands : []
    $('eq-bands').innerHTML = bands.map((band, i) => `
      <div class="band">
        <span class="bhead"><b>${esc(band.kind)}</b><output class="fq">${Math.round(band.freq)} Hz</output></span>
        <span class="bsliders">
          <input type="range" min="30" max="16000" step="1" value="${band.freq}" data-band-freq="${i}" aria-label="${esc(band.kind)} frequency" title="Frequency (Hz)">
          <input type="range" min="-12" max="12" step="0.1" value="${band.gainDb}" data-band-gain="${i}" aria-label="${esc(band.kind)} gain" title="Gain (dB)">
          <output class="bgain">${Number(band.gainDb).toFixed(1)} dB</output>
        </span>
      </div>`).join('') || '<p class="hint">no EQ bands</p>'

    $('master-presets').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mpreset]')
      if (!b) return
      state.masterState = mastering2.setPreset(state.masterState, b.dataset.mpreset)
      paintMaster()
      log(`mastering preset: ${mastering2.presetBySlug(b.dataset.mpreset).name}`)
    })
    $('in-intensity').addEventListener('input', (e) => {
      state.masterState = mastering2.setIntensity(state.masterState, Number(e.target.value) / 100)
      paintMaster()
    })
    for (const id of ['low', 'mid', 'high']) {
      $(`in-${id}`).addEventListener('input', (e) => {
        state.masterState = mastering2.setBand(state.masterState, id, Number(e.target.value))
        $(`out-${id}`).textContent = `${state.masterState[id].toFixed(1)} dB`
      })
    }
    $('in-eq-bypass').addEventListener('change', (e) => {
      state.masterState.eqBypass = e.target.checked
      paintMaster()
    })
    $('eq-bands').addEventListener('input', (e) => {
      const f = e.target.dataset.bandFreq
      const g = e.target.dataset.bandGain
      if (f == null && g == null) return
      const band = state.bands[Number(f ?? g)]
      if (!band) return
      const row = e.target.closest('.band')
      if (f != null) {
        band.freq = clamp(Number(e.target.value), 30, 16000)
        row.querySelector('.fq').textContent = `${Math.round(band.freq)} Hz`
      } else {
        band.gainDb = clamp(Number(e.target.value), -12, 12)
        row.querySelector('.bgain').textContent = `${band.gainDb.toFixed(1)} dB`
      }
    })
    for (const [id, unit] of [['thresh', ' dB'], ['ratio', ':1'], ['ceiling', ' dB'], ['target', ' dB']]) {
      $(`in-${id}`).addEventListener('input', (e) => {
        $(`out-${id}`).textContent = `${e.target.value}${unit}`
        if (id === 'ceiling') {
          $('in-master-ceiling').value = e.target.value
          $('out-master-ceiling').textContent = `${Number(e.target.value).toFixed(1)} dB`
        }
      })
    }
    $('btn-ab').addEventListener('click', () => {
      const on = $('btn-ab').getAttribute('aria-pressed') !== 'true'
      if (Boolean(state.masterState.bypass) !== on) state.masterState = mastering2.toggleBypass(state.masterState)
      paintMaster()
    })
    $('btn-analyze').addEventListener('click', analyseMaster)
    $('btn-apply-master').addEventListener('click', applyMaster)
    $('file-reference').addEventListener('change', importReference)
    paintMaster()
  }

  function paintMaster() {
    const s = state.masterState
    document.querySelectorAll('[data-mpreset]').forEach((b) => {
      const on = b.dataset.mpreset === s.preset
      b.classList.toggle('on', on)
      b.setAttribute('aria-selected', String(on))
    })
    $('in-intensity').value = String(Math.round(s.intensity * 100))
    $('out-intensity').textContent = String(Math.round(s.intensity * 100))
    $('out-intensity-word').textContent = mastering2.intensityLabel(s.intensity)
    for (const id of ['low', 'mid', 'high']) {
      $(`in-${id}`).value = String(s[id])
      $(`out-${id}`).textContent = `${s[id].toFixed(1)} dB`
    }
    $('in-eq-bypass').checked = s.eqBypass
    const ab = Boolean(s.bypass)
    const btn = $('btn-ab')
    btn.setAttribute('aria-pressed', String(ab))
    btn.textContent = ab ? 'A · mastered' : 'B · bypass'
    $('ab-hint').textContent = ab ? 'B is the bypassed curve' : 'A is the mastered curve'
    $('p-master').classList.toggle('master-bypass', ab)
    $('master-preset-label').textContent = mastering2.presetBySlug(s.preset).name
  }

  function analyseMaster() {
    if (!state.take?.length) { log('mastering: record or load a take first'); return }
    const stereo = { left: Float32Array.from(state.take), right: Float32Array.from(state.take) }
    const { report } = masterChain(stereo, {
      eq: state.bands.map((b) => ({ ...b })),
      comp: { thresholdDb: Number($('in-thresh').value), ratio: Number($('in-ratio').value), attackMs: 8, releaseMs: 140, makeupDb: 0 },
      limitDb: Number($('in-ceiling').value),
      targetRmsDb: Number($('in-target').value),
      vocalGainDb: Number($('in-gain').value),
    }, state.sampleRate || 48000)
    $('meter-peak').textContent = Number.isFinite(report.peakDb) ? `${report.peakDb.toFixed(1)} dB` : '-inf'
    $('meter-rms').textContent = Number.isFinite(report.rmsDb) ? `${report.rmsDb.toFixed(1)} dB` : '-inf'
    $('meter-gain').textContent = `${report.gainDb.toFixed(1)} dB`
    $('meter-peak').className = report.peakDb > -1 ? 'hot' : ''
    $('meter-rms').className = Math.abs(report.rmsDb - Number($('in-target').value)) <= 1 ? 'good' : ''
    $('master-readout').textContent = `analysed ${mmss(state.take.length / (state.sampleRate || 48000))}`
    log(`mastering analyse: peak ${report.peakDb.toFixed(1)} dB, loudness ${report.rmsDb.toFixed(1)} dB, gain ${report.gainDb.toFixed(1)} dB`)
  }

  function applyMaster() {
    const g = mastering2.effectiveGains(state.masterState)
    if (state.bands[1]) state.bands[1].gainDb = g.low
    if (state.bands[3]) state.bands[3].gainDb = g.mid
    if (state.bands[5]) state.bands[5].gainDb = g.high
    renderMastering()
    paintMaster()
    log(`master: ${mastering2.presetBySlug(state.masterState.preset).name} @ ${mastering2.intensityLabel(state.masterState.intensity)} — low ${g.low.toFixed(1)}, mid ${g.mid.toFixed(1)}, high ${g.high.toFixed(1)} dB`)
    $('status').textContent = 'mastered'
  }

  async function importReference(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const chans = [buf.getChannelData(0), buf.getChannelData(1) || buf.getChannelData(0)]
    const res = mastering2.analyseReference(chans, buf.sampleRate)
    ctx.close()
    state.masterState.low = res.low
    state.masterState.mid = res.mid
    state.masterState.high = res.high
    state.masterState = mastering2.setIntensity(state.masterState, res.intensity)
    paintMaster()
    log(`reference analysed: low ${res.low.toFixed(1)}, mid ${res.mid.toFixed(1)}, high ${res.high.toFixed(1)} dB`)
    $('master-readout').textContent = `reference: ${file.name}`
    e.target.value = ''
  }

  // ------------------------------------------------------------- my sounds
  function packLength(pack) {
    const sample = library.byPack(pack.slug)[0]
    if (!sample) return `${pack.bars ?? 1} bars`
    try { return `${pack.bars ?? 1} bars · ${mmss(library.durationSeconds(sample, sample.bpm))}` } catch { return `${pack.bars ?? 1} bars` }
  }

  function renderPacks() {
    const host = $('pack-list')
    if (!host) return
    const cat = $('sound-cats')?.querySelector('button.on')?.dataset.scat || $('in-sound-cat').value || library.CATEGORIES[0].slug
    const q = $('in-sound-search').value.trim().toLowerCase()
    let packs = library.PACKS.filter((p) => p.category === cat)
    if (q) packs = library.PACKS.filter((p) => `${p.name} ${p.author}`.toLowerCase().includes(q))
    host.className = 'packs packlist'
    host.innerHTML = packs.map((p) => `
      <div class="packrow${p.locked ? ' member' : ''}" role="listitem">
        <span class="swatch" style="background:linear-gradient(135deg, ${p.art[0]}, ${p.art[1]})" aria-hidden="true"></span>
        <span class="meta"><b>${esc(p.name)}</b><i>${esc(p.author)} · ${packLength(p)}</i></span>
        <span class="tier" title="${p.tier === 'free' ? 'free pack' : 'membership pack'}">${p.tier === 'free' ? 'Free' : '♥ Pro'}</span>
        <button class="pill ghost tiny" type="button" data-add-pack="${p.slug}" aria-label="Add ${esc(p.name)} to the active track">Add</button>
      </div>`).join('') || '<p class="hint">no packs in this category</p>'
  }

  function paintClips(t) {
    /* the static first row keeps its placeholder data-row="1" */
    const row = document.querySelector(`[data-row="${t.id}"]`) ||
      (t === state.tracks[0] ? document.querySelector('[data-row="1"]') : null)
    if (!row) return
    let box = row.querySelector('.lane-clips')
    if (!box) { box = document.createElement('div'); box.className = 'lane-clips'; row.append(box) }
    box.innerHTML = (t.clips || []).map((c, i) => `
      <span class="clipmini">${esc(c.name)} · ${c.bars} bars
        <button class="ic mini" type="button" data-clip-del="${i}" aria-label="Remove ${esc(c.name)}"><span data-icon="close" aria-hidden="true"></span></button>
      </span>`).join('')
  }

  $('pack-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add-pack]')
    if (!b) return
    const pack = library.PACKS.find((p) => p.slug === b.dataset.addPack)
    if (!pack) return
    if (pack.locked && !state.member) {
      log(`${pack.name} is a membership pack`)
      openModal('get')
      return
    }
    const sample = library.byPack(pack.slug)[0]
    const t = activeTrack()
    if (!sample || !t) return
    const barSeconds = (60 / Number($('in-bpm').value)) * 4
    t.clips = t.clips || []
    t.clips.push({ slug: sample.slug, name: sample.name, bars: pack.bars ?? 1, at: Math.max(0, Math.round(state.playhead / barSeconds)) })
    t.clip.lengthBeats = (pack.bars ?? 1) * 4
    paintClips(t)
    log(`added "${sample.name}" to ${t.name} at bar ${Math.max(1, Math.round(state.playhead / barSeconds) + 1)}`)
    $('status').textContent = 'clip added'
  })

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-clip-del]')
    if (!b) return
    const row = b.closest('.lane-row')
    const t = state.tracks.find((x) => x.id === row?.dataset.row)
    if (!t?.clips) return
    t.clips.splice(Number(b.dataset.clipDel), 1)
    paintClips(t)
  })

  $('pack-list').insertAdjacentHTML('beforebegin', '<div class="subhead"><span>Packs</span><span class="hint">add drops a clip</span></div>')
  $('sound-list').insertAdjacentHTML('beforebegin', '<div class="subhead"><span>Samples</span><span class="hint">heart to save</span></div>')

  // studio repaints the pack cards on every search / category change; repaint
  // the richer rows right after it.
  for (const id of ['in-sound-search', 'sound-cats', 'in-sound-cat']) {
    $(id).addEventListener('input', renderPacks)
    $(id).addEventListener('click', renderPacks)
    $(id).addEventListener('change', renderPacks)
  }

  // ------------------------------------------------------------- versions
  function renderVersions() {
    const host = $('version-list')
    if (!host) return
    host.innerHTML = state.versions.map((v) => `
      <div class="ver" role="listitem">
        <b>${esc(v.label)}</b>
        <span title="${esc(new Date(v.at).toLocaleString())}">${esc(versions.relativeTime(v.at))}</span>
        <button class="pill ghost tiny" type="button" data-restore="${v.id}" aria-label="Restore ${esc(v.label)} from ${esc(new Date(v.at).toLocaleString())}">Restore</button>
      </div>`).join('') || '<p class="hint">no versions yet — Save version snapshots the session</p>'
  }

  $('btn-snapshot').addEventListener('click', () => setTimeout(renderVersions, 0))

  // ------------------------------------------------------------- chat
  if (state.chat.length === 0) {
    state.chat.push({ who: 'Apollo', text: 'Session chat — anyone you invite sees this thread.' })
  }
  function renderChat() {
    $('chat-log').innerHTML = state.chat.map((c) => `<p><b>${esc(c.who)}</b> ${esc(c.text)}</p>`).join('')
    $('chat-log').scrollTop = $('chat-log').scrollHeight
  }
  $('btn-chat-send').addEventListener('click', () => setTimeout(renderChat, 0))
  $('in-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') setTimeout(renderChat, 0) })

  // ------------------------------------------------------------- lyrics
  const lyricsKey = () => `apollo.lyrics.${slugify($('proj-name').value)}`

  function hydrateLyrics() {
    let saved = null
    try { saved = JSON.parse(localStorage.getItem(lyricsKey()) || 'null') } catch { saved = null }
    $('in-lyrics').value = saved?.text || ''
    if (Array.isArray(saved?.lines)) state.lyrics = saved.lines.filter((l) => Number.isFinite(l?.t) && typeof l?.text === 'string')
    renderLyricList()
  }
  function persistLyrics() {
    try {
      localStorage.setItem(lyricsKey(), JSON.stringify({
        text: $('in-lyrics').value,
        lines: state.lyrics.map((l) => ({ t: l.t, text: l.text })),
      }))
    } catch { /* storage full or blocked */ }
  }
  function renderLyricList() {
    $('lyric-list').innerHTML = state.lyrics.map((l, i) => `
      <div class="note" role="listitem"><span>${l.t.toFixed(2)}s</span><span>${esc(l.text)}</span><span></span>
        <button type="button" aria-label="Delete line ${i + 1}" data-lyric-del="${i}">Del</button></div>`).join('')
    $('lyrics-count').textContent = `${state.lyrics.length} line${state.lyrics.length === 1 ? '' : 's'}`
  }
  $('in-lyrics').addEventListener('input', () => {
    const n = $('in-lyrics').value.split('\n').filter(Boolean).length
    $('lyrics-count').textContent = `${n} line${n === 1 ? '' : 's'}`
    persistLyrics()
  })
  $('btn-mark-line').textContent = 'Timestamp'
  $('btn-mark-line').setAttribute('aria-label', 'Timestamp the last line at the playhead')
  $('btn-mark-line').addEventListener('click', () => setTimeout(() => { persistLyrics(); renderLyricList() }, 0))
  $('btn-clear-lyrics').addEventListener('click', () => setTimeout(() => { persistLyrics(); renderLyricList() }, 0))
  $('lyric-list').addEventListener('click', (e) => { if (e.target.closest('[data-lyric-del]')) setTimeout(persistLyrics, 0) })
  $('proj-name').addEventListener('change', hydrateLyrics)
  hydrateLyrics()

  // ------------------------------------------------------------- publish
  const publishHead = $('m-publish').querySelector('.sheet-head')
  publishHead.insertAdjacentHTML('afterend', `
    <div class="publish-meta">
      <label class="field">Title <input id="in-publish-title" class="chatin" type="text" maxlength="80" aria-label="Published title" placeholder="Untitled project"></label>
      <label class="field">Visibility <select id="in-publish-vis" aria-label="Visibility">
        <option value="Public" selected>Public — anyone can hear it</option>
        <option value="Unlisted">Unlisted — link only</option>
        <option value="Private">Private — collaborators only</option>
      </select></label>
      <label class="field">Licence <select id="in-publish-licence" aria-label="Licence">
        <option value="All rights reserved" selected>All rights reserved</option>
        <option value="CC BY 4.0">Creative Commons BY 4.0</option>
        <option value="CC BY-NC 4.0">Creative Commons BY-NC 4.0</option>
      </select></label>
    </div>`)
  $('btn-publish').addEventListener('click', () => {
    $('in-publish-title').value = $('proj-name').value || 'Untitled project'
    openModal('publish')
  })
  $('btn-publish-confirm').addEventListener('click', () => {
    state.publish = {
      title: $('in-publish-title').value.trim() || $('proj-name').value || 'Untitled project',
      visibility: $('in-publish-vis').value,
      licence: $('in-publish-licence').value,
    }
    log(`publish: "${state.publish.title}" · ${state.publish.visibility} · ${state.publish.licence}`)
  })

  // ------------------------------------------------------------- invite
  const inviteRow = $('btn-invite').closest('.row')
  $('btn-invite').insertAdjacentHTML('beforebegin', `
    <label class="field inline">Role <select id="in-invite-role" aria-label="Collaborator role">
      <option value="Editor" selected>Editor</option>
      <option value="Commenter">Commenter</option>
      <option value="Viewer">Viewer</option>
    </select></label>`)
  $('in-invite').setAttribute('placeholder', 'Username or email')
  $('btn-invite').textContent = 'Invite'
  $('btn-invite').setAttribute('aria-label', 'Send the invite')
  $('btn-invite').addEventListener('click', () => {
    const who = $('in-invite').value.trim()
    log(`invite: ${who || 'link'} as ${$('in-invite-role').value}`)
  })
  const inviteCount = $('m-invite').querySelector('.hint')
  $('in-invite-msg').addEventListener('input', (e) => {
    inviteCount.textContent = `Message · ${e.target.value.length}/256`
  })
  $('btn-copy-link').addEventListener('click', () => { $('btn-copy-link').textContent = 'Copied' })

  // ------------------------------------------------------------- folders
  const rail = document.querySelector('.rail')
  const folders = document.createElement('div')
  folders.id = 'rail-folders'
  folders.className = 'folders'
  folders.setAttribute('role', 'list')
  folders.setAttribute('aria-label', 'Folders')
  rail.insertBefore(folders, rail.querySelector('.track-head'))

  function renderFolders() {
    folders.innerHTML = state.folders.map((f, i) => `
      <div class="folder" role="listitem">
        <span aria-hidden="true">&#128193;</span><b>${esc(f.name)}</b><span>0 tracks</span>
        <button class="ic mini" type="button" data-folder-del="${i}" aria-label="Delete ${esc(f.name)}"><span data-icon="close" aria-hidden="true"></span></button>
      </div>`).join('')
  }
  folders.addEventListener('click', (e) => {
    const b = e.target.closest('[data-folder-del]')
    if (!b) return
    state.folders.splice(Number(b.dataset.folderDel), 1)
    renderFolders()
  })

  // ------------------------------------------------------------- create
  $('menu-create').innerHTML = `
    <button role="menuitem" type="button" data-create="project">New project</button>
    <button role="menuitem" type="button" data-create="folder">New folder</button>
    <button role="menuitem" type="button" data-create="duplicate">Duplicate project</button>`

  function newProject() {
    state.notes = []
    state.lyrics = []
    state.chat = [{ who: 'Apollo', text: 'Session chat — anyone you invite sees this thread.' }]
    state.versions = []
    state.folders = []
    state.playhead = 0
    $('proj-name').value = 'untitled'
    $('in-lyrics').value = ''
    state.studio?.renderAll?.()
    state.studio?.drawRoll?.()
    state.tracks.forEach(paintClips)
    renderFolders()
    renderVersions()
    renderChat()
    renderLyricList()
    persistLyrics()
    log('new project')
  }

  function newFolder() {
    state.folders.push({ name: `Folder ${state.folders.length + 1}`, at: Date.now() })
    renderFolders()
    log('folder created')
  }

  function duplicateProject() {
    const copy = JSON.parse(JSON.stringify({ bpm: Number($('in-bpm').value), notes: state.notes, tracks: state.tracks }))
    try { localStorage.setItem(`apollo.dupe.${Date.now()}`, JSON.stringify(copy)) } catch { /* storage blocked */ }
    state.notes = copy.notes
    state.tracks = copy.tracks
    state.playhead = 0
    $('proj-name').value = `${$('proj-name').value || 'untitled'} copy`
    state.studio?.renderAll?.()
    state.studio?.drawRoll?.()
    state.tracks.forEach(paintClips)
    hydrateLyrics()
    log(`project duplicated: ${$('proj-name').value}`)
  }

  $('menu-create').addEventListener('click', (e) => {
    const b = e.target.closest('[data-create]')
    if (!b) return
    if (b.dataset.create === 'project') newProject()
    if (b.dataset.create === 'folder') newFolder()
    if (b.dataset.create === 'duplicate') duplicateProject()
    $('menu-create').hidden = true
    $('menu-more').hidden = true
  })

  // ------------------------------------------------------------- more
  const more = document.createElement('div')
  more.id = 'menu-more'
  more.className = 'menu'
  more.setAttribute('role', 'menu')
  more.setAttribute('aria-label', 'More studio actions')
  more.hidden = true
  more.innerHTML = [
    ['addtrack', 'Add Track', 'project.newTrack'],
    ['demo', 'Load Demo Take', ''],
    ['fx', 'Fx', 'view.effects'],
    ['arm', 'Arm Automation', 'tools.armAutomation'],
    ['automation', 'Show/Hide Automation', 'tools.toggleAutomation'],
    ['stretch', 'Toggle Region Stretch', 'tools.stretch'],
    ['mixer', 'Mixer', 'view.mixer'],
    ['editor', 'Editor', 'tools.openEditor'],
    ['autopitch', 'AutoPitch', ''],
    ['mastering', 'Mastering', ''],
    ['sounds', 'My Sounds', 'view.sounds'],
    ['lyrics', 'Lyrics/Notes', 'view.lyrics'],
    ['versions', 'Versions', 'project.history'],
    ['chat', 'Chat', ''],
    ['create', 'Create', ''],
    ['shortcuts', 'Shortcuts', 'special.shortcuts'],
    ['publish', 'Publish', 'project.publish'],
    ['invite', 'Invite', ''],
  ].map(([key, label, action]) => `
    <button role="menuitem" type="button" data-more="${key}">
      <span data-icon="${key}" aria-hidden="true"></span><span>${esc(label)}</span>${action && combo(action) ? `<kbd>${esc(combo(action))}</kbd>` : ''}
    </button>`).join('')
  for (const key of ['mixer', 'create']) {
    more.querySelector(`[data-more="${key}"]`)?.insertAdjacentHTML('beforebegin', '<div class="msep" role="separator"></div>')
  }
  const createItem = more.querySelector('[data-more="create"]')
  createItem.setAttribute('aria-haspopup', 'menu')
  createItem.insertAdjacentHTML('beforeend', '<span class="subchev" aria-hidden="true">&#8250;</span>')
  document.body.append(more)

  const moreBtn = document.createElement('button')
  moreBtn.className = 'ic'
  moreBtn.type = 'button'
  moreBtn.id = 'btn-more'
  moreBtn.dataset.menu = 'more'
  moreBtn.setAttribute('aria-label', 'More studio actions')
  moreBtn.setAttribute('aria-haspopup', 'menu')
  moreBtn.setAttribute('aria-expanded', 'false')
  moreBtn.innerHTML = '<span data-icon="dots-h" aria-hidden="true"></span>'
  rail.querySelector('.rail-head').append(moreBtn)

  moreBtn.addEventListener('click', () => {
    const open = more.hidden
    document.querySelectorAll('.menu').forEach((m) => { m.hidden = true })
    more.hidden = !open
    moreBtn.setAttribute('aria-expanded', String(open))
    if (!open) return
    const r = moreBtn.getBoundingClientRect()
    const box = more.getBoundingClientRect()
    more.style.left = `${clamp(r.left, 8, innerWidth - box.width - 12)}px`
    more.style.top = `${clamp(r.bottom + 6, 8, innerHeight - box.height - 12)}px`
    more.querySelector('[data-more="automation"] span:last-of-type').textContent = state.showAutomation ? 'Hide Automation' : 'Show Automation'
    const fx = more.querySelector('[data-more="fx"]')
    if (fx) fx.disabled = !activeTrack()
  })
  document.addEventListener('click', (e) => {
    if (e.target.closest('#menu-more, #btn-more')) return
    moreBtn.setAttribute('aria-expanded', 'false')
    createItem.removeAttribute('aria-expanded')
  })

  more.addEventListener('click', (e) => {
    const b = e.target.closest('[data-more]')
    if (!b) return
    const key = b.dataset.more
    const anchorRect = b.getBoundingClientRect()
    more.hidden = true
    moreBtn.setAttribute('aria-expanded', 'false')
    if (key === 'addtrack') return openModal('addtrack')
    if (key === 'demo') return $('btn-demo')?.click()
    if (key === 'fx') return state.studio?.fxOpen?.()
    if (key === 'arm') return $('btn-automation-arm').click()
    if (key === 'automation') return $('btn-automation').click()
    if (key === 'stretch') return $('btn-stretch').click()
    if (key === 'mixer') return $('btn-mixer').click()
    if (key === 'create') {
      more.hidden = false
      createItem.setAttribute('aria-expanded', 'true')
      return openSubmenu($('menu-create'), anchorRect)
    }
    createItem.removeAttribute('aria-expanded')
    if (key === 'shortcuts') return openModal('shortcuts')
    if (key === 'publish') return openModal('publish')
    if (key === 'invite') return openModal('invite')
    if (key === 'sounds') return openPanel('sounds')
    if (key === 'lyrics') return openPanel('lyrics')
    if (key === 'versions') return openPanel('versions')
    if (key === 'chat') return openPanel('chat')
    if (key === 'mastering') return openPanel('master')
    if (key === 'editor') return openPanel('take')
    if (key === 'autopitch') return openPanel('harmony')
  })

  // keep the right-hand tab strip honest about which panel is showing
  document.addEventListener('click', (e) => {
    const sb = e.target.closest('.sb[data-panel-open]')
    if (sb) {
      document.querySelectorAll('.sb[aria-current="page"]').forEach((b) => b.removeAttribute('aria-current'))
      sb.setAttribute('aria-current', 'page')
      return
    }
    if (e.target.closest('.tab[data-drawer]')) {
      document.querySelectorAll('.sb[aria-current="page"]').forEach((b) => b.removeAttribute('aria-current'))
    }
  })

  // ------------------------------------------------------------- shortcuts
  const shortTabs = $('short-tabs')
  shortTabs.setAttribute('aria-label', 'Shortcut groups')
  shortTabs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sgroup]')
    if (!b) return
    shortTabs.querySelectorAll('[role="tab"]').forEach((t) => {
      const on = t === b
      t.classList.toggle('on', on)
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
    })
  })
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal="shortcuts"]')) {
      shortTabs.querySelectorAll('[role="tab"]').forEach((t, i) => {
        t.setAttribute('aria-selected', String(i === 0))
        t.tabIndex = i === 0 ? 0 : -1
      })
    }
  })
  shortTabs.querySelector('[role="tab"]')?.setAttribute('aria-selected', 'true')

  // ------------------------------------------------------------- paint
  renderMastering()
  renderPacks()
  renderVersions()
  renderChat()
  renderFolders()
}
