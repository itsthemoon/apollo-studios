// js/automation.js — automation lanes: param curves over time.
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and
// in the browser.
//
// A lane is { param, initial, points: [{ id, t, value, curve }] }, sorted by
// `t`. `t` is beats (or seconds) and only has to be finite and >= 0.
// A segment's shape comes from its LEFT point's `curve`:
//   'linear' — straight ramp (default)
//   'exp'    — eased ramp, slow then fast (u^2)
//   'hold'   — flat until the next point
// Before the first point and after the last point every lane holds that
// point's value; an empty lane reads `initial`.
//
// Mutators edit the lane in place and return the point (add/move) or a
// boolean (remove). `addPoint` rejects negative times; `movePoint` clamps
// them to 0 so a drag can overshoot left. Lane-returning functions
// (simplify, normalise) never mutate their input.

export const PARAM_RANGES = Object.freeze({
  volume: Object.freeze({ min: -60, max: 6 }),
  pan: Object.freeze({ min: -1, max: 1 }),
  send: Object.freeze({ min: 0, max: 1 }),
})

export const PARAMS = Object.freeze(Object.keys(PARAM_RANGES))
export const CURVES = Object.freeze(['linear', 'exp', 'hold'])
export const DEFAULT_EPSILON = 0.01

const DEFAULTS = Object.freeze({ volume: 0, pan: 0, send: 0 })

export function isParam(param) {
  return typeof param === 'string' && Object.hasOwn(PARAM_RANGES, param)
}

export function clampValue(param, value) {
  const range = PARAM_RANGES[param]
  if (!range) throw new Error('unknown automation param')
  if (!Number.isFinite(value)) return DEFAULTS[param]
  return Math.min(range.max, Math.max(range.min, value))
}

export function clampTime(t) {
  if (!Number.isFinite(t)) return 0
  return Math.max(0, t)
}

// --- ids -----------------------------------------------------------------

let nextId = 1

export function makePointId() {
  return `p${nextId++}`
}

export function resetPointIds(to = 1) {
  nextId = Number.isFinite(to) ? Math.max(1, Math.trunc(to)) : 1
  return nextId
}

// --- guards --------------------------------------------------------------

function assertLane(lane) {
  if (lane === null || typeof lane !== 'object' || Array.isArray(lane) || !isParam(lane.param)) {
    throw new Error('lane must be an automation lane')
  }
  if (!Array.isArray(lane.points)) throw new Error('lane.points must be an array')
  return lane
}

function indexOfPoint(lane, id) {
  return lane.points.findIndex((point) => point.id === id)
}

function sortPoints(lane) {
  lane.points.sort((a, b) => a.t - b.t || pointSeq(a.id) - pointSeq(b.id))
  return lane
}

function pointSeq(id) {
  const n = Number(String(id).slice(1))
  return Number.isFinite(n) ? n : 0
}

// --- lane lifecycle ------------------------------------------------------

export function createLane(param, initial) {
  if (!isParam(param)) throw new Error('unknown automation param')
  return {
    param,
    initial: initial === undefined ? DEFAULTS[param] : clampValue(param, initial),
    points: [],
  }
}

export function addPoint(lane, t, value, curve = 'linear') {
  assertLane(lane)
  if (!Number.isFinite(t)) throw new Error('time must be a finite number')
  if (t < 0) throw new Error('time must not be negative')
  if (!CURVES.includes(curve)) throw new Error('unknown curve')
  const at = clampTime(t)
  const v = clampValue(lane.param, value)
  const existing = lane.points.find((point) => point.t === at)
  if (existing) {
    existing.value = v
    existing.curve = curve
    return existing
  }
  const point = { id: makePointId(), t: at, value: v, curve }
  lane.points.push(point)
  sortPoints(lane)
  return point
}

export function removePoint(lane, id) {
  assertLane(lane)
  const at = indexOfPoint(lane, id)
  if (at === -1) return false
  lane.points.splice(at, 1)
  return true
}

export function movePoint(lane, id, t, value) {
  assertLane(lane)
  const at = indexOfPoint(lane, id)
  if (at === -1) throw new Error('unknown automation point')
  if (!Number.isFinite(t)) throw new Error('time must be a finite number')
  const point = lane.points[at]
  point.t = clampTime(t)
  point.value = clampValue(lane.param, value)
  sortPoints(lane)
  return point
}

export function setCurve(lane, id, curve) {
  assertLane(lane)
  if (!CURVES.includes(curve)) throw new Error('unknown curve')
  const at = indexOfPoint(lane, id)
  if (at === -1) throw new Error('unknown automation point')
  lane.points[at].curve = curve
  return lane.points[at]
}

// --- reading -------------------------------------------------------------

// Linear/exp interpolation between neighbours, hold outside the range.
export function read(lane, t) {
  assertLane(lane)
  const points = lane.points
  if (points.length === 0) return lane.initial
  const at = Number.isFinite(t) ? t : 0
  if (at <= points[0].t) return points[0].value
  const last = points[points.length - 1]
  if (at >= last.t) return last.value
  let i = 0
  while (i < points.length - 1 && points[i + 1].t <= at) i += 1
  const a = points[i]
  const b = points[i + 1]
  if (a.curve === 'hold') return a.value
  const span = b.t - a.t
  if (span <= 0) return b.value
  const u = (at - a.t) / span
  const eased = a.curve === 'exp' ? u * u : u
  return clampValue(lane.param, a.value + (b.value - a.value) * eased)
}

export function range(lane) {
  assertLane(lane)
  if (lane.points.length === 0) return { min: null, max: null }
  let min = Infinity
  let max = -Infinity
  for (const point of lane.points) {
    if (point.value < min) min = point.value
    if (point.value > max) max = point.value
  }
  return { min, max }
}

// 0..1 copy for drawing. A flat lane maps to 0.5 everywhere.
export function normalise(lane) {
  assertLane(lane)
  const { min, max } = range(lane)
  const span = max === null || max === min ? 0 : max - min
  const out = { param: lane.param, initial: 0.5, points: [] }
  out.points = lane.points.map((point) => ({
    id: point.id,
    t: point.t,
    value: span ? (point.value - min) / span : 0.5,
    curve: point.curve,
  }))
  return out
}

// --- simplify ------------------------------------------------------------

// Ramer–Douglas–Peucker over (t, value), keeping the endpoints and every
// point that deviates by more than `epsilon`. Returns a new lane.
export function simplify(lane, epsilon = DEFAULT_EPSILON) {
  assertLane(lane)
  const tol = Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : DEFAULT_EPSILON
  const points = lane.points
  if (points.length <= 2) return cloneLane(lane)
  const keep = new Array(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let worst = -1
    let worstAt = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(points[i], points[first], points[last])
      if (d > worst) {
        worst = d
        worstAt = i
      }
    }
    if (worstAt !== -1 && worst > tol) {
      keep[worstAt] = true
      stack.push([first, worstAt], [worstAt, last])
    }
  }
  const out = { param: lane.param, initial: lane.initial, points: [] }
  points.forEach((point, i) => {
    if (keep[i]) out.points.push({ ...point })
  })
  return out
}

// Distance from `p` to the segment a..b, degenerating to distance-to-point
// when the segment has no time span.
function perpendicular(p, a, b) {
  const dt = b.t - a.t
  const dv = b.value - a.value
  if (dt === 0) return Math.abs(p.value - a.value)
  const u = (p.t - a.t) / dt
  const clamped = Math.min(1, Math.max(0, u))
  return Math.abs(p.value - (a.value + dv * clamped))
}

export function cloneLane(lane) {
  assertLane(lane)
  return {
    param: lane.param,
    initial: lane.initial,
    points: lane.points.map((point) => ({ ...point })),
  }
}
