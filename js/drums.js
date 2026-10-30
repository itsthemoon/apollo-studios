// js/drums.js — step-sequenced drum machine for apollo-studios (drums node).
// Pure ESM, dependency-free. No browser globals at import time: the pattern functions are
// pure data over plain objects and run under plain Node 22, while `trigger`/`renderPattern`
// only touch a Web Audio context handed in by the caller.
//
// Nothing here uses samples. Every hit is synthesized from oscillators and a cached noise
// buffer: a pitch-swept sine kick, a band-passed snare over a tuned body, a short rim click,
// a three-burst clap, band-passed closed/open hats, pitch-dropping toms and a metallic ride.
//
// Patterns are immutable-ish: every mutator returns a NEW pattern and leaves its input
// untouched, so a UI can hold a history stack cheaply. Holds are velocities in 0..1 where
// 0 means "rest" — there is no separate on/off flag to keep in sync.

const MAX_STEPS = 256
const MAX_SWING = 0.66          // 0.66 of a step is the hard ceiling (triplet-ish max)
const MAX_LANE_GAIN = 2
const ATTACK_S = 0.002
const FLOOR = 0.0001

// ---- kit ----------------------------------------------------------------------
// Slugs are stable ids for UI wiring; names are for display. `params` carries the
// synthesis numbers only — no pattern state lives in the kit.

export const KIT = Object.freeze([
  Object.freeze({ slug: 'kick', name: 'Kick', defaultVelocity: 0.9, params: Object.freeze({ startHz: 150, endHz: 45, sweep: 0.045, decay: 0.42, click: 0.22, trim: 0.9 }) }),
  Object.freeze({ slug: 'snare', name: 'Snare', defaultVelocity: 0.72, params: Object.freeze({ hp: 1150, body: 190, toneMix: 0.34, noiseDecay: 0.11, bodyDecay: 0.055, trim: 0.74 }) }),
  Object.freeze({ slug: 'rim', name: 'Rim', defaultVelocity: 0.4, params: Object.freeze({ hp: 2600, hz: 1720, toneMix: 0.5, decay: 0.02, trim: 0.65 }) }),
  Object.freeze({ slug: 'clap', name: 'Clap', defaultVelocity: 0.55, params: Object.freeze({ bp: 1500, q: 1.4, bursts: 3, spread: 0.012, decay: 0.09, burstDecay: 0.009, trim: 2.4 }) }),
  Object.freeze({ slug: 'hatClosed', name: 'Closed Hat', defaultVelocity: 0.34, params: Object.freeze({ bp: 9000, q: 1.1, decay: 0.035, trim: 1 }) }),
  Object.freeze({ slug: 'hatOpen', name: 'Open Hat', defaultVelocity: 0.4, params: Object.freeze({ bp: 7800, q: 1.1, decay: 0.32, trim: 1.05 }) }),
  Object.freeze({ slug: 'tomLow', name: 'Low Tom', defaultVelocity: 0.6, params: Object.freeze({ startHz: 165, endHz: 88, sweep: 0.1, decay: 0.34, trim: 0.95 }) }),
  Object.freeze({ slug: 'tomHigh', name: 'High Tom', defaultVelocity: 0.54, params: Object.freeze({ startHz: 255, endHz: 148, sweep: 0.08, decay: 0.26, trim: 0.92 }) }),
  Object.freeze({ slug: 'ride', name: 'Ride', defaultVelocity: 0.3, params: Object.freeze({ baseHz: 520, partials: Object.freeze([1, 1.51, 2.03, 2.61, 3.4]), bp: 5200, q: 0.9, decay: 0.9, trim: 1.6 }) }),
])

const LANE_OF = new Map(KIT.map((drum, i) => [drum.slug, i]))

// ---- guards -------------------------------------------------------------------

function guardStepIndex(step, steps) {
  if (!Number.isInteger(step) || step < 0) throw new Error('bad step')
  if (step >= steps) throw new Error('bad step')
  return step
}

function guardLane(lane, lanes) {
  if (!Number.isInteger(lane) || lane < 0) throw new Error('bad lane')
  if (lane >= lanes) throw new Error('bad lane')
  return lane
}

function clamp(value, lo, hi) {
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('bad value')
  return Math.min(hi, Math.max(lo, value))
}

function guardPattern(pattern) {
  if (!pattern || !Array.isArray(pattern.hits) || !Array.isArray(pattern.gains)) throw new Error('bad pattern')
  if (!Number.isInteger(pattern.steps) || pattern.steps < 1) throw new Error('bad pattern')
  if (pattern.hits.length < pattern.lanes) throw new Error('bad pattern')
  return pattern
}

// ---- pattern state ------------------------------------------------------------

// Fresh pattern: `steps` columns, `lanes` rows, every hole empty. Swing starts at 0 and
// every lane gain at unity.
export function createPattern(steps = 16, lanes = KIT.length) {
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) throw new Error('bad steps')
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > KIT.length) throw new Error('bad lanes')
  const hits = []
  for (let lane = 0; lane < lanes; lane++) hits.push(new Array(steps).fill(0))
  return {
    steps,
    lanes,
    swing: 0,
    gains: new Array(lanes).fill(1),
    hits,
  }
}

function clone(pattern) {
  return {
    steps: pattern.steps,
    lanes: pattern.lanes,
    swing: pattern.swing,
    gains: pattern.gains.slice(),
    hits: pattern.hits.map((row) => row.slice()),
  }
}

// Empty hole -> defaultVelocity for the lane; a hit -> 0. Returns a new pattern.
export function toggleStep(pattern, lane, step) {
  guardPattern(pattern)
  guardLane(lane, pattern.lanes)
  guardStepIndex(step, pattern.steps)
  const next = clone(pattern)
  const row = next.hits[lane]
  row[step] = row[step] > 0 ? 0 : KIT[lane].defaultVelocity
  return next
}

// Explicit velocity in 0..1. 0 is a legal value and clears the step.
export function setVelocity(pattern, lane, step, velocity) {
  guardPattern(pattern)
  guardLane(lane, pattern.lanes)
  guardStepIndex(step, pattern.steps)
  const next = clone(pattern)
  next.hits[lane][step] = clamp(velocity, 0, 1)
  return next
}

export function clearLane(pattern, lane) {
  guardPattern(pattern)
  guardLane(lane, pattern.lanes)
  const next = clone(pattern)
  next.hits[lane].fill(0)
  return next
}

export function clearPattern(pattern) {
  guardPattern(pattern)
  const next = clone(pattern)
  for (const row of next.hits) row.fill(0)
  return next
}

export function setSwing(pattern, swing) {
  guardPattern(pattern)
  const next = clone(pattern)
  next.swing = clamp(swing, 0, MAX_SWING)
  return next
}

export function setLaneGain(pattern, lane, gain) {
  guardPattern(pattern)
  guardLane(lane, pattern.lanes)
  const next = clone(pattern)
  next.gains[lane] = clamp(gain, 0, MAX_LANE_GAIN)
  return next
}

// Seconds a step slides late. Only offbeat 16ths (odd steps) move, so the downbeat and
// every even 16th stay on the grid; at MAX_SWING that is two thirds of a step.
export function resolveSwing(step, swing, stepDur = 1) {
  if (!Number.isInteger(step) || step < 0) throw new Error('bad step')
  if (!Number.isFinite(swing)) throw new Error('bad swing')
  if (!Number.isFinite(stepDur) || stepDur <= 0) throw new Error('bad stepDur')
  const amount = Math.min(MAX_SWING, Math.max(0, swing))
  return step % 2 === 1 ? amount * stepDur : 0
}

export function laneIndex(slug) {
  const lane = LANE_OF.get(slug)
  if (lane === undefined) throw new Error('unknown drum')
  return lane
}

// ---- synthesis ----------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const noiseRnd = mulberry32(0x51ee7)
const noiseCache = new WeakMap()

function noiseSource(ctx) {
  const rate = Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0 ? ctx.sampleRate : 44100
  let buf = noiseCache.get(ctx)
  if (!buf) {
    const len = Math.max(1, Math.floor(rate * 2))
    buf = ctx.createBuffer(1, len, rate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = noiseRnd() * 2 - 1
    noiseCache.set(ctx, buf)
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  return src
}

// Percussive gain envelope: instant attack ramp, exponential fall to the floor.
function enveloped(ctx, peak, when, decay, attack = ATTACK_S) {
  const gain = ctx.createGain()
  const p = gain.gain
  p.setValueAtTime(0, when)
  p.linearRampToValueAtTime(Math.max(peak, 0.0002), when + attack)
  p.exponentialRampToValueAtTime(FLOOR, when + attack + decay)
  return gain
}

function filter(ctx, kind, freq, q) {
  const f = ctx.createBiquadFilter()
  f.type = kind
  f.frequency.setValueAtTime(freq, 0)
  f.Q.setValueAtTime(q, 0)
  return f
}

// Noise burst through a filter, gain-enveloped. Returns the source so it can be stopped.
function noiseHit(ctx, out, when, params) {
  const src = noiseSource(ctx)
  const bq = filter(ctx, params.kind, params.freq, params.q ?? 0.9)
  const gain = enveloped(ctx, params.peak, when, params.decay, params.attack)
  src.connect(bq)
  bq.connect(gain)
  gain.connect(out)
  src.start(when, noiseRnd() * 1.5)
  src.stop(when + (params.attack ?? ATTACK_S) + params.decay + 0.02)
  return src
}

function pitchedHit(ctx, out, when, params) {
  const osc = ctx.createOscillator()
  osc.type = params.type ?? 'sine'
  osc.frequency.setValueAtTime(Math.max(1, params.startHz), when)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, params.endHz), when + params.sweep)
  const gain = enveloped(ctx, params.peak, when, params.decay)
  osc.connect(gain)
  gain.connect(out)
  osc.start(when)
  osc.stop(when + ATTACK_S + params.decay + 0.02)
  return osc
}

// Main drum dispatch. `velocity` is the final amplitude (lane gain already folded in).
export function trigger(ctx, out, slug, when, velocity) {
  const lane = laneIndex(slug)
  const params = KIT[lane].params
  if (!Number.isFinite(when)) throw new Error('bad when')
  const v = clamp(velocity ?? 1, 0, 1)
  if (v === 0) return null
  const at = Math.max(0, when)
  // per-voice trim keeps a lone hit near unity even when layers sum
  const a = v * (params.trim ?? 1)

  switch (slug) {
    case 'kick': {
      const osc = pitchedHit(ctx, out, at, { ...params, peak: a })
      // beater click: a whisper of high noise on the transient
      noiseHit(ctx, out, at, { kind: 'highpass', freq: 1800, q: 0.7, peak: a * params.click, decay: 0.012, attack: 0.001 })
      return osc
    }
    case 'snare': {
      noiseHit(ctx, out, at, { kind: 'highpass', freq: params.hp, q: 0.7, peak: a, decay: params.noiseDecay })
      const body = ctx.createOscillator()
      body.type = 'triangle'
      body.frequency.setValueAtTime(params.body, at)
      const gain = enveloped(ctx, a * params.toneMix, at, params.bodyDecay)
      body.connect(gain)
      gain.connect(out)
      body.start(at)
      body.stop(at + params.bodyDecay + 0.04)
      return body
    }
    case 'rim': {
      noiseHit(ctx, out, at, { kind: 'highpass', freq: params.hp, q: 0.8, peak: a, decay: params.decay })
      const click = ctx.createOscillator()
      click.type = 'square'
      click.frequency.setValueAtTime(params.hz, at)
      const gain = enveloped(ctx, a * params.toneMix, at, params.decay)
      click.connect(gain)
      gain.connect(out)
      click.start(at)
      click.stop(at + params.decay + 0.02)
      return click
    }
    case 'clap': {
      // three tight bursts, then a short body tail: the classic flam
      for (let i = 0; i < params.bursts; i++) {
        noiseHit(ctx, out, at + i * params.spread, {
          kind: 'bandpass', freq: params.bp, q: params.q, peak: a, decay: params.burstDecay, attack: 0.001,
        })
      }
      return noiseHit(ctx, out, at + (params.bursts - 1) * params.spread, {
        kind: 'bandpass', freq: params.bp, q: params.q, peak: a * 0.6, decay: params.decay,
      })
    }
    case 'hatClosed':
    case 'hatOpen': {
      return noiseHit(ctx, out, at, { kind: 'bandpass', freq: params.bp, q: params.q, peak: a, decay: params.decay })
    }
    case 'tomLow':
    case 'tomHigh': {
      return pitchedHit(ctx, out, at, { ...params, peak: a })
    }
    case 'ride': {
      const bus = ctx.createGain()
      bus.gain.setValueAtTime(1, at)
      const bq = filter(ctx, 'bandpass', params.bp, params.q)
      const tail = enveloped(ctx, a, at, params.decay, ATTACK_S)
      bus.connect(bq)
      bq.connect(tail)
      tail.connect(out)
      let last = null
      params.partials.forEach((ratio, i) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(params.baseHz * ratio, at)
        const g = ctx.createGain()
        g.gain.setValueAtTime(1 / (i + 1.5), at)
        osc.connect(g)
        g.connect(bus)
        osc.start(at)
        osc.stop(at + params.decay + 0.05)
        last = osc
      })
      return last
    }
    default:
      throw new Error('unknown drum')
  }
}

// ---- render -------------------------------------------------------------------

// Schedules a whole pattern. One `bar` is `pattern.steps` sixteenths (16 steps = 4 beats).
// Returns { duration, events }: duration is the pattern length in seconds, events the hits.
export function renderPattern(ctx, pattern, opts = {}) {
  guardPattern(pattern)
  const bpm = opts.bpm
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error('bad bpm')
  const bars = opts.bars ?? 1
  if (!Number.isInteger(bars) || bars < 1) throw new Error('bad bars')
  const startAt = opts.startAt ?? 0
  if (!Number.isFinite(startAt) || startAt < 0) throw new Error('bad startAt')
  if (!Number.isFinite(ctx.sampleRate) || ctx.sampleRate <= 0) throw new Error('bad sample rate')

  const stepDur = 60 / bpm / 4
  let events = 0

  for (let bar = 0; bar < bars; bar++) {
    const barStart = startAt + bar * pattern.steps * stepDur
    for (let lane = 0; lane < pattern.lanes; lane++) {
      const gain = pattern.gains[lane]
      if (!(gain > 0)) continue
      const row = pattern.hits[lane]
      for (let step = 0; step < pattern.steps; step++) {
        const velocity = row[step]
        if (!(velocity > 0)) continue
        const when = barStart + step * stepDur + resolveSwing(step, pattern.swing, stepDur)
        trigger(ctx, opts.out ?? ctx.destination, KIT[lane].slug, when, velocity * gain)
        events++
      }
    }
  }

  return { duration: bars * pattern.steps * stepDur, events }
}