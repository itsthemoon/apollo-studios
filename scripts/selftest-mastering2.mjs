#!/usr/bin/env node
// Self-test for js/mastering2.js (preset mastering surface).
// Run from the project root:  node scripts/selftest-mastering2.mjs

import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const m = await import('../js/mastering2.js')
const {
  PRESETS,
  INTENSITIES,
  INTENSITY_VALUES,
  DEFAULT_INTENSITY,
  presetBySlug,
  intensityLabel,
  createState,
  clampState,
  setPreset,
  setIntensity,
  setInputGain,
  setBand,
  toggleEqBypass,
  toggleBypass,
  isBypassed,
  effectiveGains,
  analyseReference,
  buildChainFrom,
  chainOrder,
} = m

const SR = 44100
const SLUGS = ['universal', 'fire', 'clarity', 'tape', 'natural', 'spatial', 'cinematic', 'punch']
const BANDS = ['low', 'mid', 'high']

// ---- helpers ---------------------------------------------------------------

function tone(n, freq, amp, sr = SR) {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  return buf
}

function bassHeavy(n = 8192) {
  const out = tone(n, 80, 0.5)
  const top = tone(n, 9000, 0.02)
  for (let i = 0; i < n; i++) out[i] += top[i]
  return out
}

function trebleHeavy(n = 8192) {
  const out = tone(n, 9000, 0.4)
  const low = tone(n, 60, 0.01)
  for (let i = 0; i < n; i++) out[i] += low[i]
  return out
}

function noise(n, seed = 1) {
  const out = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = (s / 4294967296) * 2 - 1
  }
  return out
}

const stateAt = (slug, intensity = 0.5) => createState({ preset: slug, intensity })

// ---- PRESETS ---------------------------------------------------------------

test('PRESETS has the eight required slugs in order', () => {
  eq(PRESETS.length, 8, 'eight presets')
  eq(PRESETS.map((p) => p.slug).join(','), SLUGS.join(','), 'slug order')
})

test('every preset is complete and in bounds', () => {
  for (const preset of PRESETS) {
    ok(typeof preset.name === 'string' && preset.name.length > 0, `${preset.slug} has a name`)
    ok(preset.name !== preset.slug, `${preset.slug} name is a label`)
    ok(typeof preset.desc === 'string' && preset.desc.length >= 8, `${preset.slug} has a description`)
    ok(Number.isFinite(preset.intensityBias) && preset.intensityBias >= 0.4 && preset.intensityBias <= 1.6, `${preset.slug} bias in 0.4..1.6`)
    for (const band of BANDS) {
      ok(Number.isFinite(preset[`${band}Gain`]) && Math.abs(preset[`${band}Gain`]) <= 3, `${preset.slug} ${band}Gain within ±3`)
    }
  }
})

test('PRESETS and its entries are frozen', () => {
  ok(Object.isFrozen(PRESETS), 'list frozen')
  for (const preset of PRESETS) ok(Object.isFrozen(preset), `${preset.slug} frozen`)
})

test('presetBySlug finds presets and returns null otherwise', () => {
  eq(presetBySlug('fire').name, 'Fire')
  eq(presetBySlug('nope'), null)
  eq(presetBySlug(undefined), null)
})

// ---- intensities -----------------------------------------------------------

test('INTENSITIES is the three dial labels in order', () => {
  eq(INTENSITIES.join(','), 'Light,Normal,Heavy')
  ok(Object.isFrozen(INTENSITIES), 'frozen')
})

test('intensity mapping is 0.2 / 0.5 / 0.85 and ascending', () => {
  eq(INTENSITY_VALUES.Light, 0.2)
  eq(INTENSITY_VALUES.Normal, 0.5)
  eq(INTENSITY_VALUES.Heavy, 0.85)
  ok(INTENSITY_VALUES.Light < INTENSITY_VALUES.Normal, 'ascending L<N')
  ok(INTENSITY_VALUES.Normal < INTENSITY_VALUES.Heavy, 'ascending N<H')
  eq(DEFAULT_INTENSITY, INTERPRET_NORMAL())
})

function INTERPRET_NORMAL() {
  return 0.5
}

test('intensityLabel snaps to the nearest label', () => {
  eq(intensityLabel(0), 'Light')
  eq(intensityLabel(0.2), 'Light')
  eq(intensityLabel(0.51), 'Normal')
  eq(intensityLabel(0.9), 'Heavy')
  eq(intensityLabel(5), 'Heavy')
  eq(intensityLabel(-3), 'Light')
  eq(intensityLabel(NaN), 'Light')
})

// ---- createState -----------------------------------------------------------

test('createState defaults', () => {
  const s = createState()
  eq(s.preset, 'universal')
  eq(s.intensity, 0.5)
  eq(s.inputGain, 0)
  eq(s.low, 0)
  eq(s.mid, 0)
  eq(s.high, 0)
  eq(s.eqBypass, false)
  eq(s.bypass, false)
})

test('createState accepts overrides and clamps them', () => {
  const s = createState({ preset: 'fire', intensity: 2, inputGain: 99, low: -50, high: 50, eqBypass: true })
  eq(s.preset, 'fire')
  eq(s.intensity, 1)
  eq(s.inputGain, 24)
  eq(s.low, -12)
  eq(s.high, 12)
  eq(s.eqBypass, true)
})

test('createState falls back on an unknown preset and on null input', () => {
  eq(createState({ preset: 'bogus' }).preset, 'universal')
  eq(createState(null).preset, 'universal')
  eq(createState({ preset: '__proto__' }).preset, 'universal')
})

test('createState never shares objects between calls', () => {
  const a = createState()
  const b = createState()
  a.low = 5
  eq(b.low, 0, 'independent')
  ok(a !== b, 'distinct objects')
})

// ---- setters ---------------------------------------------------------------

test('setPreset switches and rejects unknown slugs', () => {
  eq(setPreset(createState(), 'tape').preset, 'tape')
  throws(() => setPreset(createState(), 'vaporwave'), 'unknown preset throws')
})

test('setIntensity clamps both ends and non-finite values', () => {
  eq(setIntensity(createState(), 0.3).intensity, 0.3)
  eq(setIntensity(createState(), 9).intensity, 1)
  eq(setIntensity(createState(), -9).intensity, 0)
  eq(setIntensity(createState(), NaN).intensity, 0)
  eq(setIntensity(createState(), Infinity).intensity, 0)
})

test('setInputGain clamps to ±24', () => {
  eq(setInputGain(createState(), -6).inputGain, -6)
  eq(setInputGain(createState(), 100).inputGain, 24)
  eq(setInputGain(createState(), -100).inputGain, -24)
})

test('setBand moves one band, clamps to ±12, rejects bad bands', () => {
  const s = setBand(createState(), 'mid', 4)
  eq(s.mid, 4)
  eq(s.low, 0, 'other bands untouched')
  eq(setBand(createState(), 'low', 60).low, 12)
  eq(setBand(createState(), 'high', -60).high, -12)
  throws(() => setBand(createState(), 'sub', 1), 'unknown band throws')
  throws(() => setBand(createState(), 'LOW', 1), 'band is lowercase')
})

test('toggles flip their own flag only', () => {
  const eq1 = toggleEqBypass(createState())
  eq(eq1.eqBypass, true)
  eq(eq1.bypass, false, 'eq toggle leaves bypass')
  eq(toggleEqBypass(eq1).eqBypass, false, 'toggles back')
  const b = toggleBypass(createState())
  eq(b.bypass, true)
  eq(b.eqBypass, false, 'bypass toggle leaves eqBypass')
  eq(toggleBypass(b).bypass, false, 'toggles back')
})

test('setters never mutate the state they are given', () => {
  const s = createState({ preset: 'clarity', intensity: 0.4 })
  const snapshot = JSON.stringify(s)
  setPreset(s, 'punch')
  setIntensity(s, 0.9)
  setBand(s, 'low', -5)
  toggleBypass(s)
  eq(JSON.stringify(s), snapshot)
})

// ---- effectiveGains --------------------------------------------------------

test('effectiveGains applies the preset curve scaled by intensity', () => {
  const g = effectiveGains(stateAt('universal', 0.5))
  near(g.low, 0.8 * 0.5, 1e-6, 'low = lowGain × intensity × bias')
  near(g.mid, 0.4 * 0.5, 1e-6, 'mid')
  near(g.high, 0.8 * 0.5, 1e-6, 'high')
})

test('intensityBias stretches the curve: Fire hits harder than Natural', () => {
  const fire = effectiveGains(stateAt('fire', 0.5))
  const natural = effectiveGains(stateAt('natural', 0.5))
  ok(fire.mid > natural.mid * 3, 'bias 1.3 vs 0.6 differs sharply')
  near(fire.mid, 2.2 * 0.5 * 1.3, 1e-6, 'bias applied')
})

test('intensity 0 leaves only user trims', () => {
  const g = effectiveGains(createState({ preset: 'cinematic', intensity: 0, low: 3, mid: -2, high: 1 }))
  eq(g.low, 3)
  eq(g.mid, -2)
  eq(g.high, 1)
})

test('effectiveGains rises monotonically with intensity', () => {
  let prev = -Infinity
  for (const intensity of [0, 0.2, 0.5, 0.85, 1]) {
    const g = effectiveGains(stateAt('punch', intensity)).mid
    ok(g > prev, `mid gain rises at ${intensity}`)
    prev = g
  }
})

test('user trims add to the preset curve', () => {
  const base = effectiveGains(stateAt('tape', 0.5))
  const trimmed = effectiveGains(createState({ preset: 'tape', intensity: 0.5, low: 2 }))
  near(trimmed.low, base.low + 2, 1e-6, 'trim adds')
  near(trimmed.mid, base.mid, 1e-6, 'other bands unchanged')
})

test('effectiveGains clamps to ±12 dB even with big trims', () => {
  const g = effectiveGains(createState({ preset: 'fire', intensity: 1, mid: 12 }))
  eq(g.mid, 12)
  const down = effectiveGains(createState({ preset: 'tape', intensity: 1, high: -12 }))
  eq(down.high, -12)
})

test('eqBypass zeroes every band', () => {
  const g = effectiveGains(createState({ preset: 'fire', intensity: 1, low: 4, mid: 4, high: 4, eqBypass: true }))
  eq(g.low, 0)
  eq(g.mid, 0)
  eq(g.high, 0)
})

test('bypass zeroes every band too', () => {
  const g = effectiveGains(createState({ preset: 'cinematic', intensity: 1, low: 4, bypass: true }))
  eq(g.low, 0)
  eq(g.mid, 0)
  eq(g.high, 0)
})

test('effectiveGains tolerates empty state', () => {
  const g = effectiveGains()
  ok(Number.isFinite(g.low) && Number.isFinite(g.mid) && Number.isFinite(g.high), 'finite')
})

test('isBypassed tracks the whole-chain flag', () => {
  eq(isBypassed(createState()), false)
  eq(isBypassed(createState({ bypass: true })), true)
  eq(isBypassed(createState({ eqBypass: true })), false, 'eqBypass is not a chain bypass')
  eq(isBypassed(), false)
})

// ---- chain -----------------------------------------------------------------

test('chainOrder puts input first and the limiter last', () => {
  const order = chainOrder()
  eq(order[0], 'inputGain')
  eq(order[order.length - 1], 'limiter')
  eq(order.length, 5)
  eq(order.join(','), 'inputGain,lowShelf,midBell,highShelf,limiter')
})

test('limiter is last for every preset, intensity and bypass combination', () => {
  for (const preset of PRESETS) {
    for (const intensity of [0, 0.5, 1]) {
      for (const flags of [{}, { eqBypass: true }, { bypass: true }, { eqBypass: true, bypass: true }]) {
        const chain = buildChainFrom(createState({ preset: preset.slug, intensity, ...flags }))
        eq(chain[chain.length - 1].node, 'limiter', `${preset.slug} @${intensity} ${JSON.stringify(flags)}`)
      }
    }
  }
})

test('chain nodes follow chainOrder exactly', () => {
  const chain = buildChainFrom(createState({ preset: 'spatial' }))
  eq(chain.map((n) => n.node).join(','), chainOrder().join(','))
})

test('limiter is active with a fixed ceiling in every state', () => {
  for (const state of [createState(), createState({ eqBypass: true }), createState({ bypass: true })]) {
    const limiter = buildChainFrom(state).at(-1)
    eq(limiter.active, true)
    ok(limiter.ceilingDb <= 0 && limiter.ceilingDb >= -1, 'ceiling sane')
  }
})

test('band nodes carry gain matching effectiveGains', () => {
  const state = createState({ preset: 'punch', intensity: 0.6, low: 1.5 })
  const gains = effectiveGains(state)
  const chain = buildChainFrom(state)
  for (const band of BANDS) {
    const node = chain.find((n) => n.node === { low: 'lowShelf', mid: 'midBell', high: 'highShelf' }[band])
    eq(node.gainDb, gains[band], `${band} node gain`)
    eq(node.active, true, `${band} active`)
  }
})

test('band nodes keep their fixed kind and frequency', () => {
  const chain = buildChainFrom(createState())
  eq(chain[1].kind, 'lowshelf')
  eq(chain[1].freq, 120)
  eq(chain[2].kind, 'peaking')
  eq(chain[2].freq, 1200)
  eq(chain[3].kind, 'highshelf')
  eq(chain[3].freq, 7000)
})

test('eqBypass nulls band nodes but keeps the input trim', () => {
  const chain = buildChainFrom(createState({ preset: 'fire', intensity: 1, inputGain: 5, eqBypass: true }))
  eq(chain[0].gainDb, 5, 'input trim survives')
  eq(chain[0].active, true, 'input trim stays active')
  for (const band of BANDS) {
    const node = chain.find((n) => n.kind === { low: 'lowshelf', mid: 'peaking', high: 'highshelf' }[band])
    eq(node.gainDb, 0, `${band} nulled`)
    eq(node.active, false, `${band} inactive`)
  }
})

test('bypass nulls the input trim and every band', () => {
  const chain = buildChainFrom(createState({ preset: 'cinematic', intensity: 1, inputGain: 8, low: 4, bypass: true }))
  eq(chain[0].gainDb, 0, 'input nulled')
  eq(chain[0].active, false, 'input inactive')
  for (const node of chain.slice(1, -1)) {
    eq(node.gainDb, 0)
    eq(node.active, false)
  }
  eq(chain.at(-1).node, 'limiter')
})

test('buildChainFrom returns fresh node objects', () => {
  const chain = buildChainFrom(createState())
  chain[1].gainDb = 99
  const again = buildChainFrom(createState())
  eq(again[1].gainDb, effectiveGains(createState()).low)
})

// ---- analyseReference ------------------------------------------------------

test('analyseReference: silence is neutral', () => {
  const r = analyseReference([new Float32Array(4096)], SR)
  eq(r.low, 0)
  eq(r.mid, 0)
  eq(r.high, 0)
  eq(r.intensity, DEFAULT_INTENSITY)
})

test('analyseReference: bass-heavy material is asked to cut low, lift high', () => {
  const r = analyseReference([bassHeavy()], SR)
  ok(r.low < 0, `low cut, got ${r.low}`)
  ok(r.high > 0, `high lift, got ${r.high}`)
  ok(Math.abs(r.mid) < Math.abs(r.low) + 0.5, 'mid near neutral')
})

test('analyseReference: bright material is asked to lift low, cut high', () => {
  const r = analyseReference([trebleHeavy()], SR)
  ok(r.low > 0, `low lift, got ${r.low}`)
  ok(r.high < 0, `high cut, got ${r.high}`)
})

test('analyseReference: every suggestion stays inside ±6 dB', () => {
  const cases = [
    [bassHeavy()],
    [trebleHeavy()],
    [noise(4096, 7)],
    [noise(4096, 7).map((v) => v * 1e-4)],
    [tone(2048, 40, 1)],
    [tone(2048, 15000, 1)],
  ]
  for (const channels of cases) {
    const r = analyseReference(channels, SR)
    for (const band of BANDS) {
      ok(Math.abs(r[band]) <= 6, `${band} ${r[band]} within ±6`)
      ok(Number.isFinite(r[band]), `${band} finite`)
    }
  }
})

test('analyseReference: intensity tracks crest factor inside 0.15..0.9', () => {
  const squashed = analyseReference([noise(8192, 3).map((v) => Math.tanh(v * 8) * 0.5)], SR)
  const dynamic = analyseReference([noise(8192, 3).map((v) => v * 0.0001)], SR)
  ok(squashed.intensity > dynamic.intensity, `${squashed.intensity} > ${dynamic.intensity}`)
  for (const r of [squashed, dynamic]) {
    ok(r.intensity >= 0.15 && r.intensity <= 0.9, `intensity ${r.intensity} in range`)
  }
})

test('analyseReference: accepts a stereo object as well as an array', () => {
  const stereo = { left: bassHeavy(4096), right: bassHeavy(4096) }
  const r = analyseReference(stereo, SR)
  ok(r.low < 0, 'same verdict as the array form')
  ok(Number.isFinite(r.intensity), 'finite intensity')
})

test('analyseReference: averages across channels', () => {
  const r = analyseReference([bassHeavy(4096), trebleHeavy(4096)], SR)
  ok(Math.abs(r.low) < 4 && Math.abs(r.high) < 4, 'mixed program is moderate')
})

test('analyseReference rejects bad channels and sample rates', () => {
  throws(() => analyseReference([], SR), 'empty array throws')
  throws(() => analyseReference([1, 2, 3], SR), 'plain array throws')
  throws(() => analyseReference([new Float32Array(8), [1]], SR), 'mixed types throw')
  throws(() => analyseReference(null, SR), 'null throws')
  throws(() => analyseReference([new Float32Array(8)], 0), 'zero rate throws')
  throws(() => analyseReference([new Float32Array(8)], NaN), 'NaN rate throws')
  throws(() => analyseReference([new Float32Array(8)], Infinity), 'infinite rate throws')
})

test('analyseReference stays finite on unity DC', () => {
  const dc = new Float32Array(2048).fill(1)
  const r = analyseReference([dc], SR)
  for (const band of BANDS) ok(Number.isFinite(r[band]), `${band} finite`)
})

// ---- clampState ------------------------------------------------------------

test('clampState is idempotent', () => {
  const once = clampState({ preset: 'fire', intensity: 0.4, inputGain: 3, low: -2, eqBypass: true })
  eq(JSON.stringify(clampState(once)), JSON.stringify(once))
})

test('clampState returns a fresh object and never throws', () => {
  const s = createState()
  ok(clampState(s) !== s, 'fresh object')
  for (const input of [undefined, null, {}, { preset: 42 }, { intensity: 'x' }]) {
    let threw = false
    try {
      clampState(input)
    } catch {
      threw = true
    }
    ok(!threw, `clampState(${JSON.stringify(input)}) does not throw`)
  }
})

test('clampState coerces booleans', () => {
  const s = clampState({ eqBypass: 1, bypass: 'yes' })
  eq(s.eqBypass, true)
  eq(s.bypass, true)
})

report()
