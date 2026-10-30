// scripts/selftest-presets.mjs — self-test for js/presets.js.
// Run from the project root:  node scripts/selftest-presets.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import {
  PATCH_VERSION,
  makePatch,
  validatePatch,
  mergePatch,
  serializePatch,
  parsePatch,
  BUILTIN,
} from '../js/presets.js'
import { test, ok, eq, throws, report } from './lib/assert.mjs'

test('patch version is 1', () => {
  eq(PATCH_VERSION, 1)
})

test('at least 4 builtins and every builtin validates', () => {
  ok(BUILTIN.length >= 4, `expected >= 4 builtins, got ${BUILTIN.length}`)
  for (const patch of BUILTIN) {
    const result = validatePatch(patch)
    ok(result.ok, `builtin "${patch.name}": ${result.errors.join('; ')}`)
  }
})

test('makePatch returns a valid patch', () => {
  ok(validatePatch(makePatch('Test')).ok)
})

test('makePatch deep-clones so two calls never share arrays', () => {
  const a = makePatch('A')
  const b = makePatch('B')
  ok(a !== b)
  ok(a.tune !== b.tune)
  ok(a.master !== b.master)
  ok(a.master.eq !== b.master.eq)
  ok(a.master.comp !== b.master.comp)
  ok(a.vocal !== b.vocal)
  a.master.eq.push({ kind: 'peaking', freq: 1000, q: 1, gainDb: 1 })
  a.master.comp.thresholdDb = -5
  a.tune.amount = 0.2
  eq(b.master.eq.length, 0, 'mutating one eq array must not leak')
  eq(b.master.comp.thresholdDb, -18, 'mutating one comp must not leak')
  eq(b.tune.amount, 0.5, 'mutating one tune must not leak')
})

test('serialize/parse round-trip deep-equals', () => {
  for (const patch of [makePatch('Round Trip'), ...BUILTIN]) {
    const parsed = parsePatch(serializePatch(patch))
    ok(parsed.ok, `round-trip parse failed: ${parsed.error}`)
    assert.deepStrictEqual(parsed.patch, patch)
  }
})

test('parsePatch rejects invalid inputs', () => {
  const cases = [
    ['not json', 'not json'],
    ['[]', '[]'],
    ['{}', '{}'],
  ]
  for (const [label, text] of cases) {
    const result = parsePatch(text)
    eq(result.ok, false, `${label} must be rejected`)
    ok(!/[A-Z]/.test(result.error), `error must be lowercase, got "${result.error}"`)
  }
  let bad = makePatch('Bad Version')
  bad.version = PATCH_VERSION + 1
  eq(parsePatch(JSON.stringify(bad)).ok, false, 'wrong version must be rejected')
  bad = makePatch('Bad Amount')
  bad.tune.amount = 2
  eq(parsePatch(JSON.stringify(bad)).ok, false, 'amount 2 must be rejected')
  bad = makePatch('Too Many Bands')
  for (let i = 0; i < 9; i++) bad.master.eq.push({ kind: 'peaking', freq: 100 + i * 100, q: 1, gainDb: 0 })
  eq(parsePatch(JSON.stringify(bad)).ok, false, '9 eq bands must be rejected')
  bad = makePatch('Nameless')
  bad.name = ''
  eq(parsePatch(JSON.stringify(bad)).ok, false, 'missing name must be rejected')
  eq(parsePatch('null').ok, false, 'null must be rejected')
  eq(parsePatch('"a string"').ok, false, 'string must be rejected')
  eq(parsePatch('42').ok, false, 'number must be rejected')
})

test('parsePatch never throws', () => {
  for (const input of [undefined, null, 42, {}, [], '', '{"version":1}']) {
    let threw = false
    try {
      parsePatch(input)
    } catch {
      threw = true
    }
    ok(!threw, `parsePatch must not throw on ${JSON.stringify(input)}`)
  }
})

test('validatePatch collects every failure', () => {
  const bad = {
    version: 2,
    name: '',
    tune: { root: 12, scale: 'nope', amount: 2 },
    master: {
      eq: [],
      comp: { thresholdDb: 5, ratio: 0.5, attackMs: NaN, releaseMs: -1, makeupDb: 'x' },
      limitDb: -20,
      targetRmsDb: 0,
    },
    vocal: { gainDb: 'x', reverbMix: 5 },
    extra: true,
  }
  const result = validatePatch(bad)
  eq(result.ok, false)
  ok(result.errors.length >= 10, `expected many collected errors, got ${result.errors.length}`)
})

test('mergePatch overrides nested keys and leaves siblings intact', () => {
  const base = makePatch('Base')
  const merged = mergePatch(base, { tune: { amount: 0.95 }, vocal: { reverbMix: 0.4 } })
  eq(merged.tune.amount, 0.95)
  eq(merged.tune.root, base.tune.root, 'tune.root sibling must survive')
  eq(merged.tune.scale, base.tune.scale, 'tune.scale sibling must survive')
  eq(merged.vocal.reverbMix, 0.4)
  eq(merged.vocal.gainDb, base.vocal.gainDb, 'vocal.gainDb sibling must survive')
  eq(merged.name, 'Base')
  ok(validatePatch(merged).ok, 'merged patch must validate')
})

test('mergePatch re-validates and rejects invalid merges', () => {
  throws(() => mergePatch(makePatch('Base'), { tune: { amount: 7 } }), 'invalid merge must throw')
})

test('serializePatch emits stable key order', () => {
  const patch = makePatch('Order Check')
  patch.master.eq.push({ kind: 'peaking', freq: 1000, q: 1, gainDb: 1 })
  const parsed = JSON.parse(serializePatch(patch))
  eq(Object.keys(parsed).join(','), 'version,name,tune,master,vocal')
  eq(Object.keys(parsed.tune).join(','), 'root,scale,amount')
  eq(Object.keys(parsed.master).join(','), 'eq,comp,limitDb,targetRmsDb')
  eq(Object.keys(parsed.master.comp).join(','), 'thresholdDb,ratio,attackMs,releaseMs,makeupDb')
  eq(Object.keys(parsed.vocal).join(','), 'gainDb,reverbMix')
  for (const band of parsed.master.eq) {
    eq(Object.keys(band).join(','), 'kind,freq,q,gainDb')
  }
  const extra = makePatch('Extra')
  extra.zz = 1
  extra.custom = 2
  const extraParsed = JSON.parse(serializePatch(extra))
  eq(Object.keys(extraParsed).join(','), 'version,name,tune,master,vocal,custom,zz')
})

test('presets/builtin.json matches BUILTIN', () => {
  const onDisk = JSON.parse(readFileSync(new URL('../presets/builtin.json', import.meta.url), 'utf8'))
  ok(Array.isArray(onDisk), 'builtin.json must be an array')
  ok(onDisk.length >= 4, 'builtin.json must hold >= 4 presets')
  assert.deepStrictEqual(onDisk, BUILTIN)
})

report()
