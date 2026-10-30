// scripts/selftest-drums.mjs — self-test for js/drums.js.
// Run from the project root:  node scripts/selftest-drums.mjs
import {
  KIT, createPattern, toggleStep, setVelocity, clearLane, clearPattern,
  setSwing, setLaneGain, resolveSwing, trigger, renderPattern, laneIndex,
} from '../js/drums.js'
import { test, eq, ok, near, throws, report } from './lib/assert.mjs'

const SLUGS = ['kick', 'snare', 'rim', 'clap', 'hatClosed', 'hatOpen', 'tomLow', 'tomHigh', 'ride']
const RATE = 48000

// ---- fake Web Audio context ---------------------------------------------------
// Records every node, start/stop and parameter call so scheduling can be asserted
// without a browser. Only the surface js/drums.js actually uses is implemented.

function makeCtx(rate = RATE) {
  const log = []
  const nodes = []
  let buffers = 0

  const param = (node, name) => {
    const calls = []
    const p = {
      calls,
      value: 1,
      setValueAtTime(v, t) { calls.push({ m: 'set', v, t }) },
      linearRampToValueAtTime(v, t) { calls.push({ m: 'lin', v, t }) },
      exponentialRampToValueAtTime(v, t) { calls.push({ m: 'exp', v, t }) },
    }
    node[name] = p
    return p
  }

  const track = (kind) => {
    const node = {
      kind,
      starts: [],
      stops: [],
      out: [],
      connect(dest) { node.out.push(dest) },
      start(when, offset) { node.starts.push({ when, offset }); log.push({ kind: 'start', node, when }) },
      stop(when) { node.stops.push(when); log.push({ kind: 'stop', node, when }) },
    }
    param(node, 'gain')
    param(node, 'frequency')
    param(node, 'Q')
    nodes.push(node)
    log.push({ kind: 'create', node })
    return node
  }

  const ctx = {
    sampleRate: rate,
    currentTime: 0,
    destination: { connect() {} },
    get buffers() { return buffers },
    log,
    nodes,
    createGain() { return track('gain') },
    createBiquadFilter() { return track('filter') },
    createOscillator() { return track('osc') },
    createBufferSource() { return track('source') },
    createBuffer(channels, length, sampleRate) {
      buffers++
      const data = new Float32Array(length)
      return { numberOfChannels: channels, length, sampleRate, getChannelData: () => data }
    },
  }
  return ctx
}

const sink = () => ({ connect() {} })
const peakOf = (node) => {
  const lin = node.gain.calls.filter((c) => c.m === 'lin')
  return lin.length ? lin[lin.length - 1].v : 0
}
const hits = (pattern, lane) => pattern.hits[lane].filter((v) => v > 0).length
const total = (pattern) => pattern.hits.reduce((n, row) => n + row.filter((v) => v > 0).length, 0)

function filled(steps = 16) {
  let p = createPattern(steps)
  for (let lane = 0; lane < p.lanes; lane++) p = toggleStep(p, lane, 0)
  return p
}

// ---- kit ----------------------------------------------------------------------

test('KIT: exactly the nine required lanes, in order', () => {
  ok(Array.isArray(KIT))
  eq(KIT.length, 9, 'nine lanes')
  eq(KIT.map((d) => d.slug).join(','), SLUGS.join(','), 'lane order')
})

test('KIT: every entry is frozen and complete', () => {
  for (const drum of KIT) {
    ok(Object.isFrozen(drum), `${drum.slug} must be frozen`)
    ok(typeof drum.name === 'string' && drum.name.length > 0, `${drum.slug} needs a name`)
    ok(Number.isFinite(drum.defaultVelocity), `${drum.slug} defaultVelocity`)
    ok(drum.defaultVelocity > 0 && drum.defaultVelocity <= 1, `${drum.slug} defaultVelocity range`)
    ok(drum.params && typeof drum.params === 'object', `${drum.slug} params`)
    ok(Object.isFrozen(drum.params), `${drum.slug} params frozen`)
  }
})

test('KIT: every param is a finite number or a finite array', () => {
  for (const drum of KIT) {
    for (const [key, value] of Object.entries(drum.params)) {
      if (Array.isArray(value)) {
        ok(value.length > 0, `${drum.slug}.${key} array`)
        for (const n of value) ok(Number.isFinite(n) && n > 0, `${drum.slug}.${key} entry`)
      } else {
        ok(Number.isFinite(value) && value > 0, `${drum.slug}.${key} finite positive`)
      }
    }
  }
})

test('KIT: slugs and display names are unique', () => {
  eq(new Set(SLUGS).size, 9, 'slugs unique')
  eq(new Set(KIT.map((d) => d.name)).size, 9, 'names unique')
})

test('KIT: pitch voices sweep down, hats sit above the snare', () => {
  for (const slug of ['kick', 'tomLow', 'tomHigh']) {
    const p = KIT.find((d) => d.slug === slug).params
    ok(p.startHz > p.endHz, `${slug} sweeps down`)
  }
  const snare = KIT.find((d) => d.slug === 'snare').params
  ok(KIT.find((d) => d.slug === 'hatClosed').params.bp > snare.hp, 'closed hat above snare')
  ok(KIT.find((d) => d.slug === 'hatOpen').params.bp > snare.hp, 'open hat above snare')
})

test('laneIndex maps slugs and rejects near misses', () => {
  eq(laneIndex('kick'), 0, 'kick is lane 0')
  eq(laneIndex('ride'), 8, 'ride is lane 8')
  throws(() => laneIndex('tom'), 'tom is not a slug')
  throws(() => laneIndex(''), 'empty slug')
  throws(() => laneIndex(undefined), 'missing slug')
})

// ---- createPattern ------------------------------------------------------------

test('createPattern defaults to 16 steps by 9 lanes, all empty', () => {
  const p = createPattern()
  eq(p.steps, 16, 'sixteen steps')
  eq(p.lanes, 9, 'nine lanes')
  eq(p.hits.length, 9, 'one row per lane')
  for (const row of p.hits) {
    eq(row.length, 16, 'row width')
    eq(row.filter((v) => v !== 0).length, 0, 'row starts empty')
  }
  eq(p.swing, 0, 'no swing by default')
  for (const g of p.gains) eq(g, 1, 'unity gain by default')
})

test('createPattern rows are independent arrays', () => {
  const p = createPattern()
  ok(p.hits[0] !== p.hits[1], 'rows not aliased')
  p.hits[0][3] = 0.5
  eq(p.hits[1][3], 0, 'writing one row leaves the next alone')
})

test('createPattern honours smaller shapes and guards bad ones', () => {
  const p = createPattern(8, 3)
  eq(p.steps, 8, 'eight steps')
  eq(p.lanes, 3, 'three lanes')
  eq(p.hits.length, 3, 'three rows')
  throws(() => createPattern(0), 'zero steps')
  throws(() => createPattern(-4), 'negative steps')
  throws(() => createPattern(1.5), 'fractional steps')
  throws(() => createPattern(257), 'too many steps')
  throws(() => createPattern(16, 0), 'zero lanes')
  throws(() => createPattern(16, 10), 'too many lanes')
  throws(() => createPattern(16, 2.5), 'fractional lanes')
})

// ---- toggleStep ---------------------------------------------------------------

test('toggleStep fills with the lane default, then clears', () => {
  for (let lane = 0; lane < KIT.length; lane++) {
    let p = createPattern()
    p = toggleStep(p, lane, 5)
    eq(p.hits[lane][5], KIT[lane].defaultVelocity, `${KIT[lane].slug} default velocity`)
    p = toggleStep(p, lane, 5)
    eq(p.hits[lane][5], 0, `${KIT[lane].slug} toggles back off`)
  }
})

test('toggleStep on a velocity hit clears it rather than doubling', () => {
  let p = createPattern()
  p = setVelocity(p, 0, 2, 0.33)
  p = toggleStep(p, 0, 2)
  eq(p.hits[0][2], 0, 'hit becomes a rest')
})

test('toggleStep keeps lanes independent across all nine', () => {
  let p = createPattern()
  for (let lane = 0; lane < 9; lane++) p = toggleStep(p, lane, lane)
  for (let lane = 0; lane < 9; lane++) {
    eq(hits(p, lane), 1, `${KIT[lane].slug} has one hit`)
    eq(p.hits[lane][lane], KIT[lane].defaultVelocity, `${KIT[lane].slug} on its own step`)
  }
  eq(total(p), 9, 'nine hits in total')
})

test('toggleStep touches exactly one cell', () => {
  const base = createPattern()
  const before = base.hits.map((r) => r.join(','))
  const p = toggleStep(base, 4, 7)
  let changed = 0
  for (let lane = 0; lane < 9; lane++) {
    for (let step = 0; step < 16; step++) {
      if (p.hits[lane][step] !== base.hits[lane][step]) changed++
    }
  }
  eq(changed, 1, 'exactly one cell changed')
  eq(base.hits.map((r) => r.join(',')).join('|'), before.join('|'), 'input untouched')
})

test('toggleStep never aliases the input pattern', () => {
  const base = createPattern()
  const p = toggleStep(base, 0, 0)
  ok(p !== base, 'new object')
  ok(p.hits !== base.hits, 'new rows array')
  ok(p.hits[0] !== base.hits[0], 'new row')
  ok(p.gains !== base.gains, 'new gains array')
})

test('toggleStep guards lane and step bounds', () => {
  const p = createPattern()
  throws(() => toggleStep(p, 9, 0), 'lane too high')
  throws(() => toggleStep(p, -1, 0), 'negative lane')
  throws(() => toggleStep(p, 0, 16), 'step too high')
  throws(() => toggleStep(p, 0, -1), 'negative step')
  throws(() => toggleStep(p, 0, 1.5), 'fractional step')
  throws(() => toggleStep({}, 0, 0), 'not a pattern')
  throws(() => toggleStep(null, 0, 0), 'null pattern')
})

// ---- setVelocity --------------------------------------------------------------

test('setVelocity stores the exact value', () => {
  let p = createPattern()
  for (const v of [0.1, 0.25, 0.5, 0.75, 1]) {
    p = setVelocity(p, 0, 4, v)
    eq(p.hits[0][4], v, `velocity ${v}`)
  }
})

test('setVelocity clamps out of range values', () => {
  let p = createPattern()
  p = setVelocity(p, 1, 1, 4)
  eq(p.hits[1][1], 1, 'over 1 clamps to 1')
  p = setVelocity(p, 1, 1, -3)
  eq(p.hits[1][1], 0, 'negative clamps to 0')
  p = setVelocity(p, 1, 1, Number.POSITIVE_INFINITY)
  eq(p.hits[1][1], 1, 'infinity clamps to 1')
  throws(() => setVelocity(p, 1, 1, Number.NaN), 'NaN throws')
})

test('setVelocity zero clears and neighbours survive', () => {
  let p = createPattern()
  p = setVelocity(p, 2, 3, 0.8)
  p = setVelocity(p, 2, 4, 0.8)
  p = setVelocity(p, 2, 3, 0)
  eq(p.hits[2][3], 0, 'cleared')
  eq(p.hits[2][4], 0.8, 'neighbour kept')
})

test('setVelocity guards bounds and does not mutate', () => {
  const base = createPattern()
  throws(() => setVelocity(base, 9, 0, 0.5), 'lane too high')
  throws(() => setVelocity(base, 0, 16, 0.5), 'step too high')
  const p = setVelocity(base, 0, 0, 0.5)
  eq(base.hits[0][0], 0, 'input untouched')
  ok(p !== base, 'new pattern')
})

// ---- clearing -----------------------------------------------------------------

test('clearLane empties only the named lane', () => {
  let p = filled()
  p = clearLane(p, 3)
  eq(hits(p, 3), 0, 'lane cleared')
  for (let lane = 0; lane < 9; lane++) {
    if (lane === 3) continue
    eq(hits(p, lane), 1, `${KIT[lane].slug} untouched`)
  }
})

test('clearLane keeps shape, swing and gains', () => {
  let p = setSwing(filled(8), 0.3)
  p = setLaneGain(p, 0, 1.7)
  p = clearLane(p, 0)
  eq(p.steps, 8, 'steps kept')
  eq(p.swing, 0.3, 'swing kept')
  eq(p.gains[0], 1.7, 'gain kept')
})

test('clearPattern empties everything but keeps the settings', () => {
  let p = setSwing(filled(), 0.4)
  p = setLaneGain(p, 2, 0.5)
  p = clearPattern(p)
  eq(total(p), 0, 'no hits left')
  eq(p.steps, 16, 'steps kept')
  eq(p.lanes, 9, 'lanes kept')
  eq(p.swing, 0.4, 'swing kept')
  eq(p.gains[2], 0.5, 'gain kept')
})

test('clearing guards its arguments', () => {
  throws(() => clearLane(createPattern(), 9), 'lane too high')
  throws(() => clearLane(createPattern(), -1), 'negative lane')
  throws(() => clearPattern({}), 'not a pattern')
})

// ---- swing --------------------------------------------------------------------

test('setSwing stores and clamps to 0..0.66', () => {
  eq(setSwing(createPattern(), 0.25).swing, 0.25, 'stores 0.25')
  eq(setSwing(createPattern(), 0).swing, 0, 'stores 0')
  eq(setSwing(createPattern(), 5).swing, 0.66, 'clamps high')
  eq(setSwing(createPattern(), -2).swing, 0, 'clamps low')
  near(0.66, 2 / 3, 0.01, '0.66 is the 2/3 ceiling')
})

test('setSwing does not mutate and guards bad input', () => {
  const base = createPattern()
  setSwing(base, 0.5)
  eq(base.swing, 0, 'input untouched')
  throws(() => setSwing(base, Number.NaN), 'NaN swing')
  throws(() => setSwing({}, 0.1), 'not a pattern')
})

test('resolveSwing is zero everywhere with no swing', () => {
  for (let step = 0; step < 16; step++) eq(resolveSwing(step, 0), 0, `step ${step} unswung`)
})

test('resolveSwing leaves every even step on the grid', () => {
  for (const swing of [0.1, 0.33, 0.66]) {
    for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
      eq(resolveSwing(step, swing), 0, `even step ${step} at ${swing}`)
    }
  }
})

test('resolveSwing pushes odd steps late by the swing fraction', () => {
  near(resolveSwing(1, 0.5), 0.5, 1e-12, 'half a step')
  near(resolveSwing(3, 0.25), 0.25, 1e-12, 'quarter step')
  near(resolveSwing(15, 0.66), 0.66, 1e-12, 'last odd step')
})

test('resolveSwing maxes out at two thirds of a step', () => {
  const stepDur = 0.125
  const offset = resolveSwing(1, 0.66, stepDur)
  near(offset / stepDur, 2 / 3, 0.01, 'offset is 2/3 of a step')
  near(offset, stepDur * 2 / 3, 0.002, 'offset in seconds')
})

test('resolveSwing scales with the step duration', () => {
  near(resolveSwing(1, 0.66, 0.5), 0.33, 1e-12, 'half-second step')
  near(resolveSwing(1, 0.66, 2), 1.32, 1e-12, 'two-second step')
})

test('resolveSwing is monotonically later as swing rises', () => {
  let prev = -1
  for (const swing of [0, 0.1, 0.2, 0.4, 0.66]) {
    const v = resolveSwing(1, swing)
    ok(v > prev, `swing ${swing} moves later`)
    prev = v
  }
})

test('resolveSwing guards its arguments', () => {
  throws(() => resolveSwing(-1, 0.2), 'negative step')
  throws(() => resolveSwing(1.5, 0.2), 'fractional step')
  throws(() => resolveSwing(1, Number.NaN), 'NaN swing')
  throws(() => resolveSwing(1, 0.2, 0), 'zero stepDur')
  eq(resolveSwing(1, 3), 0.66, 'over-range swing clamps')
})

// ---- lane gain ----------------------------------------------------------------

test('setLaneGain stores and clamps to 0..2', () => {
  let p = createPattern()
  p = setLaneGain(p, 0, 0.5)
  eq(p.gains[0], 0.5, 'stores 0.5')
  p = setLaneGain(p, 1, 9)
  eq(p.gains[1], 2, 'clamps to 2')
  p = setLaneGain(p, 2, -9)
  eq(p.gains[2], 0, 'clamps to 0')
  eq(p.gains[3], 1, 'other lanes untouched')
  throws(() => setLaneGain(p, 9, 1), 'lane too high')
  throws(() => setLaneGain(p, 0, Number.NaN), 'NaN gain')
})

// ---- trigger ------------------------------------------------------------------

test('every kit voice triggers real nodes at the requested time', () => {
  for (const slug of SLUGS) {
    const ctx = makeCtx()
    const out = sink()
    trigger(ctx, out, slug, 1.5, 0.8)
    ok(ctx.nodes.length >= 2, `${slug} builds several nodes, got ${ctx.nodes.length}`)
    const sources = ctx.nodes.filter((n) => n.starts.length > 0)
    ok(sources.length >= 1, `${slug} starts a source`)
    // Clap staggers its bursts, so allow a few ms of spread past the requested time.
    for (const src of sources) ok(src.starts[0].when >= 1.5 && src.starts[0].when <= 1.53, `${slug} starts on time`)
    for (const src of sources) ok(src.stops[0] > src.starts[0].when, `${slug} stops after it starts`)
    ok(ctx.nodes.some((n) => n.out.includes(out)), `${slug} reaches the output`)
  }
})

test('trigger velocity scales every envelope peak', () => {
  for (const slug of SLUGS) {
    const loud = makeCtx()
    const soft = makeCtx()
    trigger(loud, sink(), slug, 0, 1)
    trigger(soft, sink(), slug, 0, 0.25)
    const peak = (ctx) => Math.max(...ctx.nodes.filter((n) => n.kind === 'gain').map(peakOf))
    ok(peak(loud) > 0, `${slug} loud peak`)
    near(peak(soft) / peak(loud), 0.25, 0.02, `${slug} scales with velocity`)
  }
})

test('trigger clamps velocity and treats zero as a rest', () => {
  const ctx = makeCtx()
  eq(trigger(ctx, sink(), 'kick', 0, 0), null, 'zero velocity is silent')
  eq(ctx.nodes.length, 0, 'no nodes for a rest')
  const hot = makeCtx()
  trigger(hot, sink(), 'kick', 0, 5)
  const peak = Math.max(...hot.nodes.filter((n) => n.kind === 'gain').map(peakOf))
  ok(peak <= 1, `clamped peak ${peak}`)
  const cold = makeCtx()
  trigger(cold, sink(), 'kick', 0, -2)
  eq(cold.nodes.length, 0, 'negative velocity is silent')
  const def = makeCtx()
  trigger(def, sink(), 'kick', 0, undefined)
  ok(def.nodes.length > 0, 'missing velocity defaults to unity')
})

test('trigger guards unknown drums, times and bad contexts', () => {
  throws(() => trigger(makeCtx(), sink(), 'cowbell', 0, 1), 'unknown drum')
  throws(() => trigger(makeCtx(), sink(), 'kick', Number.NaN, 1), 'NaN when')
  throws(() => trigger(makeCtx(), sink(), undefined, 0, 1), 'missing slug')
})

test('voice trim is wired and nothing sums past unity', () => {
  for (const slug of SLUGS) {
    const lane = SLUGS.indexOf(slug)
    const trim = KIT[lane].params.trim
    const ctx = makeCtx()
    trigger(ctx, sink(), slug, 0, 1)
    const peak = Math.max(...ctx.nodes.filter((n) => n.kind === 'gain').map(peakOf))
    near(peak, trim, 1e-9, `${slug} peak follows its trim`)
    if (trim <= 1) ok(peak <= 1.02, `${slug} unit peak ${peak.toFixed(3)} stays under unity`)
  }
})

test('kick drops pitch an octave and a half', () => {
  const ctx = makeCtx()
  trigger(ctx, sink(), 'kick', 0, 1)
  const osc = ctx.nodes.find((n) => n.kind === 'osc')
  const freq = osc.frequency.calls
  const start = freq.find((c) => c.m === 'set').v
  const end = freq.find((c) => c.m === 'exp').v
  near(start, 150, 1e-9, 'starts at 150 Hz')
  ok(end < start / 2, `ends at ${end} Hz, well below half`)
})

test('snare has a highpassed noise layer plus a tuned body', () => {
  const ctx = makeCtx()
  trigger(ctx, sink(), 'snare', 0, 1)
  const hp = ctx.nodes.find((n) => n.kind === 'filter')
  eq(hp.type, 'highpass', 'noise is highpassed')
  ok(hp.frequency.calls[0].v > 1000, 'highpass well above the body')
  const body = ctx.nodes.find((n) => n.kind === 'osc')
  eq(body.frequency.calls[0].v, 190, 'body tuned to 190 Hz')
})

test('rim is the shortest click in the kit', () => {
  const ctx = makeCtx()
  trigger(ctx, sink(), 'rim', 0, 1)
  const src = ctx.nodes.find((n) => n.kind === 'source')
  ok(src.stops[0] - src.starts[0].when < 0.06, 'rim is gone inside 60 ms')
  const hp = ctx.nodes.find((n) => n.kind === 'filter')
  eq(hp.type, 'highpass', 'rim is highpassed')
})

test('clap fires three bursts then a tail', () => {
  const ctx = makeCtx()
  trigger(ctx, sink(), 'clap', 0, 1)
  const src = ctx.nodes.filter((n) => n.kind === 'source')
  eq(src.length, 4, 'three bursts plus a tail')
  near(src[0].starts[0].when, 0, 1e-9, 'first burst on time')
  near(src[1].starts[0].when, 0.012, 1e-9, 'second burst spaced')
  near(src[2].starts[0].when, 0.024, 1e-9, 'third burst spaced')
  ok(src[3].stops[0] > src[2].stops[0], 'tail outlasts the bursts')
  const bp = ctx.nodes.find((n) => n.kind === 'filter')
  eq(bp.type, 'bandpass', 'clap is band-passed')
})

test('open hat rings far longer than closed', () => {
  const decayOf = (slug) => {
    const ctx = makeCtx()
    trigger(ctx, sink(), slug, 0, 1)
    const src = ctx.nodes.find((n) => n.kind === 'source')
    return src.stops[0] - src.starts[0].when
  }
  ok(decayOf('hatOpen') > decayOf('hatClosed') * 4, 'open hat sustains')
  ok(decayOf('hatClosed') < 0.1, 'closed hat is short')
})

test('toms sweep down from different tunings', () => {
  const start = (slug) => {
    const ctx = makeCtx()
    trigger(ctx, sink(), slug, 0, 1)
    return ctx.nodes.find((n) => n.kind === 'osc').frequency.calls[0].v
  }
  ok(start('tomHigh') > start('tomLow'), 'high tom sits above low tom')
  for (const slug of ['tomHigh', 'tomLow']) {
    const ctx = makeCtx()
    trigger(ctx, sink(), slug, 0, 1)
    const f = ctx.nodes.find((n) => n.kind === 'osc').frequency.calls
    ok(f.find((c) => c.m === 'exp').v < f[0].v, `${slug} sweeps down`)
  }
})

test('ride stacks five detuned partials', () => {
  const ctx = makeCtx()
  trigger(ctx, sink(), 'ride', 0, 1)
  const osc = ctx.nodes.filter((n) => n.kind === 'osc')
  eq(osc.length, 5, 'five partials')
  eq(new Set(osc.map((o) => o.frequency.calls[0].v)).size, 5, 'all detuned')
  ok(ctx.nodes.some((n) => n.kind === 'filter' && n.type === 'bandpass'), 'ride is band-passed')
})

test('the noise buffer is built once per context', () => {
  const ctx = makeCtx()
  for (const slug of ['hatClosed', 'hatOpen', 'snare', 'clap']) trigger(ctx, sink(), slug, 0, 1)
  eq(ctx.buffers, 1, 'one cached buffer')
})

// ---- renderPattern ------------------------------------------------------------

function schedule(fn) {
  const ctx = makeCtx()
  const out = sink()
  const result = fn(ctx, out)
  const raw = ctx.nodes
    .filter((n) => n.kind === 'osc' || n.kind === 'source')
    .map((n) => n.starts[0].when)
    .sort((a, b) => a - b)
  // One trigger can start several sources; collapse anything within 5 ms into one onset.
  const events = []
  for (const t of raw) {
    if (!events.length || t - events[events.length - 1] > 0.005) events.push(t)
  }
  return { ctx, out, result, events }
}

test('renderPattern fires exactly the hits it was given', () => {
  let p = createPattern()
  for (let step = 0; step < 16; step += 4) p = toggleStep(p, 0, step)
  for (let step = 2; step < 16; step += 4) p = toggleStep(p, 2, step)
  const { result } = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 2, startAt: 0, out }))
  eq(result.events, 16, 'eight hits in each of two bars')
  eq(total(p), 8, 'pattern agrees per bar')
})

test('renderPattern places hits on the grid at the right tempo', () => {
  let p = createPattern()
  p = toggleStep(p, 0, 0)
  p = toggleStep(p, 0, 4)
  const { result } = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 60, bars: 1, startAt: 1, out }))
  near(result.duration, 4, 1e-12, 'one bar at 60 bpm is four seconds')
  const events = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 60, bars: 1, startAt: 1, out })).events
  near(events[0], 1, 1e-9, 'step 0 at start')
  near(events[1], 2, 1e-9, 'step 4 is one second later')
})

test('renderPattern applies swing to odd steps only', () => {
  let p = createPattern()
  p = toggleStep(p, 0, 1)
  p = toggleStep(p, 0, 2)
  const dry = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 1, startAt: 0, out }))
  p = setSwing(p, 0.66)
  const swung = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 1, startAt: 0, out }))
  const stepDur = 60 / 120 / 4
  near(swung.events[0] - dry.events[0], 0.66 * stepDur, 1e-9, 'odd step delayed by 2/3 step')
  near(swung.events[1], dry.events[1], 1e-9, 'even step stays put')
})

test('renderPattern repeats the bar with the bar offset', () => {
  let p = createPattern()
  p = toggleStep(p, 0, 0)
  const { result } = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 3, startAt: 0, out }))
  const events = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 3, startAt: 0, out })).events
  eq(result.events, 3, 'one hit per bar')
  near(events[1] - events[0], 2, 1e-9, 'bars are two seconds apart at 120 bpm')
})

test('renderPattern folds lane gain into the velocity it sends', () => {
  let p = createPattern()
  p = toggleStep(p, 0, 0)
  const full = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 1, out }))
  const loud = Math.max(...full.ctx.nodes.filter((n) => n.kind === 'gain').map(peakOf))
  p = setLaneGain(p, 0, 0.5)
  const half = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 1, out }))
  const soft = Math.max(...half.ctx.nodes.filter((n) => n.kind === 'gain').map(peakOf))
  near(soft / loud, 0.5, 0.02, 'gain halves the peak')
})

test('renderPattern skips muted lanes and rests', () => {
  let p = createPattern()
  for (let lane = 0; lane < 3; lane++) p = toggleStep(p, lane, 0)
  p = setLaneGain(p, 1, 0)
  const { result } = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 120, bars: 1, out }))
  eq(result.events, 2, 'muted lane dropped')
})

test('renderPattern accepts an omitted out and startAt', () => {
  let p = createPattern()
  p = toggleStep(p, 0, 2)
  const ctx = makeCtx()
  const result = renderPattern(ctx, p, { bpm: 128, bars: 1 })
  eq(result.events, 1, 'schedules anyway')
  near(result.duration, 4 * (60 / 128), 1e-12, 'duration follows bpm')
})

test('renderPattern guards its options', () => {
  const p = createPattern()
  const ctx = makeCtx()
  throws(() => renderPattern(ctx, p, {}), 'missing bpm')
  throws(() => renderPattern(ctx, p, { bpm: 0 }), 'zero bpm')
  throws(() => renderPattern(ctx, p, { bpm: -120 }), 'negative bpm')
  throws(() => renderPattern(ctx, p, { bpm: 120, bars: 0 }), 'zero bars')
  throws(() => renderPattern(ctx, p, { bpm: 120, bars: 1.5 }), 'fractional bars')
  throws(() => renderPattern(ctx, p, { bpm: 120, startAt: -1 }), 'negative startAt')
  throws(() => renderPattern(ctx, p, { bpm: 120, startAt: Number.NaN }), 'NaN startAt')
  throws(() => renderPattern({ sampleRate: 0 }, p, { bpm: 120 }), 'bad sample rate')
  throws(() => renderPattern(ctx, {}, { bpm: 120 }), 'bad pattern')
})

test('renderPattern rejects a pattern with missing rows', () => {
  const p = createPattern()
  p.hits.pop()
  throws(() => renderPattern(makeCtx(), p, { bpm: 120 }), 'row count below lanes')
})

test('a full kit pattern survives a round trip', () => {
  let p = createPattern(16, 9)
  for (let lane = 0; lane < 9; lane++) p = toggleStep(p, lane, lane * 1.5 | 0)
  p = setSwing(p, 0.2)
  p = setVelocity(p, 8, 8, 0.9)
  eq(p.hits[8][8], 0.9, 'velocity applied')
  eq(p.swing, 0.2, 'swing applied')
  const { result } = schedule((ctx, out) => renderPattern(ctx, p, { bpm: 96, bars: 1, out }))
  eq(result.events, total(p), 'every hit scheduled')
})

report()
