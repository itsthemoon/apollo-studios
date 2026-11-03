// js/fx.js — insert-effect catalog, chain model and Web Audio DSP.
// Pure ESM, dependency-free. The catalog and chain model are plain data and
// run under bare Node 22; `buildNodes` needs a live AudioContext and is called
// only from the browser.
//
// A chain is serial: effects run left to right into the master bus. Every chain
// owns exactly one limiter and it is always the last slot, so a boosted chain
// can never hand a hot signal to the exporter. `ensureLimiterLast` repairs a
// chain that was built by hand or loaded from storage.
//
// Params are numeric scalars so a slider can drive them directly. Booleans are
// 0/1 with step 1 and scale 'bool'; discrete choices are indexes with scale
// 'enum' and an `options` list. `setParam` clamps to min/max and snaps to the
// step, so a caller never has to police range itself.
//
// DSP is real Web Audio. Gauges:
//   gain      GainNode
//   filter    BiquadFilterNode (lowpass/highpass, Q = resonance)
//   eq3       three BiquadFilterNodes: low shelf, mid peak, high shelf
//   comp      DynamicsCompressorNode + makeup GainNode
//   gate      WaveShaperNode with a soft-knee static expander curve
//   dist      drive GainNode -> tanh WaveShaper -> tone lowpass, dry/wet
//   chorus    DelayNode swept by an OscillatorNode LFO, dry/wet
//   delay     two DelayNodes, cross-feedback in ping-pong, dry/wet
//   reverb    ConvolverNode on a procedurally generated stereo impulse
//   phaser    four allpass BiquadFilterNodes swept by one LFO, feedback, dry/wet
//   bitcrush  WaveShaperNode quantiser -> band-limit lowpass, dry/wet; the
//             lowpass stands in for sample-and-hold, which needs a worklet
//   widener   mid/side matrix of four GainNodes
//   limiter   DynamicsCompressorNode, ratio 20, 1 ms attack, soft clamp behind it
//   tremolo   GainNode driven by an LFO
//
// Reverb impulses are seeded (an LCG), so the same size/decay always yields the
// same tail. `buildNodes` wraps every effect in a dry/wet bypass pair; nothing
// here touches the DOM.

export const LIMITER_SLUG = 'limiter'

const MAX_EFFECTS_FREE = 8
const MAX_EFFECTS_MEMBER = 16
const BYPASS_RAMP = 0.02

const dbToLin = (db) => 10 ** (db / 20)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const round6 = (v) => Math.round(v * 1e6) / 1e6

// Param tuple: slug, label, min, max, step, default, unit, scale.
const p = (slug, name, min, max, step, def, unit = '', scale = 'linear', extra = {}) => ({
  slug,
  name,
  min,
  max,
  step,
  default: def,
  unit,
  scale,
  ...extra,
})

// --- catalog ---------------------------------------------------------------

// Browser categories, in the order the product lists them. An effect may sit
// in more than one list, so `cats` is an array and `category` is its first
// entry for anything that still reads a single value.
export const FX_CATEGORIES = Object.freeze([
  { id: 'recommended', label: 'Recommended' },
  { id: 'one-knobs', label: 'One Knobs' },
  { id: 'polish', label: 'Polish' },
  { id: 'amps-cabs', label: 'Amps & Cabs' },
  { id: 'pitch-shift', label: 'Pitch Shift' },
  { id: 'compressor', label: 'Compressor' },
  { id: 'limiter', label: 'Limiter' },
  { id: 'rhythmic', label: 'Rhythmic' },
  { id: 'eq', label: 'EQ' },
  { id: 'delay', label: 'Delay' },
  { id: 'modulation', label: 'Modulation' },
  { id: 'distortion', label: 'Distortion' },
  { id: 'saturation', label: 'Saturation' },
  { id: 'reverb', label: 'Reverb' },
  { id: 'utility', label: 'Utility' },
  { id: 'legacy', label: 'Legacy' },
])

const CATS = {
  gain: ['one-knobs', 'utility'],
  filter: ['eq', 'legacy'],
  eq3: ['polish', 'eq', 'recommended'],
  comp: ['polish', 'compressor', 'recommended'],
  gate: ['compressor'],
  dist: ['amps-cabs', 'distortion', 'saturation'],
  chorus: ['modulation', 'recommended'],
  delay: ['delay', 'rhythmic'],
  reverb: ['reverb', 'recommended'],
  phaser: ['modulation'],
  bitcrush: ['distortion', 'legacy'],
  widener: ['one-knobs', 'utility'],
  tremolo: ['modulation', 'rhythmic'],
  limiter: ['limiter', 'recommended'],
}

export const FX_LIST = Object.freeze([
  {
    slug: 'gain',
    cats: CATS.gain,
    name: 'Gain',
    category: 'gain',
    params: [p('gain', 'Gain', -24, 24, 0.5, 0, 'dB')],
    presets: [
      { slug: 'unity', name: 'Unity', values: { gain: 0 } },
      { slug: 'lift', name: 'Lift', values: { gain: 6 } },
      { slug: 'trim', name: 'Trim', values: { gain: -6 } },
    ],
  },
  {
    slug: 'filter',
    cats: CATS.filter,
    name: 'Filter',
    category: 'eq',
    params: [
      p('mode', 'Band', 0, 1, 1, 0, '', 'enum', { options: ['lowpass', 'highpass'] }),
      p('cutoff', 'Cutoff', 20, 20000, 1, 8000, 'Hz', 'log'),
      p('resonance', 'Resonance', 0.1, 20, 0.1, 1, 'Q'),
    ],
    presets: [
      { slug: 'dark', name: 'Dark low-pass', values: { mode: 0, cutoff: 1200, resonance: 0.7 } },
      { slug: 'air', name: 'Air high-pass', values: { mode: 1, cutoff: 220, resonance: 0.7 } },
      { slug: 'sweep', name: 'Resonant sweep', values: { mode: 0, cutoff: 700, resonance: 8 } },
    ],
  },
  {
    slug: 'eq3',
    cats: CATS.eq3,
    name: '3-Band EQ',
    category: 'eq',
    params: [
      p('low', 'Low', -12, 12, 0.5, 0, 'dB'),
      p('mid', 'Mid', -12, 12, 0.5, 0, 'dB'),
      p('high', 'High', -12, 12, 0.5, 0, 'dB'),
    ],
    presets: [
      { slug: 'flat', name: 'Flat', values: { low: 0, mid: 0, high: 0 } },
      { slug: 'smile', name: 'Smile', values: { low: 4, mid: -3, high: 4 } },
      { slug: 'presence', name: 'Presence', values: { low: -2, mid: 3, high: 1.5 } },
      { slug: 'radio', name: 'Radio', values: { low: -8, mid: 4, high: 2 } },
    ],
  },
  {
    slug: 'comp',
    cats: CATS.comp,
    name: 'Compressor',
    category: 'dynamic',
    params: [
      p('thresh', 'Threshold', -60, 0, 0.5, -18, 'dB'),
      p('ratio', 'Ratio', 1, 20, 0.1, 4, ':1'),
      p('attack', 'Attack', 0.1, 100, 0.1, 10, 'ms'),
      p('release', 'Release', 10, 1000, 1, 150, 'ms'),
      p('makeup', 'Makeup', 0, 24, 0.5, 0, 'dB'),
    ],
    presets: [
      { slug: 'gentle', name: 'Gentle', values: { thresh: -24, ratio: 2, attack: 20, release: 250, makeup: 2 } },
      { slug: 'vocal', name: 'Vocal level', values: { thresh: -20, ratio: 4, attack: 5, release: 120, makeup: 4 } },
      { slug: 'squash', name: 'Squash', values: { thresh: -34, ratio: 12, attack: 1, release: 80, makeup: 8 } },
    ],
  },
  {
    slug: 'gate',
    cats: CATS.gate,
    name: 'Gate',
    category: 'dynamic',
    params: [
      p('thresh', 'Threshold', -80, 0, 0.5, -45, 'dB'),
      p('range', 'Range', 0, 80, 0.5, 60, 'dB'),
    ],
    presets: [
      { slug: 'soft', name: 'Soft gate', values: { thresh: -50, range: 24 } },
      { slug: 'hard', name: 'Hard gate', values: { thresh: -38, range: 80 } },
    ],
  },
  {
    slug: 'dist',
    cats: CATS.dist,
    name: 'Distortion',
    category: 'distortion',
    params: [
      p('drive', 'Drive', 0, 24, 0.5, 10, 'dB'),
      p('tone', 'Tone', 0, 1, 0.01, 0.5, '', 'log'),
      p('mix', 'Mix', 0, 1, 0.01, 0.5),
    ],
    presets: [
      { slug: 'warm', name: 'Warm', values: { drive: 5, tone: 0.45, mix: 0.35 } },
      { slug: 'crunch', name: 'Crunch', values: { drive: 14, tone: 0.6, mix: 0.6 } },
      { slug: 'fuzz', name: 'Fuzz', values: { drive: 22, tone: 0.75, mix: 0.85 } },
    ],
  },
  {
    slug: 'chorus',
    cats: CATS.chorus,
    name: 'Chorus',
    category: 'modulation',
    params: [
      p('rate', 'Rate', 0.05, 8, 0.01, 0.6, 'Hz', 'log'),
      p('depth', 'Depth', 0, 20, 0.1, 4, 'ms'),
      p('mix', 'Mix', 0, 1, 0.01, 0.4),
    ],
    presets: [
      { slug: 'subtle', name: 'Subtle', values: { rate: 0.4, depth: 2, mix: 0.25 } },
      { slug: 'wide', name: 'Wide', values: { rate: 0.8, depth: 7, mix: 0.5 } },
      { slug: 'seasick', name: 'Seasick', values: { rate: 2.6, depth: 14, mix: 0.65 } },
    ],
  },
  {
    slug: 'delay',
    cats: CATS.delay,
    name: 'Delay',
    category: 'delay',
    params: [
      p('time', 'Time', 10, 1200, 1, 250, 'ms', 'log'),
      p('feedback', 'Feedback', 0, 0.95, 0.01, 0.3),
      p('mix', 'Mix', 0, 1, 0.01, 0.25),
      p('pingpong', 'Ping-pong', 0, 1, 1, 0, '', 'bool'),
    ],
    presets: [
      { slug: 'slap', name: 'Slap', values: { time: 90, feedback: 0.12, mix: 0.2, pingpong: 0 } },
      { slug: 'quarter', name: 'Quarter note', values: { time: 480, feedback: 0.38, mix: 0.28, pingpong: 0 } },
      { slug: 'pingpong', name: 'Ping-pong', values: { time: 320, feedback: 0.45, mix: 0.35, pingpong: 1 } },
    ],
  },
  {
    slug: 'reverb',
    cats: CATS.reverb,
    name: 'Reverb',
    category: 'reverb',
    params: [
      p('size', 'Size', 0, 1, 0.01, 0.5),
      p('decay', 'Decay', 0.1, 10, 0.1, 2.2, 's', 'log'),
      p('damping', 'Damping', 200, 20000, 1, 8000, 'Hz', 'log'),
      p('mix', 'Mix', 0, 1, 0.01, 0.25),
    ],
    presets: [
      { slug: 'room', name: 'Room', values: { size: 0.2, decay: 0.9, damping: 6000, mix: 0.18 } },
      { slug: 'hall', name: 'Hall', values: { size: 0.75, decay: 3.4, damping: 9000, mix: 0.32 } },
      { slug: 'cathedral', name: 'Cathedral', values: { size: 1, decay: 8, damping: 5000, mix: 0.45 } },
    ],
  },
  {
    slug: 'phaser',
    cats: CATS.phaser,
    name: 'Phaser',
    category: 'modulation',
    params: [
      p('rate', 'Rate', 0.05, 8, 0.01, 0.4, 'Hz', 'log'),
      p('depth', 'Depth', 0, 1, 0.01, 0.6),
      p('feedback', 'Feedback', 0, 0.9, 0.01, 0.35),
      p('mix', 'Mix', 0, 1, 0.01, 0.5),
    ],
    presets: [
      { slug: 'slow', name: 'Slow drift', values: { rate: 0.12, depth: 0.45, feedback: 0.2, mix: 0.4 } },
      { slug: 'jet', name: 'Jet', values: { rate: 0.9, depth: 0.85, feedback: 0.65, mix: 0.6 } },
    ],
  },
  {
    slug: 'bitcrush',
    cats: CATS.bitcrush,
    name: 'Bitcrush',
    category: 'distortion',
    params: [
      p('bits', 'Bits', 1, 16, 1, 8, 'bit'),
      p('downsample', 'Downsample', 1, 40, 1, 4, 'x'),
      p('mix', 'Mix', 0, 1, 0.01, 1),
    ],
    presets: [
      { slug: 'lofi', name: 'Lo-fi', values: { bits: 10, downsample: 2, mix: 0.7 } },
      { slug: 'telephone', name: 'Telephone', values: { bits: 6, downsample: 3, mix: 0.9 } },
      { slug: 'destroy', name: 'Destroy', values: { bits: 3, downsample: 12, mix: 1 } },
    ],
  },
  {
    slug: 'widener',
    cats: CATS.widener,
    name: 'Widener',
    category: 'utility',
    params: [p('width', 'Width', 0, 200, 1, 100, '%')],
    presets: [
      { slug: 'mono', name: 'Mono', values: { width: 0 } },
      { slug: 'wide', name: 'Wide', values: { width: 150 } },
    ],
  },
  {
    slug: 'tremolo',
    cats: CATS.tremolo,
    name: 'Tremolo',
    category: 'modulation',
    params: [
      p('rate', 'Rate', 0.1, 20, 0.1, 4, 'Hz', 'log'),
      p('depth', 'Depth', 0, 1, 0.01, 0.4),
    ],
    presets: [
      { slug: 'pulse', name: 'Pulse', values: { rate: 5.5, depth: 0.5 } },
      { slug: 'shimmer', name: 'Shimmer', values: { rate: 12, depth: 0.18 } },
    ],
  },
  {
    slug: LIMITER_SLUG,
    cats: CATS.limiter,
    name: 'Limiter',
    category: 'utility',
    params: [
      p('ceiling', 'Ceiling', -12, 0, 0.1, -0.3, 'dB'),
      p('release', 'Release', 10, 500, 1, 80, 'ms'),
    ],
    presets: [
      { slug: 'safe', name: 'Safe', values: { ceiling: -3, release: 120 } },
      { slug: 'loud', name: 'Loud', values: { ceiling: -0.3, release: 60 } },
    ],
  },
])

const CATALOG = new Map(FX_LIST.map((fx) => [fx.slug, fx]))

// --- param helpers ----------------------------------------------------------

function findParam(slug, paramSlug) {
  const fx = CATALOG.get(slug)
  if (!fx) return null
  return fx.params.find((param) => param.slug === paramSlug) ?? null
}

// Clamp to the declared range, snap to the step grid, and resolve bools and
// enum labels to their numeric index. Non-finite input falls back to the
// default so a half-typed number never poisons a node.
function coerce(spec, value) {
  if (spec.scale === 'bool') {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (!Number.isFinite(value)) return spec.default
    return value >= 0.5 ? 1 : 0
  }
  let numeric = value
  if (spec.scale === 'enum' && typeof value === 'string') {
    const index = (spec.options ?? []).indexOf(value)
    numeric = index === -1 ? spec.default : index
  }
  if (typeof numeric === 'boolean') numeric = numeric ? 1 : 0
  if (!Number.isFinite(numeric)) return spec.default
  const stepped = spec.min + Math.round((clamp(numeric, spec.min, spec.max) - spec.min) / spec.step) * spec.step
  return round6(clamp(stepped, spec.min, spec.max))
}

function defaultsFor(slug) {
  const fx = CATALOG.get(slug)
  const values = {}
  for (const param of fx.params) values[param.slug] = param.default
  return values
}

// --- chain model ------------------------------------------------------------

export function maxEffects(isMember = false) {
  return isMember ? MAX_EFFECTS_MEMBER : MAX_EFFECTS_FREE
}

function assertChain(chain) {
  if (!chain || !Array.isArray(chain.effects)) throw new Error('bad chain')
}

function findIndex(chain, id) {
  return chain.effects.findIndex((fx) => fx.id === id)
}

function makeEffect(chain, slug) {
  return {
    id: `fx${chain.nextId++}`,
    slug,
    bypass: false,
    params: defaultsFor(slug),
  }
}

// New chain. The limiter is present from the start and stays last. Pass
// { isMember: true } for the 16-slot tier.
export function createChain(opts = {}) {
  const chain = {
    effects: [],
    nextId: 1,
    isMember: opts.isMember === true,
    capacity: maxEffects(opts.isMember === true),
  }
  ensureLimiterLast(chain)
  return chain
}

// Appends an effect just before the limiter. Adding a second limiter hands back
// the existing one. Throws 'chain full' at the cap.
export function addEffect(chain, slug) {
  assertChain(chain)
  if (!CATALOG.has(slug)) throw new Error('unknown effect')
  if (slug === LIMITER_SLUG) {
    const existing = chain.effects.find((fx) => fx.slug === LIMITER_SLUG)
    if (existing) return existing
    const limiter = makeEffect(chain, slug)
    chain.effects.push(limiter)
    return limiter
  }
  if (!chain.effects.some((fx) => fx.slug === LIMITER_SLUG)) ensureLimiterLast(chain)
  if (chain.effects.length >= (chain.capacity ?? maxEffects(chain.isMember))) throw new Error('chain full')
  const effect = makeEffect(chain, slug)
  const limiterIndex = chain.effects.findIndex((fx) => fx.slug === LIMITER_SLUG)
  const insertAt = limiterIndex === -1 ? chain.effects.length : limiterIndex
  chain.effects.splice(insertAt, 0, effect)
  return effect
}

// Moves a slot to a new index. The limiter never moves; other effects are
// pinned to just before it. Out-of-range indices are false, no-ops are true.
export function moveEffect(chain, from, to) {
  assertChain(chain)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false
  if (from < 0 || from >= chain.effects.length) return false
  if (to < 0 || to >= chain.effects.length) return false
  if (chain.effects[from].slug === LIMITER_SLUG) return false
  if (from === to) return true
  const last = chain.effects.length - 2
  const target = clamp(to, 0, last)
  const [effect] = chain.effects.splice(from, 1)
  chain.effects.splice(target, 0, effect)
  return true
}

// Drops a slot. Removing the limiter re-adds a fresh one at the end so the
// invariant survives. Returns whether anything was removed.
export function removeEffect(chain, id) {
  assertChain(chain)
  const index = findIndex(chain, id)
  if (index === -1) return false
  const [removed] = chain.effects.splice(index, 1)
  if (removed.slug === LIMITER_SLUG) ensureLimiterLast(chain)
  return true
}

// Sets one param, clamped and stepped. Returns the applied value, or false when
// the id or param slug is unknown.
export function setParam(chain, id, slug, value) {
  assertChain(chain)
  const effect = chain.effects[findIndex(chain, id)]
  if (!effect) return false
  const spec = findParam(effect.slug, slug)
  if (!spec) return false
  const applied = coerce(spec, value)
  effect.params[slug] = applied
  return applied
}

export function setBypass(chain, id, on) {
  assertChain(chain)
  const effect = chain.effects[findIndex(chain, id)]
  if (!effect) return false
  effect.bypass = on === true
  return effect.bypass
}

// Plain snapshot for the UI: catalog labels resolved, values copied, ranges
// included so a slider can be built without a second catalog lookup.
export function describeChain(chain) {
  assertChain(chain)
  return chain.effects.map((effect) => {
    const fx = CATALOG.get(effect.slug)
    return {
      id: effect.id,
      slug: effect.slug,
      name: fx.name,
      category: fx.category,
      bypass: effect.bypass,
      params: fx.params.map((param) => ({
        slug: param.slug,
        name: param.name,
        value: effect.params[param.slug],
        default: param.default,
        min: param.min,
        max: param.max,
        step: param.step,
        unit: param.unit,
        scale: param.scale,
        ...(param.options ? { options: [...param.options] } : {}),
      })),
    }
  })
}

// Exactly one limiter, at the end. Repairs chains built by hand or loaded from
// storage. Returns the same chain for chaining.
export function ensureLimiterLast(chain) {
  assertChain(chain)
  const limiters = chain.effects.filter((fx) => fx.slug === LIMITER_SLUG)
  if (limiters.length > 1) {
    chain.effects = chain.effects.filter((fx) => fx.slug !== LIMITER_SLUG)
    chain.effects.push(limiters[limiters.length - 1])
    return chain
  }
  const index = chain.effects.findIndex((fx) => fx.slug === LIMITER_SLUG)
  if (index === -1) {
    chain.effects.push(makeEffect(chain, LIMITER_SLUG))
  } else if (index !== chain.effects.length - 1) {
    const [limiter] = chain.effects.splice(index, 1)
    chain.effects.push(limiter)
  }
  return chain
}

// --- DSP helpers ------------------------------------------------------------

// Sprint a param to a value instead of jumping. setTargetAtTime is smoother
// than a direct .value write and is present on every AudioParam.
function ramp(param, value, now) {
  if (typeof param.setTargetAtTime === 'function') {
    if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now)
    param.setTargetAtTime(value, now, BYPASS_RAMP / 4)
  } else {
    param.value = value
  }
}

function nowOf(ctx) {
  return Number.isFinite(ctx.currentTime) ? ctx.currentTime : 0
}

// True bypass pair: dry is open while the effect is off, wet while it is on.
function shell(ctx, effect) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  input.connect(dry)
  dry.connect(output)
  wet.connect(output)
  const bypassed = effect?.bypass === true
  dry.gain.value = bypassed ? 1 : 0
  wet.gain.value = bypassed ? 0 : 1
  return {
    input,
    output,
    dry,
    wet,
    setBypass(on) {
      const now = nowOf(ctx)
      ramp(dry.gain, on ? 1 : 0, now)
      ramp(wet.gain, on ? 0 : 1, now)
    },
  }
}

// Dry/wet split inside an effect that has its own mix param.
function mixStage(ctx, mix) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  input.connect(dry)
  dry.connect(output)
  wet.connect(output)
  const apply = (value) => {
    dry.gain.value = 1 - value
    wet.gain.value = value
  }
  apply(mix)
  return { input, output, dry, wet, apply }
}

function lfo(ctx, rate) {
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = rate
  osc.start()
  return osc
}

// Seeded stereo impulse: early taps near the front, exponential tail, longer
// and sparser as size rises. Deterministic per (size, decay, rate). Channels are
// filled as plain Float32Arrays and copied in, which also keeps the builder
// working from sandboxed realms that forbid indexed writes to AudioBuffer data.
function buildImpulse(ctx, size, decay, rate) {
  const seconds = clamp(decay, 0.05, 12)
  const length = Math.max(2, Math.floor(seconds * rate))
  const buffer = ctx.createBuffer(2, length, rate)
  let seed = 0x9e3779b9
  const noise = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return (seed / 2 ** 32) * 2 - 1
  }
  const spread = 0.003 + size * 0.07
  const tail = seconds * (0.15 + 0.35 * size)
  for (let channel = 0; channel < 2; channel++) {
    const data = new Float32Array(length)
    const skew = channel === 0 ? 0 : spread * 0.35
    for (let i = 0; i < length; i++) {
      const t = i / rate
      const env = Math.exp(-Math.max(0, t - skew) / tail)
      const early = t < spread + skew ? (1 - t / (spread + skew)) * 0.6 : 0
      data[i] = (noise() * 0.72 + early) * env
    }
    data[0] += 1
    buffer.copyToChannel(data, channel)
  }
  return buffer
}

function gateCurve(thresholdDb, rangeDb) {
  const curve = new Float32Array(2048)
  const threshold = dbToLin(thresholdDb)
  const floor = dbToLin(-rangeDb)
  const knee = Math.max(threshold * 0.5, 0.0005)
  const low = threshold - knee
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const level = Math.abs(x)
    let gain = 1
    if (level <= low) {
      gain = floor
    } else if (level < threshold) {
      const pos = (level - low) / knee
      gain = floor + (1 - floor) * pos * pos * (3 - 2 * pos)
    }
    curve[i] = x * gain
  }
  return curve
}

function distCurve() {
  const curve = new Float32Array(2048)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x)
  }
  return curve
}

// Quantiser transfer curve: `bits` bits over [-1, 1], so two bits gives the
// levels -1, -0.5, 0, 0.5, 1.
function bitCurve(bits) {
  const curve = new Float32Array(4096)
  const step = 2 / 2 ** bits
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = clamp(Math.round(x / step) * step, -1, 1)
  }
  return curve
}

// Safety ceiling: linear below 85 % of the ceiling, then a tanh shoulder that
// meets the ceiling exactly at full scale. The compressor does the levelling;
// this only catches the transients it cannot reach in 1 ms.
function limitCurve(ceilingDb) {
  const ceiling = dbToLin(ceilingDb)
  const knee = ceiling * 0.85
  const span = Math.max(ceiling - knee, 1e-9)
  // Normalise the shoulder so tanh reaches 1 at |x| = 1 instead of only
  // approaching it, otherwise full-scale peaks slip past the ceiling.
  const norm = Math.tanh((1 - knee) / span) || 1
  const curve = new Float32Array(4096)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    const level = Math.abs(x)
    const shape = level <= knee ? level : knee + span * (Math.tanh((level - knee) / span) / norm)
    curve[i] = clamp(Math.sign(x) * shape, -ceiling, ceiling)
  }
  return curve
}

const TONE_MIN_HZ = 400
const TONE_MAX_HZ = 12000

const toneToHz = (tone) => TONE_MIN_HZ * (TONE_MAX_HZ / TONE_MIN_HZ) ** clamp(tone, 0, 1)

// --- builders ---------------------------------------------------------------
// Each builder returns { input, output, set(param, value), stop() }. `set` only
// receives params the catalog already clamped.

function buildGain(ctx, values) {
  const node = ctx.createGain()
  node.gain.value = dbToLin(values.gain)
  return {
    input: node,
    output: node,
    set: (slug, value) => ramp(node.gain, dbToLin(value), nowOf(ctx)),
    stop() {},
  }
}

function buildFilter(ctx, values) {
  const node = ctx.createBiquadFilter()
  node.type = values.mode === 1 ? 'highpass' : 'lowpass'
  node.frequency.value = values.cutoff
  node.Q.value = values.resonance
  return {
    input: node,
    output: node,
    set(slug, value) {
      if (slug === 'mode') node.type = value === 1 ? 'highpass' : 'lowpass'
      else if (slug === 'cutoff') ramp(node.frequency, value, nowOf(ctx))
      else if (slug === 'resonance') ramp(node.Q, value, nowOf(ctx))
    },
    stop() {},
  }
}

function buildEQ3(ctx, values) {
  const low = ctx.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.value = 120
  low.gain.value = values.low
  const mid = ctx.createBiquadFilter()
  mid.type = 'peaking'
  mid.frequency.value = 1000
  mid.Q.value = 1
  mid.gain.value = values.mid
  const high = ctx.createBiquadFilter()
  high.type = 'highshelf'
  high.frequency.value = 6000
  high.gain.value = values.high
  low.connect(mid)
  mid.connect(high)
  return {
    input: low,
    output: high,
    set(slug, value) {
      const now = nowOf(ctx)
      if (slug === 'low') ramp(low.gain, value, now)
      else if (slug === 'mid') ramp(mid.gain, value, now)
      else if (slug === 'high') ramp(high.gain, value, now)
    },
    stop() {},
  }
}

function buildComp(ctx, values) {
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = values.thresh
  comp.ratio.value = values.ratio
  comp.attack.value = values.attack / 1000
  comp.release.value = values.release / 1000
  comp.knee.value = 6
  const makeup = ctx.createGain()
  makeup.gain.value = dbToLin(values.makeup)
  comp.connect(makeup)
  return {
    input: comp,
    output: makeup,
    set(slug, value) {
      const now = nowOf(ctx)
      if (slug === 'thresh') ramp(comp.threshold, value, now)
      else if (slug === 'ratio') ramp(comp.ratio, value, now)
      else if (slug === 'attack') ramp(comp.attack, value / 1000, now)
      else if (slug === 'release') ramp(comp.release, value / 1000, now)
      else if (slug === 'makeup') ramp(makeup.gain, dbToLin(value), now)
    },
    stop() {},
  }
}

function buildGate(ctx, values) {
  const shaper = ctx.createWaveShaper()
  shaper.curve = gateCurve(values.thresh, values.range)
  shaper.oversample = '4x'
  return {
    input: shaper,
    output: shaper,
    set(slug, value) {
      if (slug === 'thresh') shaper.curve = gateCurve(value, values.range)
      else if (slug === 'range') shaper.curve = gateCurve(values.thresh, value)
    },
    stop() {},
  }
}

function buildDist(ctx, values) {
  const mix = mixStage(ctx, values.mix)
  const drive = ctx.createGain()
  drive.gain.value = dbToLin(values.drive)
  const shaper = ctx.createWaveShaper()
  shaper.curve = distCurve()
  shaper.oversample = '4x'
  const tone = ctx.createBiquadFilter()
  tone.type = 'lowpass'
  tone.frequency.value = toneToHz(values.tone)
  tone.Q.value = 0.7
  mix.input.connect(drive)
  drive.connect(shaper)
  shaper.connect(tone)
  tone.connect(mix.wet)
  return {
    input: mix.input,
    output: mix.output,
    set(slug, value) {
      if (slug === 'drive') {
        ramp(drive.gain, dbToLin(value), nowOf(ctx))
      } else if (slug === 'tone') {
        ramp(tone.frequency, toneToHz(value), nowOf(ctx))
      } else if (slug === 'mix') {
        mix.apply(value)
      }
    },
    stop() {},
  }
}

function buildChorus(ctx, values) {
  const mix = mixStage(ctx, values.mix)
  const delay = ctx.createDelay(0.2)
  delay.delayTime.value = 0.025
  const sweep = ctx.createGain()
  sweep.gain.value = values.depth / 1000
  const osc = lfo(ctx, values.rate)
  osc.connect(sweep)
  sweep.connect(delay.delayTime)
  mix.input.connect(delay)
  delay.connect(mix.wet)
  return {
    input: mix.input,
    output: mix.output,
    set(slug, value) {
      if (slug === 'rate') ramp(osc.frequency, value, nowOf(ctx))
      else if (slug === 'depth') ramp(sweep.gain, value / 1000, nowOf(ctx))
      else if (slug === 'mix') mix.apply(value)
    },
    stop() {
      osc.stop()
    },
  }
}

function buildDelay(ctx, values) {
  const mix = mixStage(ctx, values.mix)
  const splitter = ctx.createChannelSplitter(2)
  const merger = ctx.createChannelMerger(2)
  const left = ctx.createDelay(2)
  const right = ctx.createDelay(2)
  const seconds = clamp(values.time / 1000, 0.01, 2)
  left.delayTime.value = seconds
  right.delayTime.value = seconds
  const feedbackLeft = ctx.createGain()
  const feedbackRight = ctx.createGain()
  feedbackLeft.gain.value = values.feedback
  feedbackRight.gain.value = values.feedback
  mix.input.connect(splitter)
  splitter.connect(left, 0)
  splitter.connect(right, 1)
  left.connect(feedbackLeft)
  right.connect(feedbackRight)
  left.connect(merger, 0, 0)
  right.connect(merger, 0, 1)
  merger.connect(mix.wet)

  let pingpong = values.pingpong === 1
  const rewire = () => {
    feedbackLeft.disconnect()
    feedbackRight.disconnect()
    if (pingpong) {
      feedbackLeft.connect(right)
      feedbackRight.connect(left)
    } else {
      feedbackLeft.connect(left)
      feedbackRight.connect(right)
    }
  }
  rewire()

  return {
    input: mix.input,
    output: mix.output,
    set(slug, value) {
      const now = nowOf(ctx)
      if (slug === 'time') {
        ramp(left.delayTime, clamp(value / 1000, 0.01, 2), now)
        ramp(right.delayTime, clamp(value / 1000, 0.01, 2), now)
      } else if (slug === 'feedback') {
        ramp(feedbackLeft.gain, value, now)
        ramp(feedbackRight.gain, value, now)
      } else if (slug === 'mix') {
        mix.apply(value)
      } else if (slug === 'pingpong') {
        pingpong = value === 1
        rewire()
      }
    },
    stop() {},
  }
}

function buildReverb(ctx, values) {
  const mix = mixStage(ctx, values.mix)
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = values.damping
  damp.Q.value = 0.7
  const convolver = ctx.createConvolver()
  let buffer = buildImpulse(ctx, values.size, values.decay, ctx.sampleRate ?? 44100)
  convolver.buffer = buffer
  mix.input.connect(damp)
  damp.connect(convolver)
  convolver.connect(mix.wet)
  const rebuild = () => {
    buffer = buildImpulse(ctx, values.size, values.decay, ctx.sampleRate ?? 44100)
    convolver.buffer = buffer
  }
  return {
    input: mix.input,
    output: mix.output,
    set(slug, value) {
      if (slug === 'size' || slug === 'decay') rebuild()
      else if (slug === 'damping') ramp(damp.frequency, value, nowOf(ctx))
      else if (slug === 'mix') mix.apply(value)
    },
    stop() {
      buffer = null
      convolver.buffer = null
    },
  }
}

function buildPhaser(ctx, values) {
  const mix = mixStage(ctx, values.mix)
  const stages = Array.from({ length: 4 }, (_, i) => {
    const stage = ctx.createBiquadFilter()
    stage.type = 'allpass'
    stage.frequency.value = 500 + i * 420
    stage.Q.value = 0.7
    return stage
  })
  const osc = lfo(ctx, values.rate)
  const sweep = ctx.createGain()
  sweep.gain.value = 900 * values.depth
  osc.connect(sweep)
  for (const stage of stages) sweep.connect(stage.frequency)
  mix.input.connect(stages[0])
  for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1])
  const feedback = ctx.createGain()
  feedback.gain.value = values.feedback
  stages[stages.length - 1].connect(feedback)
  feedback.connect(stages[0])
  stages[stages.length - 1].connect(mix.wet)
  return {
    input: mix.input,
    output: mix.output,
    set(slug, value) {
      const now = nowOf(ctx)
      if (slug === 'rate') ramp(osc.frequency, value, now)
      else if (slug === 'depth') ramp(sweep.gain, 900 * value, now)
      else if (slug === 'feedback') ramp(feedback.gain, value, now)
      else if (slug === 'mix') mix.apply(value)
    },
    stop() {
      osc.stop()
    },
  }
}

function buildBitcrush(ctx, values) {
  const mix = mixStage(ctx, values.mix)
  const shaper = ctx.createWaveShaper()
  shaper.oversample = 'none'
  shaper.curve = bitCurve(values.bits)
  const band = ctx.createBiquadFilter()
  band.type = 'lowpass'
  band.Q.value = 0.7
  const rate = ctx.sampleRate ?? 44100
  const bandFor = (downsample) => {
    const hz = rate / (2 * Math.max(1, downsample))
    return clamp(hz, 20, rate * 0.45)
  }
  band.frequency.value = bandFor(values.downsample)
  mix.input.connect(shaper)
  shaper.connect(band)
  band.connect(mix.wet)
  return {
    input: mix.input,
    output: mix.output,
    set(slug, value) {
      if (slug === 'bits') shaper.curve = bitCurve(value)
      else if (slug === 'downsample') ramp(band.frequency, bandFor(value), nowOf(ctx))
      else if (slug === 'mix') mix.apply(value)
    },
    stop() {},
  }
}

function buildWidener(ctx, values) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const splitter = ctx.createChannelSplitter(2)
  const merger = ctx.createChannelMerger(2)
  const toLeftFromLeft = ctx.createGain()
  const toLeftFromRight = ctx.createGain()
  const toRightFromLeft = ctx.createGain()
  const toRightFromRight = ctx.createGain()
  input.connect(splitter)
  splitter.connect(toLeftFromLeft, 0)
  splitter.connect(toRightFromLeft, 0)
  splitter.connect(toLeftFromRight, 1)
  splitter.connect(toRightFromRight, 1)
  toLeftFromLeft.connect(merger, 0, 0)
  toLeftFromRight.connect(merger, 0, 0)
  toRightFromLeft.connect(merger, 0, 1)
  toRightFromRight.connect(merger, 0, 1)
  merger.connect(output)
  const apply = (width) => {
    const w = width / 100
    const norm = w < 1 ? 2 - w : 1
    const same = ((1 + w) / 2) * norm
    const cross = ((1 - w) / 2) * norm
    toLeftFromLeft.gain.value = same
    toRightFromRight.gain.value = same
    toLeftFromRight.gain.value = cross
    toRightFromLeft.gain.value = cross
  }
  apply(values.width)
  return {
    input,
    output,
    set(slug, value) {
      if (slug === 'width') apply(value)
    },
    stop() {},
  }
}

function buildLimiter(ctx, values) {
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = values.ceiling
  comp.ratio.value = 20
  comp.attack.value = 0.001
  comp.release.value = values.release / 1000
  comp.knee.value = 0
  // The compressor alone overshoots for a millisecond on transients; the clamp
  // curve behind it is a soft safety ceiling so the output never crosses it.
  const clampNode = ctx.createWaveShaper()
  clampNode.oversample = '4x'
  clampNode.curve = limitCurve(values.ceiling)
  comp.connect(clampNode)
  return {
    input: comp,
    output: clampNode,
    set(slug, value) {
      const now = nowOf(ctx)
      if (slug === 'ceiling') {
        ramp(comp.threshold, value, now)
        clampNode.curve = limitCurve(value)
      } else if (slug === 'release') {
        ramp(comp.release, value / 1000, now)
      }
    },
    stop() {},
  }
}

function buildTremolo(ctx, values) {
  const node = ctx.createGain()
  const osc = lfo(ctx, values.rate)
  const depth = ctx.createGain()
  const apply = (value) => {
    node.gain.value = 1 - value / 2
    depth.gain.value = value / 2
  }
  apply(values.depth)
  osc.connect(depth)
  depth.connect(node.gain)
  return {
    input: node,
    output: node,
    set(slug, value) {
      if (slug === 'rate') ramp(osc.frequency, value, nowOf(ctx))
      else if (slug === 'depth') apply(value)
    },
    stop() {
      osc.stop()
    },
  }
}

const BUILDERS = {
  gain: buildGain,
  filter: buildFilter,
  eq3: buildEQ3,
  comp: buildComp,
  gate: buildGate,
  dist: buildDist,
  chorus: buildChorus,
  delay: buildDelay,
  reverb: buildReverb,
  phaser: buildPhaser,
  bitcrush: buildBitcrush,
  widener: buildWidener,
  limiter: buildLimiter,
  tremolo: buildTremolo,
}

// --- DSP entry point --------------------------------------------------------

// Builds the live node graph for one effect. `effect` is a chain effect object
// (or a bare slug for defaults). Returns { input, output, set, destroy }.
// Bypass is handled inside the returned shell, so a chain can stay wired while
// an effect is switched off. destroy() is idempotent.
export function buildNodes(ctx, effect) {
  if (!ctx || typeof ctx.createGain !== 'function') throw new Error('buildNodes needs an audio context')
  const slug = typeof effect === 'string' ? effect : effect?.slug
  const builder = BUILDERS[slug]
  if (!builder) throw new Error('unknown effect')

  const values = defaultsFor(slug)
  if (effect && typeof effect === 'object') {
    for (const param of CATALOG.get(slug).params) {
      if (Object.hasOwn(effect.params ?? {}, param.slug)) {
        values[param.slug] = coerce(param, effect.params[param.slug])
      }
    }
  }

  // Record every node the builder creates, so destroy() can detach the whole
  // graph rather than just the shell.
  const owned = []
  const view = new Proxy(ctx, {
    get(target, prop) {
      const value = target[prop]
      if (typeof value === 'function' && typeof prop === 'string' && prop.startsWith('create')) {
        return (...args) => {
          const node = value.apply(target, args)
          owned.push(node)
          return node
        }
      }
      return value
    },
  })

  const wrap = shell(view, effect)
  const core = builder(view, values)
  wrap.input.connect(core.input)
  core.output.connect(wrap.wet)

  let destroyed = false
  return {
    input: wrap.input,
    output: wrap.output,
    set(paramSlug, value) {
      if (destroyed) return false
      if (paramSlug === 'bypass') {
        const on = value === true || value === 1
        wrap.setBypass(on)
        return on
      }
      const spec = findParam(slug, paramSlug)
      if (!spec) return false
      const applied = coerce(spec, value)
      values[paramSlug] = applied
      core.set(paramSlug, applied)
      return applied
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      try { core.stop() } catch { /* oscillator already stopped */ }
      for (const node of owned) {
        try { node.disconnect() } catch { /* already detached */ }
      }
    },
  }
}
