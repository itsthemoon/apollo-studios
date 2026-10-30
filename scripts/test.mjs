// scripts/test.mjs — single verification entry point for the whole goal.
// Node 22. No dependencies. Exit 0 only when every check passes.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { test, testAsync, ok, eq, near, throws, report } from './lib/assert.mjs'
import * as pitch from '../js/pitch.js'
import * as tune from '../js/tune.js'
import * as presets from '../js/presets.js'
import { masterChain } from '../js/master.js'
import { encodeWav, wavHeaderBytes } from '../js/wav.js'

const RATE = 48000
const SOURCE = [58, 62, 65, 62]

function phrase() {
  const total = Math.round(RATE * 2.4)
  const buf = new Float32Array(total)
  const spans = [[0.1, 0.45], [0.65, 0.45], [1.2, 0.5], [1.8, 0.5]]
  spans.forEach(([start, dur], i) => {
    const hz = tune.midiToHz(SOURCE[i])
    const from = Math.round(start * RATE)
    const to = Math.round((start + dur) * RATE)
    for (let s = from; s < to; s++) {
      const t = (s - from) / RATE
      const env = Math.min(1, t / 0.04) * Math.min(1, (to - s) / (RATE * 0.08))
      buf[s] = 0.42 * env * Math.sin(2 * Math.PI * hz * t) + 0.008 * (Math.random() - 0.5)
    }
  })
  return buf
}

const take = phrase()

// ---- 1. every module self-test still passes -------------------------------
test('module self-tests', () => {
  for (const name of ['input', 'tune', 'presets', 'master']) {
    const run = spawnSync('node', [`scripts/selftest-${name}.mjs`], { encoding: 'utf8' })
    eq(run.status, 0, `selftest-${name} exit code`)
    ok((run.stdout || '').includes('ALL CHECKS PASSED'), `selftest-${name} reports pass`)
  }
})

// ---- 2. voice -> notes -----------------------------------------------------
const detected = pitch.detectNotes(take, RATE)

test('voice becomes notes', () => {
  eq(detected.length, SOURCE.length, 'one note per sung syllable')
  detected.forEach((n, i) => {
    near(n.midi, SOURCE[i], 2, `note ${i} pitch`)
    near(n.start, [0.1, 0.65, 1.2, 1.8][i], 0.12, `note ${i} onset`)
    ok(n.dur > 0.05, `note ${i} has duration`)
  })
})

// ---- 3. tuning -------------------------------------------------------------
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11])

test('snap to key', () => {
  const before = detected.map(n => n.midi)
  const snapped = tune.snapStrength(detected, { root: 0, scale: 'major', amount: 1 })
  eq(snapped.length, detected.length, 'note count preserved')
  snapped.forEach((n, i) => {
    ok(C_MAJOR.has(((Math.round(n.midi) % 12) + 12) % 12), `note ${i} lands in C major`)
    eq(detected[i].midi, before[i], 'input not mutated')
  })
  const identity = tune.snapStrength(detected, { root: 0, scale: 'major', amount: 0 })
  identity.forEach((n, i) => near(n.midi, detected[i].midi, 1e-9, 'amount 0 is identity'))
})

test('quantize to grid', () => {
  const q = tune.quantizeStarts(detected.map(n => ({ ...n })), { bpm: 120, division: 4 })
  const step = (60 / 120) / 4
  q.forEach(n => near(n.start / step, Math.round(n.start / step), 1e-6, 'start on grid'))
})

// ---- 4. presets ------------------------------------------------------------
test('preset format', () => {
  eq(presets.BUILTIN.length >= 4, true, 'factory patches exist')
  for (const patch of presets.BUILTIN) {
    eq(presets.validatePatch(patch).ok, true, `builtin ${patch.name} valid`)
    const round = presets.parsePatch(presets.serializePatch(patch))
    eq(round.ok, true, 'round-trip parses')
    eq(JSON.stringify(round.patch), JSON.stringify(patch), 'round-trip is lossless')
  }
  for (const bad of ['not json', '[]', '{}', '{"version":9}']) {
    eq(presets.parsePatch(bad).ok, false, `rejects ${bad.slice(0, 12)}`)
  }
  const broken = presets.makePatch('x')
  broken.tune.amount = 2
  eq(presets.validatePatch(broken).ok, false, 'rejects amount > 1')
  const nine = presets.makePatch('y')
  nine.master.eq = Array.from({ length: 9 }, () => ({ kind: 'peaking', freq: 1000, q: 1, gainDb: 0 }))
  eq(presets.validatePatch(nine).ok, false, 'rejects nine EQ bands')
})

// ---- 5. mastering + export -------------------------------------------------
const snapped = tune.snapStrength(detected, { root: 0, scale: 'major', amount: 1 })
const settings = presets.BUILTIN.find(p => p.name === 'Radio Pop').master
const stereo = { left: Float32Array.from(take), right: Float32Array.from(take) }
const mastered = masterChain(stereo, settings, RATE)

test('mastering chain', () => {
  const { stereo: out, report: r } = mastered
  ok(out.left.length === take.length, 'length preserved')
  let peak = 0
  for (const ch of [out.left, out.right]) {
    for (const s of ch) {
      ok(Number.isFinite(s), 'finite sample')
      peak = Math.max(peak, Math.abs(s))
    }
  }
  ok(peak <= 1, `no sample over 0 dBFS (peak ${(20 * Math.log10(peak)).toFixed(2)} dB)`)
  ok(r.peakDb <= 0.01, 'report peak respects the ceiling')
  ok(Math.abs(r.rmsDb - settings.targetRmsDb) < 3, 'loudness lands near target')
})

test('wav bytes', () => {
  const bytes = encodeWav(mastered.stereo, RATE)
  eq(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF', 'RIFF magic')
  eq(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE', 'WAVE tag')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  eq(view.getUint16(22, true), 2, 'stereo')
  eq(view.getUint32(24, true), RATE, 'sample rate')
  eq(view.getUint16(34, true), 16, '16-bit')
  eq(bytes.length, wavHeaderBytes() + mastered.stereo.left.length * 4, 'length = header + samples*4')
  writeFileSync('/tmp/vs-verify.wav', bytes)
  const back = readFileSync('/tmp/vs-verify.wav')
  eq(back.length, bytes.length, 're-read length matches')
  eq(String.fromCharCode(...back.slice(8, 12)), 'WAVE', 're-read still a WAV')
})

test('export refuses junk', () => {
  throws(() => encodeWav({ left: new Float32Array(4), right: new Float32Array(3) }, RATE), 'uneven channels throw')
})

// ---- 6. static wiring ------------------------------------------------------
test('dom wiring', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8')
  const ids = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))
  ok(ids.size > 25, `app references ${ids.size} ids`)
  for (const id of ids) ok(html.includes(`id="${id}"`), `#${id} exists in app.html`)
  for (const [, spec] of app.matchAll(/from '(\.[^']+)'/g)) {
    ok(readFileSync(new URL(`../js/${spec.replace('./', '')}`, import.meta.url), 'utf8').length > 0, `${spec} resolves`)
  }
})

// ---- 7. serving ------------------------------------------------------------
await testAsync('page serves', async () => {
  const landing = await fetch('http://127.0.0.1:4173/')
  eq(landing.status, 200, '/ serves')
  const html = await landing.text()
  ok(html.includes('Undertow'), '/ is the Undertow landing page')
  ok(html.includes('href="app.html"'), '/ links to the studio')

  eq((await fetch('http://127.0.0.1:4173/app.html')).status, 200, '/app.html serves')
  eq((await fetch('http://127.0.0.1:4173/styles-landing.css')).status, 200, 'landing stylesheet serves')
  for (const path of ['/js/app.js', '/styles.css', '/LICENSE', '/README.md']) {
    eq((await fetch(`http://127.0.0.1:4173${path}`)).status, 200, `${path} serves`)
  }
  for (const page of ['getting-started', 'features', 'architecture', 'faq']) {
    const res = await fetch(`http://127.0.0.1:4173/docs/${page}.html`)
    eq(res.status, 200, `/docs/${page}.html serves`)
    ok((await res.text()).includes('Undertow'), `docs/${page}.html is branded`)
  }
})

report()
