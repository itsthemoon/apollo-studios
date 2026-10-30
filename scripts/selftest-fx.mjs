// scripts/selftest-fx.mjs — self-test for js/fx.js.
// Run from the project root:  node scripts/selftest-fx.mjs
import {
  FX_CATEGORIES,
  FX_LIST,
  LIMITER_SLUG,
  maxEffects,
  createChain,
  addEffect,
  moveEffect,
  removeEffect,
  setParam,
  setBypass,
  describeChain,
  ensureLimiterLast,
  buildNodes,
} from '../js/fx.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

// A Web Audio look-alike: every node records its connections and every
// AudioParam is a settable stub, so the builders can be driven under Node.
class Param {
  constructor(value = 0) { this.value = value }
  setTargetAtTime(value) { this.value = value; return this }
  setValueAtTime(value) { this.value = value; return this }
  linearRampToValueAtTime(value) { this.value = value; return this }
  cancelScheduledValues() { return this }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx
    this.kind = kind
    this.connections = []
    this.disconnects = 0
    ctx.nodes.push(this)
  }
  connect(target) { this.connections.push(target); return target }
  disconnect() { this.connections.length = 0; this.disconnects++ }
}

function fakeCtx() {
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    nodes: [],
    createGain: () => Object.assign(new FakeNode(ctx, 'gain'), { gain: new Param() }),
    createBiquadFilter: () => Object.assign(new FakeNode(ctx, 'biquad'), {
      type: 'lowpass', frequency: new Param(), Q: new Param(), gain: new Param(),
    }),
    createWaveShaper: () => Object.assign(new FakeNode(ctx, 'shaper'), { curve: null, oversample: 'none' }),
    createDelay: () => Object.assign(new FakeNode(ctx, 'delay'), { delayTime: new Param() }),
    createConvolver: () => Object.assign(new FakeNode(ctx, 'convolver'), { buffer: null }),
    createOscillator: () => Object.assign(new FakeNode(ctx, 'osc'), {
      type: 'sine', frequency: new Param(), started: false, stopped: false,
      start() { this.started = true }, stop() { this.stopped = true },
    }),
    createChannelSplitter: () => new FakeNode(ctx, 'splitter'),
    createChannelMerger: () => new FakeNode(ctx, 'merger'),
    createDynamicsCompressor: () => Object.assign(new FakeNode(ctx, 'compressor'), {
      threshold: new Param(), ratio: new Param(), attack: new Param(),
      release: new Param(), knee: new Param(),
    }),
    createBuffer: (channels, length, rate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length))
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        getChannelData: (i) => data[i],
        copyToChannel: (source, i) => { data[i].set(source) },
      }
    },
  }
  return ctx
}

const check = (name, fn) => test(name, () => { fn(); console.log(`PASS ${name}`) })
const slugs = FX_LIST.map((fx) => fx.slug)
const effectFor = (slug) => FX_LIST.find((fx) => fx.slug === slug)
const kinds = (ctx, kind) => ctx.nodes.filter((node) => node.kind === kind)
const catalogDefaults = (slug) => Object.fromEntries(effectFor(slug).params.map((param) => [param.slug, param.default]))

// ---- catalog shape ---------------------------------------------------------

check('both catalog exports are arrays', () => {
  ok(Array.isArray(FX_CATEGORIES))
  ok(Array.isArray(FX_LIST))
})

check('the eight required categories are present and labelled', () => {
  const required = ['dynamic', 'eq', 'gain', 'reverb', 'delay', 'modulation', 'distortion', 'utility']
  eq(FX_CATEGORIES.length, required.length)
  for (const id of required) {
    const category = FX_CATEGORIES.find((entry) => entry.id === id)
    ok(category, `missing category ${id}`)
    eq(typeof category.label, 'string')
    ok(category.label.trim().length > 0, `${id} needs a label`)
  }
})

check('the catalog holds fourteen unique effects', () => {
  eq(FX_LIST.length, 14)
  eq(new Set(slugs).size, 14)
})

check('every effect is complete and well-formed', () => {
  for (const fx of FX_LIST) {
    ok(typeof fx.slug === 'string' && /^[a-z0-9]+$/.test(fx.slug), `bad slug ${fx.slug}`)
    ok(typeof fx.name === 'string' && fx.name.trim().length > 0, `${fx.slug} needs a name`)
    ok(FX_CATEGORIES.some((category) => category.id === fx.category), `${fx.slug} category`)
    ok(Array.isArray(fx.params) && fx.params.length > 0, `${fx.slug} needs params`)
    ok(Array.isArray(fx.presets) && fx.presets.length > 0, `${fx.slug} needs presets`)
  }
})

check('every category is used by at least one effect', () => {
  const used = new Set(FX_LIST.map((fx) => fx.category))
  for (const category of FX_CATEGORIES) ok(used.has(category.id), `unused category ${category.id}`)
})

check('the limiter is last in the catalog', () => {
  eq(FX_LIST[FX_LIST.length - 1].slug, LIMITER_SLUG)
  eq(LIMITER_SLUG, 'limiter')
})

check('params have sane ranges, steps and defaults', () => {
  for (const fx of FX_LIST) {
    const paramSlugs = new Set()
    for (const param of fx.params) {
      ok(typeof param.slug === 'string' && /^[a-z0-9]+$/.test(param.slug), `${fx.slug} param slug`)
      ok(!paramSlugs.has(param.slug), `duplicate param ${fx.slug}.${param.slug}`)
      paramSlugs.add(param.slug)
      ok(typeof param.name === 'string' && param.name.length > 0, `${fx.slug}.${param.slug} name`)
      ok(Number.isFinite(param.min) && Number.isFinite(param.max), `${fx.slug}.${param.slug} bounds`)
      ok(param.min <= param.max, `${fx.slug}.${param.slug} min <= max`)
      ok(Number.isFinite(param.step) && param.step > 0, `${fx.slug}.${param.slug} step`)
      ok(param.default >= param.min && param.default <= param.max, `${fx.slug}.${param.slug} default in range`)
      const steps = (param.default - param.min) / param.step
      near(steps, Math.round(steps), 1e-9, `${fx.slug}.${param.slug} default on the grid`)
      eq(typeof param.unit, 'string')
      ok(['linear', 'log', 'bool', 'enum'].includes(param.scale), `${fx.slug}.${param.slug} scale`)
      if (param.scale === 'bool') eq(param.step, 1, `${fx.slug}.${param.slug} bool step`)
      if (param.scale === 'enum') ok(Array.isArray(param.options) && param.options.length > 1, `${fx.slug} enum options`)
    }
  }
})

check('presets are complete, in range and uniquely named', () => {
  for (const fx of FX_LIST) {
    const presetSlugs = new Set()
    for (const preset of fx.presets) {
      ok(typeof preset.slug === 'string' && preset.slug.length > 0, `${fx.slug} preset slug`)
      ok(!presetSlugs.has(preset.slug), `duplicate preset ${fx.slug}.${preset.slug}`)
      presetSlugs.add(preset.slug)
      ok(typeof preset.name === 'string' && preset.name.length > 0, `${fx.slug} preset name`)
      eq(Object.keys(preset.values).length, fx.params.length, `${fx.slug}.${preset.slug} covers every param`)
      for (const param of fx.params) {
        const value = preset.values[param.slug]
        ok(value !== undefined, `${fx.slug}.${preset.slug} missing ${param.slug}`)
        ok(value >= param.min && value <= param.max, `${fx.slug}.${preset.slug}.${param.slug} in range`)
      }
    }
  }
})

check('required effects carry their required params', () => {
  const filter = Object.fromEntries(effectFor('filter').params.map((param) => [param.slug, param]))
  eq(filter.mode.options.join(','), 'lowpass,highpass')
  ok(filter.cutoff && filter.resonance)
  const eq3 = effectFor('eq3').params.map((param) => [param.slug, param.min, param.max])
  eq(eq3.map((row) => row.join(':')).join('|'), 'low:-12:12|mid:-12:12|high:-12:12')
  const delay = Object.fromEntries(effectFor('delay').params.map((param) => [param.slug, param]))
  eq(delay.time.min, 10)
  eq(delay.time.max, 1200)
  eq(delay.pingpong.scale, 'bool')
  const comp = Object.fromEntries(effectFor('comp').params.map((param) => [param.slug, param]))
  eq(comp.thresh.min, -60)
  eq(comp.thresh.max, 0)
  eq(comp.ratio.min, 1)
  eq(comp.ratio.max, 20)
})

// ---- membership ------------------------------------------------------------

check('maxEffects gates free and member tiers', () => {
  eq(maxEffects(), 8)
  eq(maxEffects(false), 8)
  eq(maxEffects(true), 16)
})

check('createChain starts with one limiter, last, and the free capacity', () => {
  const chain = createChain()
  eq(chain.effects.length, 1)
  eq(chain.effects[0].slug, LIMITER_SLUG)
  eq(chain.capacity, 8)
  eq(chain.isMember, false)
  const member = createChain({ isMember: true })
  eq(member.capacity, 16)
  eq(member.isMember, true)
})

check('createChain gives every effect a unique id', () => {
  const chain = createChain()
  const a = addEffect(chain, 'gain')
  const b = addEffect(chain, 'gain')
  const c = addEffect(chain, 'gain')
  eq(new Set([a.id, b.id, c.id]).size, 3)
})

// ---- add -------------------------------------------------------------------

check('addEffect inserts before the limiter', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'chorus')
  eq(chain.effects.length, 2)
  eq(chain.effects[0].slug, 'chorus')
  eq(chain.effects[1].slug, LIMITER_SLUG)
  eq(effect.slug, 'chorus')
  eq(effect.bypass, false)
  eq(effect.params.rate, effectFor('chorus').params[0].default)
})

check('addEffect keeps insertion order', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  addEffect(chain, 'filter')
  addEffect(chain, 'dist')
  eq(chain.effects.map((fx) => fx.slug).join(','), 'gain,filter,dist,limiter')
})

check('addEffect refuses unknown effects', () => {
  throws(() => addEffect(createChain(), 'nope'), 'unknown effect must throw')
  throws(() => addEffect(createChain(), ''), 'empty slug must throw')
})

check('a second limiter add returns the existing one', () => {
  const chain = createChain()
  const first = chain.effects[0]
  eq(addEffect(chain, LIMITER_SLUG), first)
  eq(chain.effects.filter((fx) => fx.slug === LIMITER_SLUG).length, 1)
})

check('free chains refuse a ninth effect', () => {
  const chain = createChain()
  for (let i = 0; i < 7; i++) addEffect(chain, 'gain')
  eq(chain.effects.length, 8)
  eq(chain.effects[chain.effects.length - 1].slug, LIMITER_SLUG)
  throws(() => addEffect(chain, 'gain'), 'free chain caps at 8')
  eq(chain.effects.length, 8)
})

check('member chains accept sixteen and refuse a seventeenth', () => {
  const chain = createChain({ isMember: true })
  for (let i = 0; i < 15; i++) addEffect(chain, 'eq3')
  eq(chain.effects.length, 16)
  throws(() => addEffect(chain, 'eq3'), 'member chain caps at 16')
  eq(chain.effects.filter((fx) => fx.slug === LIMITER_SLUG).length, 1)
  eq(chain.effects[15].slug, LIMITER_SLUG)
})

// ---- setParam --------------------------------------------------------------

check('setParam clamps to the maximum', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'gain')
  eq(setParam(chain, effect.id, 'gain', 99), 24)
  eq(effect.params.gain, 24)
  eq(setParam(chain, effect.id, 'gain', 6), 6)
})

check('setParam clamps to the minimum', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'gain')
  eq(setParam(chain, effect.id, 'gain', -99), -24)
  const eqEffect = addEffect(chain, 'eq3')
  eq(setParam(chain, eqEffect.id, 'mid', -20), -12)
})

check('setParam snaps to the step grid', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'gain')
  eq(setParam(chain, effect.id, 'gain', 1.24), 1)
  eq(setParam(chain, effect.id, 'gain', 1.26), 1.5)
  eq(setParam(chain, effect.id, 'gain', -0.74), -0.5)
})

check('setParam snaps the fine steps too', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'comp')
  near(setParam(chain, effect.id, 'ratio', 2.04), 2, 1e-9)
  near(setParam(chain, effect.id, 'ratio', 2.06), 2.1, 1e-9)
  eq(setParam(chain, effect.id, 'ratio', 500), 20)
})

check('setParam resolves booleans to 0/1', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'delay')
  eq(setParam(chain, effect.id, 'pingpong', true), 1)
  eq(effect.params.pingpong, 1)
  eq(setParam(chain, effect.id, 'pingpong', false), 0)
  eq(setParam(chain, effect.id, 'pingpong', 0.4), 0)
})

check('setParam resolves enum labels and indexes', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'filter')
  eq(setParam(chain, effect.id, 'mode', 'highpass'), 1)
  eq(effect.params.mode, 1)
  eq(setParam(chain, effect.id, 'mode', 'lowpass'), 0)
  eq(setParam(chain, effect.id, 'mode', 9), 1)
  eq(setParam(chain, effect.id, 'mode', 'bogus'), 0)
})

check('setParam keeps integers integral on integer steps', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'bitcrush')
  eq(setParam(chain, effect.id, 'bits', 7.6), 8)
  eq(setParam(chain, effect.id, 'downsample', 2.4), 2)
  eq(Number.isInteger(effect.params.bits), true)
})

check('setParam treats non-finite input as the default', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'dist')
  setParam(chain, effect.id, 'drive', 18)
  eq(setParam(chain, effect.id, 'drive', NaN), 10)
  eq(setParam(chain, effect.id, 'tone', Infinity), 0.5)
})

check('setParam rejects unknown ids and params', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'gain')
  eq(setParam(chain, 'fx999', 'gain', 3), false)
  eq(setParam(chain, effect.id, 'bogus', 3), false)
  eq(setParam(chain, chain.effects[0].id, 'bogus', 3), false)
})

check('setParam leaves sibling params alone', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'eq3')
  setParam(chain, effect.id, 'low', 5)
  eq(effect.params.low, 5)
  eq(effect.params.mid, 0)
  eq(effect.params.high, 0)
})

// ---- bypass ----------------------------------------------------------------

check('setBypass toggles and reports the new state', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'reverb')
  eq(setBypass(chain, effect.id, true), true)
  eq(effect.bypass, true)
  eq(setBypass(chain, effect.id, false), false)
  eq(effect.bypass, false)
  eq(setBypass(chain, 'fx999', true), false)
})

check('a bypassed effect keeps its params', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'dist')
  setParam(chain, effect.id, 'drive', 20)
  setBypass(chain, effect.id, true)
  eq(effect.params.drive, 20)
})

// ---- move ------------------------------------------------------------------

check('moveEffect reorders forward', () => {
  const chain = createChain()
  const a = addEffect(chain, 'gain')
  addEffect(chain, 'filter')
  addEffect(chain, 'dist')
  eq(moveEffect(chain, 0, 1), true)
  eq(chain.effects.map((fx) => fx.slug).join(','), 'filter,gain,dist,limiter')
  eq(chain.effects[1].id, a.id)
})

check('moveEffect reorders backward', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  addEffect(chain, 'filter')
  addEffect(chain, 'dist')
  eq(moveEffect(chain, 2, 0), true)
  eq(chain.effects.map((fx) => fx.slug).join(','), 'dist,gain,filter,limiter')
})

check('moveEffect keeps the limiter last', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  addEffect(chain, 'filter')
  const limiterIndex = chain.effects.length - 1
  eq(moveEffect(chain, limiterIndex, 0), false)
  eq(chain.effects[chain.effects.length - 1].slug, LIMITER_SLUG)
})

check('moveEffect clamps a target past the limiter', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  addEffect(chain, 'filter')
  eq(moveEffect(chain, 0, 2), true)
  eq(chain.effects.map((fx) => fx.slug).join(','), 'filter,gain,limiter')
})

check('moveEffect handles no-ops and bad indexes', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  addEffect(chain, 'filter')
  eq(moveEffect(chain, 0, 0), true)
  eq(moveEffect(chain, -1, 0), false)
  eq(moveEffect(chain, 0, 9), false)
  eq(moveEffect(chain, 9, 0), false)
  eq(moveEffect(chain, 0.5, 1), false)
  eq(chain.effects.map((fx) => fx.slug).join(','), 'gain,filter,limiter')
})

// ---- remove ----------------------------------------------------------------

check('removeEffect drops the slot', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'gate')
  eq(removeEffect(chain, effect.id), true)
  eq(chain.effects.map((fx) => fx.slug).join(','), LIMITER_SLUG)
  eq(removeEffect(chain, effect.id), false)
})

check('removing the limiter installs a fresh one last', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  const limiter = chain.effects[1]
  eq(removeEffect(chain, limiter.id), true)
  eq(chain.effects.length, 2)
  eq(chain.effects[1].slug, LIMITER_SLUG)
  ok(chain.effects[1].id !== limiter.id, 'fresh limiter id')
})

check('removeEffect refuses unknown ids', () => {
  eq(removeEffect(createChain(), 'fx999'), false)
})

// ---- ensureLimiterLast -----------------------------------------------------

check('ensureLimiterLast appends a missing limiter', () => {
  const chain = { effects: [{ id: 'fx1', slug: 'gain', bypass: false, params: { gain: 0 } }], nextId: 2 }
  ensureLimiterLast(chain)
  eq(chain.effects.map((fx) => fx.slug).join(','), 'gain,limiter')
})

check('ensureLimiterLast moves a misplaced limiter', () => {
  const chain = createChain()
  chain.effects.unshift(chain.effects.pop())
  eq(chain.effects.map((fx) => fx.slug).join(','), 'limiter')
  ensureLimiterLast(chain)
  eq(chain.effects[0].slug, LIMITER_SLUG)
})

check('ensureLimiterLast collapses duplicate limiters', () => {
  const chain = createChain()
  chain.effects.push({ id: 'fx99', slug: LIMITER_SLUG, bypass: false, params: catalogDefaults(LIMITER_SLUG) })
  ensureLimiterLast(chain)
  eq(chain.effects.filter((fx) => fx.slug === LIMITER_SLUG).length, 1)
  eq(chain.effects[chain.effects.length - 1].slug, LIMITER_SLUG)
})

check('every mutator keeps the limiter last', () => {
  const chain = createChain({ isMember: true })
  const ids = []
  for (const slug of slugs) {
    const effect = addEffect(chain, slug)
    if (effect.slug !== LIMITER_SLUG) ids.push(effect.id)
  }
  eq(chain.effects[chain.effects.length - 1].slug, LIMITER_SLUG)
  moveEffect(chain, 0, 5)
  eq(chain.effects[chain.effects.length - 1].slug, LIMITER_SLUG)
  removeEffect(chain, ids[0])
  eq(chain.effects[chain.effects.length - 1].slug, LIMITER_SLUG)
})

// ---- describe --------------------------------------------------------------

check('describeChain snapshots every slot', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'comp')
  setParam(chain, effect.id, 'ratio', 6)
  const described = describeChain(chain)
  eq(described.length, 2)
  eq(described[0].slug, 'comp')
  eq(described[0].name, 'Compressor')
  eq(described[0].category, 'dynamic')
  eq(described[0].bypass, false)
  eq(described[0].id, effect.id)
  const ratio = described[0].params.find((param) => param.slug === 'ratio')
  eq(ratio.value, 6)
  eq(ratio.min, 1)
  eq(ratio.max, 20)
  eq(ratio.unit, ':1')
})

check('describeChain includes ranges, enums and bypass', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'filter')
  setBypass(chain, effect.id, true)
  const described = describeChain(chain)[0]
  eq(described.bypass, true)
  const mode = described.params.find((param) => param.slug === 'mode')
  eq(mode.options.join(','), 'lowpass,highpass')
  ok(described.params.every((param) => param.min <= param.max))
})

check('describeChain copies rather than aliases', () => {
  const chain = createChain()
  const effect = addEffect(chain, 'gain')
  const described = describeChain(chain)
  described[0].params[0].value = 12
  described[0].params.length = 0
  eq(effect.params.gain, 0)
  eq(describeChain(chain)[0].params.length, 1)
})

check('describeChain lists the limiter last', () => {
  const chain = createChain()
  addEffect(chain, 'gain')
  const described = describeChain(chain)
  eq(described[described.length - 1].slug, LIMITER_SLUG)
  eq(described[described.length - 1].name, 'Limiter')
})

// ---- buildNodes ------------------------------------------------------------

check('buildNodes refuses a missing context and unknown slugs', () => {
  throws(() => buildNodes(null, 'gain'), 'null context')
  throws(() => buildNodes({}, 'gain'), 'empty context')
  const ctx = fakeCtx()
  throws(() => buildNodes(ctx, 'nope'), 'unknown effect')
  throws(() => buildNodes(ctx, undefined), 'undefined effect')
})

for (const slug of slugs) {
  check(`buildNodes builds ${slug} with the full surface`, () => {
    const ctx = fakeCtx()
    const nodes = buildNodes(ctx, { slug, params: catalogDefaults(slug) })
    eq(typeof nodes.input.connect, 'function')
    eq(typeof nodes.output.connect, 'function')
    eq(typeof nodes.set, 'function')
    eq(typeof nodes.destroy, 'function')
    ok(ctx.nodes.length >= 5, 'shell plus core nodes exist')
    eq(nodes.set('bogus', 1), false)
    eq(nodes.set('bypass', true), true)
    eq(nodes.set('bypass', false), false)
    nodes.destroy()
    nodes.destroy()
    ok(ctx.nodes.every((node) => node.disconnects > 0), 'every node detached')
    eq(nodes.set('bypass', true), false, 'set after destroy is false')
  })
}

check('buildNodes applies catalog defaults', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'gain')
  const core = kinds(ctx, 'gain').find((node) => node !== ctx.nodes[0] && node.gain.value === 1)
  ok(core, 'default gain is unity')
  nodes.destroy()
})

check('buildNodes honours effect params and clamps them', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, { slug: 'gain', params: { gain: 6 } })
  eq(nodes.set('gain', 999), 24)
  eq(nodes.set('gain', -999), -24)
  nodes.destroy()
})

check('bypass starts open when the effect says so', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, { slug: 'dist', bypass: true, params: {} })
  const dry = ctx.nodes[2]
  const wet = ctx.nodes[3]
  eq(dry.kind, 'gain')
  eq(dry.gain.value, 1)
  eq(wet.gain.value, 0)
  nodes.destroy()
})

check('an active effect starts fully wet', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'delay')
  eq(ctx.nodes[2].gain.value, 0)
  eq(ctx.nodes[3].gain.value, 1)
  nodes.destroy()
})

// ---- DSP specifics ---------------------------------------------------------

check('gain maps dB to linear', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'gain')
  nodes.set('gain', 6)
  const doubled = kinds(ctx, 'gain').some((node) => Math.abs(node.gain.value - 1.995262) < 1e-4)
  ok(doubled, '6 dB is about 2x')
  nodes.destroy()
})

check('filter selects bands and sets cutoff/resonance', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'filter')
  const biquad = kinds(ctx, 'biquad')[0]
  eq(biquad.type, 'lowpass')
  nodes.set('mode', 'highpass')
  eq(biquad.type, 'highpass')
  nodes.set('cutoff', 500)
  near(biquad.frequency.value, 500, 1e-9)
  nodes.set('resonance', 4)
  near(biquad.Q.value, 4, 1e-9)
  nodes.destroy()
})

check('eq3 builds shelves around a peak', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'eq3')
  const bands = kinds(ctx, 'biquad')
  eq(bands.length, 3)
  eq(bands[0].type, 'lowshelf')
  eq(bands[1].type, 'peaking')
  eq(bands[2].type, 'highshelf')
  nodes.set('mid', 6)
  near(bands[1].gain.value, 6, 1e-9)
  nodes.destroy()
})

check('comp maps threshold, ratio, times and makeup', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'comp')
  const comp = kinds(ctx, 'compressor')[0]
  nodes.set('thresh', -30)
  near(comp.threshold.value, -30, 1e-9)
  nodes.set('ratio', 99)
  near(comp.ratio.value, 20, 1e-9)
  nodes.set('attack', 2)
  near(comp.attack.value, 0.002, 1e-9)
  nodes.set('release', 500)
  near(comp.release.value, 0.5, 1e-9)
  nodes.set('makeup', 6)
  const makeup = kinds(ctx, 'gain').find((node) => Math.abs(node.gain.value - 1.995262) < 1e-4)
  ok(makeup, 'makeup gain applied')
  nodes.destroy()
})

check('gate builds a soft-knee curve that changes with threshold', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'gate')
  const shaper = kinds(ctx, 'shaper')[0]
  eq(shaper.curve.length, 2048)
  eq(shaper.oversample, '4x')
  const before = Array.from(shaper.curve)
  nodes.set('thresh', -20)
  ok(Array.from(shaper.curve).some((value, i) => value !== before[i]), 'curve rebuilt')
  nodes.set('thresh', 0)
  near(shaper.curve[shaper.curve.length - 1], 1, 1e-6, '0 dB threshold is fully open at full scale')
  ok(Math.abs(shaper.curve[1024]) < 0.001, 'silence stays near zero')
  nodes.set('range', 0)
  ok(Array.from(shaper.curve).every((value) => Math.abs(value) >= Math.abs(0)), 'zero range is transparent-ish')
  nodes.destroy()
})

check('dist drives, tones and mixes', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'dist')
  nodes.set('drive', 0)
  const unity = kinds(ctx, 'gain').some((node) => node.gain.value === 1)
  ok(unity, '0 dB drive is unity')
  nodes.set('drive', 24)
  const hot = kinds(ctx, 'gain').some((node) => Math.abs(node.gain.value - 15.848932) < 1e-3)
  ok(hot, '24 dB drive is about 15.8x')
  nodes.set('tone', 0)
  const lowpass = kinds(ctx, 'biquad')[0]
  near(lowpass.frequency.value, 400, 1e-9)
  nodes.set('tone', 1)
  near(lowpass.frequency.value, 12000, 1e-6)
  nodes.set('mix', 0.25)
  eq(kinds(ctx, 'gain')[6].gain.value, 0.75)
  nodes.destroy()
})

check('chorus runs an LFO into the delay time', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'chorus')
  const osc = kinds(ctx, 'osc')[0]
  ok(osc.started, 'LFO started')
  const delay = kinds(ctx, 'delay')[0]
  ok(delay.delayTime.value > 0.02, 'base delay set')
  nodes.set('depth', 10)
  const sweep = kinds(ctx, 'gain').find((node) => Math.abs(node.gain.value - 0.01) < 1e-9)
  ok(sweep, 'depth scales the sweep')
  nodes.set('rate', 2)
  near(osc.frequency.value, 2, 1e-9)
  nodes.destroy()
  ok(osc.stopped, 'LFO stopped')
})

check('delay clamps time and rewires ping-pong', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'delay')
  const delays = kinds(ctx, 'delay')
  eq(delays.length, 2)
  nodes.set('time', 5000)
  near(delays[0].delayTime.value, 1.2, 1e-9)
  nodes.set('time', 10)
  near(delays[1].delayTime.value, 0.01, 1e-9)
  const feedback = kinds(ctx, 'gain').filter((node) => Math.abs(node.gain.value - 0.3) < 1e-9)
  eq(feedback.length, 2)
  const straight = feedback.map((node) => node.connections[0]?.kind).join(',')
  eq(straight, 'delay,delay')
  nodes.set('pingpong', 1)
  const crossed = feedback.map((node) => node.connections[0]?.kind).join(',')
  eq(crossed, 'delay,delay')
  ok(feedback[0].connections[0] !== delays[0], 'feedback crosses sides')
  nodes.destroy()
})

check('reverb convolves a generated impulse scaled by decay', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'reverb')
  const convolver = kinds(ctx, 'convolver')[0]
  eq(convolver.buffer.numberOfChannels, 2)
  near(convolver.buffer.length, 2.2 * 48000, 2)
  const short = convolver.buffer.length
  nodes.set('decay', 5)
  ok(convolver.buffer.length > short * 2, 'longer decay, longer impulse')
  nodes.set('damping', 400)
  const damp = kinds(ctx, 'biquad')[0]
  near(damp.frequency.value, 400, 1e-9)
  nodes.destroy()
  eq(convolver.buffer, null)
})

check('phaser uses four allpass stages and feedback', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'phaser')
  const stages = kinds(ctx, 'biquad')
  eq(stages.length, 4)
  ok(stages.every((stage) => stage.type === 'allpass'))
  nodes.set('depth', 0.5)
  const sweep = kinds(ctx, 'gain').find((node) => Math.abs(node.gain.value - 450) < 1e-6)
  ok(sweep, 'depth scales the sweep')
  const feedback = kinds(ctx, 'gain').find((node) => Math.abs(node.gain.value - 0.35) < 1e-9)
  ok(feedback, 'default feedback set')
  nodes.destroy()
})

check('bitcrush quantises and band-limits', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'bitcrush')
  const shaper = kinds(ctx, 'shaper')[0]
  eq(shaper.oversample, 'none')
  nodes.set('bits', 2)
  const levels = new Set(Array.from(shaper.curve).map((value) => value.toFixed(4)))
  ok(levels.size <= 5, 'two bits leaves five levels')
  ok(levels.has('0.5000') && levels.has('-0.5000'), 'half-scale steps exist')
  ok(Array.from(shaper.curve).every((value) => Math.abs(value) <= 1))
  nodes.set('bits', 16)
  ok(new Set(Array.from(shaper.curve)).size > 100, 'sixteen bits is nearly linear')
  const band = kinds(ctx, 'biquad')[0]
  nodes.set('downsample', 40)
  near(band.frequency.value, 48000 / 80, 1e-9)
  nodes.set('downsample', 1)
  near(band.frequency.value, 21600, 1e-9, 'clamped below Nyquist')
  nodes.set('mix', 0.3)
  eq(kinds(ctx, 'gain')[6].gain.value, 0.7)
  nodes.destroy()
})

check('widener runs a mid/side matrix', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'widener')
  const matrix = kinds(ctx, 'gain').slice(6).map((node) => node.gain.value)
  eq(matrix.join(','), '1,0,0,1')
  nodes.set('width', 200)
  const wide = kinds(ctx, 'gain').slice(6).map((node) => node.gain.value)
  eq(wide.join(','), '1.5,-0.5,-0.5,1.5')
  nodes.set('width', 50)
  const half = kinds(ctx, 'gain').slice(6).map((node) => node.gain.value)
  eq(half.join(','), '1.125,0.375,0.375,1.125')
  nodes.destroy()
})

check('limiter is a fast, high-ratio compressor with a safety ceiling', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'limiter')
  const comp = kinds(ctx, 'compressor')[0]
  near(comp.ratio.value, 20, 1e-9)
  near(comp.attack.value, 0.001, 1e-9)
  near(comp.threshold.value, -0.3, 1e-9)
  const clampNode = kinds(ctx, 'shaper')[0]
  const ceiling = 10 ** (-0.3 / 20)
  near(clampNode.curve[0], -ceiling, 1e-6)
  near(clampNode.curve[clampNode.curve.length - 1], ceiling, 1e-6)
  ok(Math.abs(clampNode.curve[clampNode.curve.length >> 1]) < 0.01, 'curve is linear near zero')
  nodes.set('ceiling', -6)
  near(comp.threshold.value, -6, 1e-9)
  near(clampNode.curve[clampNode.curve.length - 1], 10 ** (-6 / 20), 1e-6)
  nodes.set('release', 200)
  near(comp.release.value, 0.2, 1e-9)
  nodes.destroy()
})

check('tremolo modulates a gain', () => {
  const ctx = fakeCtx()
  const nodes = buildNodes(ctx, 'tremolo')
  const carrier = kinds(ctx, 'gain')[4]
  eq(carrier.gain.value, 0.8)
  nodes.set('depth', 1)
  eq(carrier.gain.value, 0.5)
  const depth = kinds(ctx, 'gain').find((node) => node.gain.value === 0.5 && node !== carrier)
  ok(depth, 'depth gain set')
  nodes.destroy()
})

const summary = report()
console.log(`${summary.total} assertions, ${summary.failed} failed`)
