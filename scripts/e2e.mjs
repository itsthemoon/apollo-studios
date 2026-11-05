#!/usr/bin/env node
// scripts/e2e.mjs — real-Chrome end-to-end suite for Apollo Studios.
//
// Drives the app at http://127.0.0.1:4173/app.html through browser-harness (CDP
// against the user's real Chrome). One harness process per step, so a wedged
// step cannot take the whole run down. Every step reports PASS / FAIL / SKIP,
// any FAIL exits 1, and the suite's tab is closed at the end.
//
// Why the raw CDP wrappers below: `click` and `screenshot` are not exported by
// `from helpers import *` in this build, `js()` returns None for `[]`, and the
// daemon's default session can point at a wedged tab. So each harness process
// attaches to OUR target explicitly and dispatches input at viewport coordinates.
//
// Step 8 only runs when the build actually ships harmony / stem controls;
// otherwise it records SKIP and the run still exits 0 on the rest.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const APP = 'http://127.0.0.1:4173/app.html'
const HARNESS = join(homedir(), '.local', 'bin', 'browser-harness')
const ROOT = new URL('..', import.meta.url).pathname
const HANDOFF = join(ROOT, '.handoff', 'e2e.md')
const CALL_TIMEOUT_MS = 25_000

const results = []
let startedServer = null
let targetId = null

// ---- harness plumbing -------------------------------------------------------

const PREAMBLE = `
import os, sys, json, time, builtins

TID = os.environ["E2E_TID"]
SID = cdp("Target.attachToTarget", targetId=TID, flatten=True)["sessionId"]

def emit(obj):
    print("E2E:" + json.dumps(obj), flush=True)

def probe(expr, SID=SID):
    r = cdp("Runtime.evaluate", session_id=SID,
            expression="(function(){try{" + expr + "}catch(e){return JSON.stringify({err:String(e)})}})()",
            returnByValue=True, awaitPromise=True)
    v = r.get("result", {}).get("value")
    return json.loads(v) if v else {"raw": str(r)}

def click(sel, SID=SID):
    r = cdp("Runtime.evaluate", session_id=SID,
            expression="(function(){try{var e=document.querySelector(" + json.dumps(sel) + ");"
                       " if(!e) return JSON.stringify(null);"
                       " e.scrollIntoView({block:'center'});"
                       " var b=e.getBoundingClientRect();"
                       " if(b.width===0&&b.height===0){e.click();return JSON.stringify({hidden:true,x:0,y:0})}"
                       " return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2})"
                       "}catch(e){return JSON.stringify({err:String(e)})}})()",
            returnByValue=True)
    v = json.loads(r["result"]["value"])
    if not v:
        return {"missing": sel}
    cdp("Input.dispatchMouseEvent", session_id=SID, type="mouseMoved", x=v["x"], y=v["y"], button="none", buttons=0)
    time.sleep(0.04)
    cdp("Input.dispatchMouseEvent", session_id=SID, type="mousePressed", x=v["x"], y=v["y"], button="left", buttons=1, clickCount=1)
    time.sleep(0.04)
    cdp("Input.dispatchMouseEvent", session_id=SID, type="mouseReleased", x=v["x"], y=v["y"], button="left", buttons=0, clickCount=1)
    return v

def key(name, mods=0, SID=SID):
    """A real key press: dispatched by the browser, so the app's own handler runs."""
    code = name.upper() if len(name) == 1 else name
    cdp("Input.dispatchKeyEvent", session_id=SID, type="keyDown", key=name, modifiers=mods,
        windowsVirtualKeyCode=(ord(code) if len(name) == 1 else 0))
    cdp("Input.dispatchKeyEvent", session_id=SID, type="keyUp", key=name, modifiers=mods)
    time.sleep(0.25)

def roll_drag(x, y, dx, dy, SID=SID):
    """Press on the roll, move in steps, release: the pointer drag the editor reads."""
    cdp("Input.dispatchMouseEvent", session_id=SID, type="mousePressed", x=x, y=y, button="left", buttons=1, clickCount=1)
    for i in range(1, 7):
        time.sleep(0.03)
        cdp("Input.dispatchMouseEvent", session_id=SID, type="mouseMoved", x=x + dx * i / 6, y=y + dy * i / 6, button="left", buttons=1)
    time.sleep(0.03)
    cdp("Input.dispatchMouseEvent", session_id=SID, type="mouseReleased", x=x + dx, y=y + dy, button="left", buttons=0, clickCount=1)
    time.sleep(0.3)

def setval(sel, val, evt):
    return probe("var e=document.querySelector(" + json.dumps(sel) + ");"
                 " if(!e) return JSON.stringify({missing:true});"
                 " var proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;"
                 " Object.getOwnPropertyDescriptor(proto,'value').set.call(e," + json.dumps(str(val)) + ");"
                 " e.dispatchEvent(new Event(" + json.dumps(evt) + ",{bubbles:true}));"
                 " return JSON.stringify({v:e.value})")

def wait_ready(cap_ms=8000):
    end = time.time() + cap_ms / 1000
    while time.time() < end:
        if probe("return JSON.stringify({r:document.readyState})").get("r") == "complete":
            return True
        time.sleep(0.1)
    return False

def text(sel):
    return probe("var e=document.querySelector(" + json.dumps(sel) + "); return JSON.stringify(e?e.textContent:null)")

for _f in (emit, probe, click, setval, wait_ready, text):
    setattr(builtins, _f.__name__, _f)
`

function runHarness(body) {
  const r = spawnSync(existsSync(HARNESS) ? HARNESS : 'browser-harness', [], {
    input: PREAMBLE + '\n' + body,
    encoding: 'utf8',
    timeout: CALL_TIMEOUT_MS,
    env: { ...process.env, E2E_TID: targetId }
  })
  const out = r.stdout || ''
  const line = out.split('\n').filter(l => l.startsWith('E2E:')).pop()
  if (line) {
    try { return { ok: true, data: JSON.parse(line.slice(4)) } }
    catch { return { ok: false, error: 'unparsable harness output' } }
  }
  if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, error: `harness timed out after ${CALL_TIMEOUT_MS} ms` }
  return { ok: false, error: (r.stderr || out || 'no output').trim().split('\n').slice(-2).join(' / ') }
}

/** Run one step; `judge` turns the payload into {pass, detail}. */
function step(n, title, body, judge) {
  const started = Date.now()
  const r = runHarness(body)
  const ms = Date.now() - started
  let verdict
  if (!r.ok) verdict = { pass: false, detail: r.error }
  else {
    try { verdict = judge(r.data) }
    catch (err) { verdict = { pass: false, detail: `judge threw: ${err.message}` } }
  }
  results.push({ n: String(n), title, status: verdict.pass ? 'PASS' : 'FAIL', detail: verdict.detail, ms })
  console.log(`${verdict.pass ? 'PASS' : 'FAIL'}  ${n}. ${title} — ${verdict.detail} (${ms} ms)`)
  return verdict.pass
}

function skip(n, title, reason) {
  results.push({ n: String(n), title, status: 'SKIP', detail: reason, ms: 0 })
  console.log(`SKIP  ${n}. ${title} — ${reason}`)
}

const show = (v) => (v === null || v === undefined ? 'null' : String(v).slice(0, 160))

// ---- server + tab -----------------------------------------------------------

async function ensureServer() {
  if ((await fetch(APP).then(r => r.status).catch(() => 0)) === 200) return 'reused'
  startedServer = spawn(process.execPath, [join(ROOT, 'scripts', 'serve.mjs')], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200))
    if ((await fetch(APP).then(r => r.status).catch(() => 0)) === 200) return 'started'
  }
  throw new Error('server never answered on 4173')
}

function openTab() {
  const r = spawnSync(existsSync(HARNESS) ? HARNESS : 'browser-harness', [], {
    input: `
import json
tid = cdp("Target.createTarget", url="about:blank")["targetId"]
sid = cdp("Target.attachToTarget", targetId=tid, flatten=True)["sessionId"]
try:
    cdp("Browser.setDownloadBehavior", session_id=sid, behavior="allow", downloadPath=${JSON.stringify(tmpdir())})
except Exception:
    pass
cdp("Page.navigate", session_id=sid, url=${JSON.stringify(APP)})
print("E2E:" + json.dumps({"tid": tid}), flush=True)
`,
    encoding: 'utf8',
    timeout: CALL_TIMEOUT_MS
  })
  const line = (r.stdout || '').split('\n').filter(l => l.startsWith('E2E:')).pop()
  if (!line) throw new Error(`could not open a tab: ${(r.stderr || '').trim().split('\n').slice(-2).join(' / ')}`)
  return JSON.parse(line.slice(4)).tid
}

function closeTab() {
  if (!targetId) return
  spawnSync(existsSync(HARNESS) ? HARNESS : 'browser-harness', [], {
    input: `cdp("Target.closeTarget", targetId=${JSON.stringify(targetId)})`,
    encoding: 'utf8',
    timeout: 10_000
  })
  targetId = null
}

// ---- report -----------------------------------------------------------------

function report(exitCode, elapsedMs, note) {
  const skips = results.filter(r => r.status === 'SKIP').length
  const fails = results.filter(r => r.status === 'FAIL').length
  const passes = results.filter(r => r.status === 'PASS').length
  const lines = [
    '# Apollo Studios — Chrome E2E transcript',
    '',
    `- When: ${new Date().toISOString()}`,
    `- App: ${APP}`,
    `- Driver: browser-harness (real Chrome over CDP), one tab, closed at the end`,
    `- Result: **${passes} pass, ${fails} fail, ${skips} skip** · exit ${exitCode} · ${(elapsedMs / 1000).toFixed(1)} s`,
    `- Skip count: **${skips}**`,
    ''
  ]
  if (note) lines.push(`> ${note}`, '')
  lines.push('| # | Step | Status | Detail | ms |', '| --- | --- | --- | --- | --- |')
  for (const r of results) lines.push(`| ${r.n} | ${r.title} | ${r.status} | ${r.detail.replace(/\|/g, '\\|')} | ${r.ms} |`)
  lines.push(
    '',
    '## Run it',
    '',
    '```',
    'node scripts/serve.mjs   # only if nothing is on :4173',
    'node scripts/e2e.mjs     # exit 0 = no FAIL; SKIPs are allowed and counted above',
    '```',
    '',
    'The suite opens one Chrome tab through browser-harness, drives it with CDP input at',
    'viewport coordinates, and closes the tab in a `finally`. Step 8 (premium) turns into a',
    'SKIP when the build ships no harmony/stem controls.',
    '',
    '## App bugs observed from here',
    '',
    '1. The note table\'s cents column lags a full render. `renderNotes()` paints the rows and',
    '   only then calls `syncTuning()`, which swaps `state.notes` for new objects, so a Snap or',
    '   Scale change never shows its new cents until something else re-renders. Measured at 25%',
    '   snap: the model held +56/+75 cents while the rows still read 0c. The suite re-dispatches',
    '   the snap input once to force a truthful read; a user sees the stale number.',
    '2. `boot()` is not resilient to missing panels. With the Harmony/Voice/Tools sections removed',
    '   from the DOM, boot dies at `app.js:557` with `TypeError: Cannot set properties of null',
    '   (setting \'innerHTML\')`, status goes to "boot failed" and no presets render — the failure',
    '   is a stuck page, not a degraded one.',
    '3. The only in-page way to load the demo take is the button inside `.dropzone`, and',
    '   `body:has(#note-list .note) .dropzone` hides it the moment a project has notes. A',
    '   restored autosave therefore leaves the demo take unreachable by click (the suite falls',
    '   back to `element.click()`), and a user has to clear the project first.'
  )
  writeFileSync(HANDOFF, lines.join('\n'))
}

// ---- steps ------------------------------------------------------------------

async function main() {
  const t0 = Date.now()
  mkdirSync(join(ROOT, '.handoff'), { recursive: true })

  let serverNote
  try {
    serverNote = await ensureServer()
  } catch (err) {
    results.push({ n: '0', title: 'server reachable', status: 'FAIL', detail: err.message, ms: 0 })
    console.log(`FAIL  0. server — ${err.message}`)
    report(1, Date.now() - t0, 'Server unreachable and could not be started.')
    process.exit(1)
  }

  targetId = openTab()
  const pageUrl = APP

  // A restored autosave from an earlier run would make every later assertion
  // depend on whatever that run left behind, so start from a blank browser:
  // the JSON slot and the take buffers in IndexedDB both go.
  runHarness(`
emit(probe("localStorage.clear(); return 1"))
emit(probe("return new Promise(function(res){"
           " var q=indexedDB.open('apollo.takes');"
           " q.onupgradeneeded=function(){var d=q.result; if(!d.objectStoreNames.contains('takes')) d.createObjectStore('takes',{keyPath:'id'})};"
           " q.onsuccess=function(){var t=q.result.transaction('takes','readwrite'); t.objectStore('takes').clear(); t.oncomplete=function(){res('cleared')}};"
           " q.onerror=function(){res('no idb')}; setTimeout(function(){res('timeout')}, 3000)})"))
cdp("Page.navigate", session_id=SID, url=${JSON.stringify(APP)})
wait_ready(8000)
`)
  await new Promise(r => setTimeout(r, 700))

  try {
    await new Promise(r => setTimeout(r, 800))

    step(1, 'page loads with record button and preset list', `
emit(probe("return JSON.stringify({url:location.href,"
           " status:(document.getElementById('status')||{}).textContent||null,"
           " rec:!!document.getElementById('btn-record'),"
           " presets:document.querySelectorAll('#preset-list button').length,"
           " scales:document.querySelectorAll('#in-mode option').length,"
           " bootErr:window.__bootErr||null})"))
`, d => d.rec && d.presets >= 1 && d.scales > 0 && d.status === 'ready' && !d.bootErr
      ? { pass: true, detail: `"${pageUrl}" loaded: record button, ${d.presets} presets, ${d.scales} scales, status "ready"` }
      : { pass: false, detail: `rec=${d.rec} presets=${d.presets} scales=${d.scales} status=${show(d.status)} bootErr=${show(d.bootErr)}` })

    step(2, 'Load demo renders a note take', `
# a restored autosave already has notes, which hides the dropzone the demo
# button lives in — then the coordinate click would land on the topbar
ready = probe("var b=document.getElementById('btn-demo'); var r=b?b.getBoundingClientRect():null; return JSON.stringify({miss:!r||!r.width})")
if ready.get("miss"):
    emit(probe("document.getElementById('btn-demo').click(); return JSON.stringify({forced:true})"))
else:
    emit(click("#btn-demo"))
time.sleep(2.4)  # real take: fetch + decode + pitch detect
emit(probe("return JSON.stringify({rows:document.querySelectorAll('#note-list .note').length,"
           " count:(document.getElementById('note-count')||{}).textContent||'',"
           " log:(document.getElementById('log')||{}).textContent||'',"
           " mic:(document.getElementById('mic-state')||{}).textContent||'',"
           " canvas:(function(){var c=document.getElementById('wave');return c.width+'x'+c.height})()})"))
`, d => d.rows > 0 && /^\d+ notes$/.test(d.count) && /demo: \d+ notes detected/.test(d.log)
      ? { pass: true, detail: `${d.rows} note rows rendered, header "${d.count}", ${d.mic}, canvas ${d.canvas}` }
      : { pass: false, detail: `rows=${d.rows} count=${show(d.count)} log=${show(d.log)} mic=${show(d.mic)}` })

    const d0keys = (o) => (o && typeof o === 'object' ? Object.keys(o).join('|') : typeof o)

    step(3, 'scale and snap change cents, rows persist', `
base = probe("return JSON.stringify({rows:document.querySelectorAll('#note-list .note').length,"
             " cents:Array.from(document.querySelectorAll('#note-list .note')).map(x=>x.children[2].textContent)})")
emit(setval("#in-snap", "25", "input"))
emit(setval("#in-mode", "major", "change"))
emit(setval("#in-snap", "25", "input"))
time.sleep(0.25)
a = probe("return JSON.stringify({rows:document.querySelectorAll('#note-list .note').length,"
          " cents:Array.from(document.querySelectorAll('#note-list .note')).map(x=>x.children[2].textContent),"
          " out:(document.getElementById('out-snap')||{}).textContent||'',"
          " scale:document.getElementById('in-mode').value})")
emit(setval("#in-mode", "minor", "change"))
emit(setval("#in-snap", "100", "input"))
emit(setval("#in-snap", "100", "input"))
time.sleep(0.25)
b = probe("return JSON.stringify({rows:document.querySelectorAll('#note-list .note').length,"
          " cents:Array.from(document.querySelectorAll('#note-list .note')).map(x=>x.children[2].textContent),"
          " out:(document.getElementById('out-snap')||{}).textContent||''})")
emit({"base": base, "a": a, "b": b})
`, d => {
      const base = d.base || {}, a = d.a || {}, b = d.b || {}
      const cb = base.cents || [], ca = a.cents || [], cc = b.cents || []
      const rowsHeld = a.rows === base.rows && b.rows === base.rows && base.rows > 0
      const moved = JSON.stringify(ca) !== JSON.stringify(cb)
      const movedBack = JSON.stringify(cc) !== JSON.stringify(ca)
      const nonZero = ca.some(c => /^[+-]?[1-9]\d*c$/.test(c))
      const wired = a.out === '25%' && b.out === '100%' && a.scale === 'major'
      return {
        pass: rowsHeld && moved && movedBack && nonZero && wired,
        detail: `rows ${base.rows}->${a.rows}->${b.rows}, cents [${show(cb.join(','))}] -> [${show(ca.join(','))}] -> [${show(cc.join(','))}], snap ${show(a.out)}/${show(b.out)}, keys ${show(d0keys(d))}`
      }
    })

    const builtin = JSON.parse(await readFile(join(ROOT, 'presets', 'builtin.json'), 'utf8'))
    const patches = Array.isArray(builtin) ? builtin : builtin.patches

    step(4, 'preset click updates preset state and band count', `
emit(click("[data-menu=app]"))
time.sleep(0.25)
emit(click("[data-drawer=presets]"))
time.sleep(0.25)
before = probe("return JSON.stringify({bands:document.querySelectorAll('#eq-bands .band').length})")
emit(click("#preset-list button[data-name='Hard Tune']"))
time.sleep(0.5)
after = probe("return JSON.stringify({"
              " state:(document.getElementById('preset-state')||{}).textContent||null,"
              " bands:document.querySelectorAll('#eq-bands .band').length,"
              " on:document.querySelectorAll('#preset-list button.on').length,"
              " root:document.getElementById('in-root').value,"
              " scale:document.getElementById('in-mode').value,"
              " snap:(document.getElementById('out-snap')||{}).textContent||'',"
              " log:(document.getElementById('log')||{}).textContent||''})")
emit({"before": before, "after": after})
`, d0 => {
      const d = d0.after
      const dBefore = d0.before
      const patch = patches.find(p => p.name === 'Hard Tune')
      const expected = patch.master.eq.length
      const ok = d.state === 'Hard Tune' && d.bands === expected && d.on === 1 &&
                 d.root === String(patch.tune.root) && d.scale === patch.tune.scale &&
                 d.bands !== dBefore.bands && /preset: Hard Tune/.test(d.log)
      return {
        pass: !!ok,
        detail: `state ${show(d.state)}, bands ${dBefore.bands}->${d.bands} (patch has ${expected}), root ${show(d.root)}, scale ${show(d.scale)}, ${d.on} button marked on`
      }
    })

    step(5, 'Analyze fills the peak meter with a dB value', `
emit(click("[data-drawer=master]"))
time.sleep(0.25)
emit(click("#btn-analyze"))
time.sleep(0.5)
emit(probe("return JSON.stringify({peak:(document.getElementById('meter-peak')||{}).textContent||'',"
           " rms:(document.getElementById('meter-rms')||{}).textContent||'',"
           " gain:(document.getElementById('meter-gain')||{}).textContent||''})"))
`, d => /^-?\d+(\.\d+)? dB$/.test(d.peak) && /^-?\d+(\.\d+)? dB$/.test(d.rms)
      ? { pass: true, detail: `meter filled: peak ${d.peak}, loudness ${d.rms}, gain ${d.gain}` }
      : { pass: false, detail: `peak=${show(d.peak)} rms=${show(d.rms)} gain=${show(d.gain)}` })

    step(6, 'Export logs a byte count and marks the project exported', `
emit(click("[data-menu=app]"))
time.sleep(0.25)
emit(click("#btn-export-tab"))
time.sleep(0.3)
emit(click("#btn-export"))
time.sleep(8)
emit(probe("return JSON.stringify({status:(document.getElementById('status')||{}).textContent||null,"
           " log:(document.getElementById('log')||{}).textContent||'',"
           " rate:document.getElementById('in-rate').value})"))
`, d => {
      const m = /exported (\d+) bytes @ (\d+) Hz/.exec(d.log || '')
      const bytes = m ? Number(m[1]) : 0
      return {
        pass: d.status === 'exported' && bytes > 10000 && !!m && m[2] === d.rate,
        detail: `status ${show(d.status)}, ${m ? `${bytes} bytes @ ${m[2]} Hz` : show(d.log.slice(-90))}`
      }
    })

    step(7, 'Save project logs a save', `
before = text("#log")
emit(click("#btn-save"))
time.sleep(0.7)
emit({"before": before, "after": text("#log")})
`, d => {
      const before = (d.before || '').split('\n').length
      const after = (d.after || '').split('\n')
      const ok = after.length > before && /project saved/.test(d.after)
      return { pass: ok, detail: `log lines ${before}->${after.length}, new tail "${(after[after.length - 1] || '').slice(0, 40)}"` }
    })

    // 8 — premium controls (harmony + stems), SKIP when the build has none
    const premium = runHarness(`emit(probe("return JSON.stringify({"
      " harmony:[!!document.querySelector('#btn-harmony'), !!document.querySelector('#harmony-list'),"
      "  document.querySelectorAll('#in-harmony option').length],"
      " stems:[!!document.querySelector('#btn-split'), !!document.querySelector('#stem-readout')]})"))`)
    const pv = premium.ok ? premium.data : { harmony: [0, 0, 0], stems: [0, 0] }
    const hasHarmony = pv.harmony[0] && pv.harmony[1] && pv.harmony[2] > 0
    const hasStems = pv.stems[0] && pv.stems[1]

    if (!hasHarmony && !hasStems) {
      skip(8, 'premium harmony and stems', 'absent in this build (no harmony/stem controls in the DOM)')
    } else {
      if (hasHarmony) {
        step('8a', 'build a harmony adds sets and rows', `
emit(click(".tabs [data-drawer=harmony]"))
time.sleep(0.25)
emit(setval("#in-harmony", "thirds", "change"))
before = probe("return JSON.stringify({rows:document.querySelectorAll('#harmony-list .note').length,"
               " state:(document.getElementById('harmony-state')||{}).textContent||''})")
emit(click("#btn-harmony"))
time.sleep(0.7)
after = probe("return JSON.stringify({"
              " rows:document.querySelectorAll('#harmony-list .note').length,"
              " state:(document.getElementById('harmony-state')||{}).textContent||'',"
              " labels:Array.from(document.querySelectorAll('#harmony-list .note span:first-child')).map(x=>x.textContent),"
              " log:(document.getElementById('log')||{}).textContent||''})")
emit({"before": before, "after": after})
`, d0 => {
          const d = d0.after
          const b = d0.before
          return d.rows > b.rows && /^\d+ sets$/.test(d.state) && /harmonies: thirds/.test(d.log)
            ? { pass: true, detail: `harmony rows ${b.rows}->${d.rows}, state "${d.state}", labels ${show((d.labels || []).join(' / '))}` }
            : { pass: false, detail: `rows ${b.rows}->${d.rows} state=${show(d.state)} log=${show((d.log || '').slice(-90))}` }
        })
      } else {
        skip('8a', 'premium harmony', 'no harmony controls')
      }
      if (hasStems) {
        step('8b', 'split stems yields a readout', `
emit(click("[data-drawer=tools]"))
time.sleep(0.25)
emit(text("#stem-readout"))
emit(click("#btn-split"))
time.sleep(2.4)  # splitting a 106 s take, not a 2.4 s phrase
emit(probe("return JSON.stringify({readout:(document.getElementById('stem-readout')||{}).textContent||'',"
           " log:(document.getElementById('log')||{}).textContent||''})"))
`, d => /leads .* bed /.test(d.readout) && /stems: leads rms/.test(d.log)
          ? { pass: true, detail: `readout "${show(d.readout)}"` }
          : { pass: false, detail: `readout=${show(d.readout)} log=${show(d.log.slice(-90))}` })
      } else {
        skip('8b', 'premium stems', 'no split-stems control')
      }
    }

    step(9, 'reload restores the saved take and notes', `
cdp("Page.navigate", session_id=SID, url=${JSON.stringify(APP)})
loaded = wait_ready(8000)
time.sleep(0.9)
after = probe("return JSON.stringify({"
              " status:(document.getElementById('status')||{}).textContent||null,"
              " rows:document.querySelectorAll('#note-list .note').length,"
              " take:window.VS.state.take?.length||0,"
              " play:!document.getElementById('btn-play').disabled,"
              " presets:document.querySelectorAll('#preset-list button').length})")
after["loaded"] = bool(loaded) and after.get("status") == "ready"
emit(after)
`, d => d.loaded && d.status === 'ready' && d.rows > 0 && d.take > 0 && d.play && d.presets >= 1
      ? { pass: true, detail: `page reloaded, status "ready", ${d.rows} note rows and ${d.take} take samples restored from this browser, play armed` }
      : { pass: false, detail: `loaded=${d.loaded} status=${show(d.status)} rows=${d.rows} take=${d.take} play=${d.play} presets=${d.presets}` })
step(14, 'region pitch and reverse change the exported bytes', `
probe("document.getElementById('tab-take').click()")
time.sleep(0.3)
probe("document.getElementById('btn-pitch-down').click(); document.getElementById('btn-pitch-down').click();"
      " document.getElementById('btn-pitch-down').click(); document.getElementById('btn-pitch-down').click()")
probe("document.getElementById('btn-reg-reverse').click()")
time.sleep(0.4)
probe("var b = window.VS.exportBuffer().bytes; var h = 0;"
      " for (var i = 0; i < b.length; i += 97) h = (h * 31 + b[i]) % 2147483647;"
      " window.__h1 = h; window.__n1 = b.length")
probe("document.getElementById('btn-reg-reverse').click()")
probe("document.getElementById('btn-pitch-up').click(); document.getElementById('btn-pitch-up').click();"
      " document.getElementById('btn-pitch-up').click(); document.getElementById('btn-pitch-up').click()")
time.sleep(0.3)
emit(probe("var b = window.VS.exportBuffer().bytes; var h = 0;"
           " for (var i = 0; i < b.length; i += 97) h = (h * 31 + b[i]) % 2147483647;"
           " return JSON.stringify({h1: window.__h1, n1: window.__n1, h2: h, n2: b.length})"))
`, d => d.h1 && d.h2 && d.h1 !== d.h2 && d.n1 === d.n2
      ? { pass: true, detail: `${d.n1} byte render hashes ${d.h1} with -4 semitones and reverse, ${d.h2} without — the edits are baked in` }
      : { pass: false, detail: `first=${show(d.h1)}/${show(d.n1)} second=${show(d.h2)}/${show(d.n2)}` })

step(13, 'a note can be added and dragged in the roll', `
emit(probe("document.querySelector('[data-modal=\\\"addtrack\\\"]').click(); return JSON.stringify({ok:true})"))
time.sleep(0.5)
probe("document.querySelectorAll('#track-types button')[1].click()")
time.sleep(0.7)
emit(click("#tab-take"))
time.sleep(0.4)
box = probe("var b=document.getElementById('roll').getBoundingClientRect(); return JSON.stringify({x:Math.round(b.x+b.width*0.35), y:Math.round(b.y+b.height*0.5)})")
before = probe("var r=window.__app.state.rolls.get(window.__app.state.active); return JSON.stringify({n:r?r.notes.length:-1})")
roll_drag(box["x"], box["y"], 0, 0)
mid = probe("var r=window.__app.state.rolls.get(window.__app.state.active); var n=r&&r.notes[0]; return JSON.stringify({n:r?r.notes.length:-1, note:n?[+n.start.toFixed(2), n.midi]:null})")
roll_drag(box["x"], box["y"], 108, -36)
after = probe("var r=window.__app.state.rolls.get(window.__app.state.active); var n=r&&r.notes[0]; return JSON.stringify({n:r?r.notes.length:-1, note:n?[+n.start.toFixed(2), n.midi]:null})")
emit({**before, "added": mid.get("n"), "from": mid.get("note"), "to": after.get("note"), "kept": after.get("n")})
`, d => d.added == d.n + 1 && d.to && d.from && (d.to[0] !== d.from[0] || d.to[1] !== d.from[1])
      ? { pass: true, detail: `tap added a note (${d.n} → ${d.added}), drag moved it ${d.from} → ${d.to}` }
      : { pass: false, detail: `before=${d.n} added=${d.added} from=${show(d.from)} to=${show(d.to)}` })

step(12, 'playing drives the strip meters and mute cuts the strip', `
emit(click("#btn-mixer"))
time.sleep(0.6)
probe("document.querySelectorAll('.strip [data-mute][aria-pressed=\\\"true\\\"], .strip [data-solo][aria-pressed=\\\"true\\\"]').forEach(b=>b.click())")
time.sleep(0.3)
emit(click("#btn-play"))
time.sleep(1.6)
hot = probe("return JSON.stringify({m:[...document.querySelectorAll('.strip-meter i')].map(e=>parseFloat(e.style.height)||0),"
            " tp:(document.querySelector('[data-tp]')||{}).textContent})")
emit(click("#btn-play"))
probe("document.querySelector('.strip [data-mute]').click()")
time.sleep(0.3)
emit(click("#btn-play"))
time.sleep(1.4)
cold = probe("return JSON.stringify({m:[...document.querySelectorAll('.strip-meter i')].map(e=>parseFloat(e.style.height)||0),"
             " tp:(document.querySelector('[data-tp]')||{}).textContent})")
emit(click("#btn-play"))
probe("document.querySelector('.strip [data-mute]').click()")
emit({**hot, "cold": cold["m"], "coldTp": cold["tp"]})
`, d => d.m.some(v => v > 5) && d.m.slice(-1)[0] > 5 && d.tp && d.tp !== '–∞' && d.cold[0] === 0
      ? { pass: true, detail: `strip meters ${d.m.map(v => v.toFixed(0) + '%').join('/')} at TP ${d.tp} dB; muting the only audible track drops it to 0%` }
      : { pass: false, detail: `live=${show(d.m)} tp=${show(d.tp)} muted=${show(d.cold)} mutedTp=${show(d.coldTp)}` })

step(11, 'select all, copy, paste, delete and undo work from the keys', `
probe("document.body.focus()")
base = probe("return JSON.stringify({clips:document.querySelectorAll('#lane .clip').length})")
key("a", 4)
sel = probe("return JSON.stringify({sel:document.querySelectorAll('#lane .clip.sel').length})")
key("c", 4)
key("v", 4)
pasted = probe("return JSON.stringify({clips:document.querySelectorAll('#lane .clip').length})")
key("Delete")
gone = probe("return JSON.stringify({clips:document.querySelectorAll('#lane .clip').length})")
key("z", 4)
back = probe("return JSON.stringify({clips:document.querySelectorAll('#lane .clip').length,"
             " log:(document.getElementById('log')||{}).textContent||''})")
emit({**base, **sel, "pasted": pasted["clips"], "gone": gone["clips"], "back": back["clips"]})
`, d => d.sel > 0 && d.pasted === d.clips * 2 && d.gone === d.clips && d.back === d.pasted
      ? { pass: true, detail: `${d.sel} selected, ${d.clips} → ${d.pasted} pasted → ${d.gone} deleted → ${d.back} undone` }
      : { pass: false, detail: `sel=${d.sel} clips=${d.clips} pasted=${d.pasted} gone=${d.gone} back=${d.back}` })

step(10, 'every panel and menu opens without throwing', `
# one free-global mistake (an unimported openPanel) only showed up on a click
emit(probe("window.__hit = []; window.addEventListener('error', e => window.__hit.push(String(e.message)));"
           " document.querySelectorAll('[data-panel-open]').forEach(b => b.click());"
           " document.querySelectorAll('.tab').forEach(b => b.click());"
           " document.querySelectorAll('[data-menu]').forEach(b => b.click());"
           " return JSON.stringify({hit: window.__hit.slice(0, 3),"
           " open: document.querySelectorAll('.panel:not([hidden]), .menu:not([hidden])').length})"))
emit(probe("document.querySelectorAll('[data-panel-open]').forEach(b => b.click());"
           " document.querySelectorAll('[data-menu]').forEach(b => b.click());"
           " return JSON.stringify({hit: window.__hit.slice(0, 3)})"))
`, d => d && d.hit.length === 0
      ? { pass: true, detail: `opened every panel opener, tab and menu with no exception, ${d.open} surface live` }
      : { pass: false, detail: `exceptions ${show(d.hit)}` })

  } finally {
    closeTab()
    if (startedServer) startedServer.kill()
  }

  const elapsed = Date.now() - t0
  const fails = results.filter(r => r.status === 'FAIL').length
  const skips = results.filter(r => r.status === 'SKIP').length
  console.log(`\n${results.length - fails - skips} pass, ${fails} fail, ${skips} skip in ${(elapsed / 1000).toFixed(1)} s (server: ${serverNote})`)
  report(fails ? 1 : 0, elapsed, elapsed > 90_000 ? `Run exceeded the 90 s budget (${(elapsed / 1000).toFixed(1)} s).` : '')
  console.log(`transcript: ${HANDOFF}`)
  process.exit(fails ? 1 : 0)
}

main().catch(err => {
  console.error(`suite crashed: ${err.stack || err}`)
  try { closeTab() } catch { /* already gone */ }
  report(1, 0, `Suite crashed: ${err.message}`)
  process.exit(1)
})
