// scripts/selftest-automation.mjs — self-test for js/automation.js.
// Run from the project root:  node scripts/selftest-automation.mjs
import {
  PARAM_RANGES,
  PARAMS,
  CURVES,
  DEFAULT_EPSILON,
  isParam,
  clampValue,
  clampTime,
  makePointId,
  resetPointIds,
  createLane,
  addPoint,
  removePoint,
  movePoint,
  setCurve,
  read,
  range,
  normalise,
  simplify,
  cloneLane,
} from '../js/automation.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const laneOf = (param = 'volume', initial = 0) => {
  resetPointIds(1)
  return createLane(param, initial)
}

const ramp = () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 10, 100 > 6 ? 6 : 100)
  return lane
}

test('PARAM_RANGES covers volume, pan and send with the contract bounds', () => {
  eq(PARAMS.join(','), 'volume,pan,send')
  eq(PARAM_RANGES.volume.min, -60)
  eq(PARAM_RANGES.volume.max, 6)
  eq(PARAM_RANGES.pan.min, -1)
  eq(PARAM_RANGES.pan.max, 1)
  eq(PARAM_RANGES.send.min, 0)
  eq(PARAM_RANGES.send.max, 1)
  ok(Object.isFrozen(PARAM_RANGES))
})

test('CURVES lists the three segment shapes', () => {
  eq(CURVES.join(','), 'linear,exp,hold')
  ok(Object.isFrozen(CURVES))
  ok(DEFAULT_EPSILON > 0)
})

test('isParam accepts only real params', () => {
  for (const p of PARAMS) ok(isParam(p), p)
  eq(isParam('cutoff'), false)
  eq(isParam(''), false)
  eq(isParam(undefined), false)
  eq(isParam(null), false)
})

test('clampValue pins each param to its own range', () => {
  eq(clampValue('volume', -200), -60)
  eq(clampValue('volume', 200), 6)
  eq(clampValue('volume', -3.5), -3.5)
  eq(clampValue('pan', -7), -1)
  eq(clampValue('pan', 7), 1)
  eq(clampValue('pan', 0.25), 0.25)
  eq(clampValue('send', -7), 0)
  eq(clampValue('send', 7), 1)
  eq(clampValue('send', 0.75), 0.75)
})

test('clampValue neutralises nonsense and rejects unknown params', () => {
  eq(clampValue('volume', NaN), 0)
  eq(clampValue('pan', Infinity), 0)
  eq(clampValue('send', undefined), 0)
  throws(() => clampValue('cutoff', 1), 'unknown param')
})

test('clampTime floors at zero and neutralises nonsense', () => {
  eq(clampTime(0), 0)
  eq(clampTime(4.5), 4.5)
  eq(clampTime(-3), 0)
  eq(clampTime(NaN), 0)
  eq(clampTime(Infinity), 0)
})

test('makePointId hands out unique prefixed ids', () => {
  resetPointIds(1)
  eq(makePointId(), 'p1')
  eq(makePointId(), 'p2')
  resetPointIds()
  eq(makePointId(), 'p1')
})

test('createLane starts empty with the param default', () => {
  const lane = createLane('volume')
  eq(lane.param, 'volume')
  eq(lane.initial, 0)
  eq(lane.points.length, 0)
  eq(createLane('pan').initial, 0)
  eq(createLane('send').initial, 0)
})

test('createLane clamps the supplied initial', () => {
  eq(createLane('volume', 40).initial, 6)
  eq(createLane('volume', -400).initial, -60)
  eq(createLane('pan', 9).initial, 1)
  eq(createLane('send', -9).initial, 0)
  eq(createLane('volume', NaN).initial, 0)
})

test('createLane rejects unknown params', () => {
  throws(() => createLane('cutoff'), 'unknown param')
  throws(() => createLane(undefined), 'missing param')
  throws(() => createLane('constructor'), 'prototype key')
})

test('addPoint inserts in time order regardless of call order', () => {
  const lane = laneOf()
  const late = addPoint(lane, 8, -6)
  const early = addPoint(lane, 2, -3)
  const mid = addPoint(lane, 5, -1)
  eq(lane.points.map((p) => p.t).join(','), '2,5,8')
  eq(lane.points.map((p) => p.id).join(','), `${early.id},${mid.id},${late.id}`)
  eq(lane.points[1].value, -1)
})

test('addPoint returns the new point with a linear curve', () => {
  const lane = laneOf()
  const point = addPoint(lane, 1, -2)
  eq(point.t, 1)
  eq(point.value, -2)
  eq(point.curve, 'linear')
  ok(typeof point.id === 'string' && point.id.length > 0)
  ok(lane.points[0] === point)
})

test('addPoint clamps the value per param', () => {
  const lane = laneOf('send')
  addPoint(lane, 0, 5)
  addPoint(lane, 1, -5)
  eq(lane.points[0].value, 1)
  eq(lane.points[1].value, 0)
})

test('addPoint at an existing time overwrites value and curve', () => {
  const lane = laneOf()
  const first = addPoint(lane, 3, 1)
  const second = addPoint(lane, 3, 4, 'hold')
  eq(lane.points.length, 1)
  eq(second.id, first.id)
  eq(lane.points[0].value, 4)
  eq(lane.points[0].curve, 'hold')
})

test('addPoint rejects bad times and curves', () => {
  const lane = laneOf()
  throws(() => addPoint(lane, NaN, 0), 'NaN time')
  throws(() => addPoint(lane, Infinity, 0), 'infinite time')
  throws(() => addPoint(lane, -1, 0), 'negative time')
  throws(() => addPoint(lane, 1, 0, 'bezier'), 'unknown curve')
  throws(() => addPoint(null, 1, 0), 'bad lane')
  eq(lane.points.length, 0)
})

test('removePoint deletes by id and reports success', () => {
  const lane = laneOf()
  const a = addPoint(lane, 0, 0)
  const b = addPoint(lane, 1, 0)
  eq(removePoint(lane, a.id), true)
  eq(lane.points.length, 1)
  eq(lane.points[0].id, b.id)
  eq(removePoint(lane, a.id), false)
  eq(removePoint(lane, 'nope'), false)
})

test('movePoint retimes, rescales and resorts', () => {
  const lane = laneOf()
  const a = addPoint(lane, 0, 0)
  const b = addPoint(lane, 5, 0)
  const c = addPoint(lane, 9, 0)
  movePoint(lane, a.id, 7, -4)
  eq(lane.points.map((p) => p.t).join(','), '5,7,9')
  eq(lane.points[1].id, a.id)
  eq(lane.points[1].value, -4)
  movePoint(lane, b.id, 0, 6)
  eq(lane.points[0].id, b.id)
  eq(c.id, lane.points[2].id)
})

test('movePoint clamps value and time and rejects unknown ids', () => {
  const lane = laneOf('pan')
  const p = addPoint(lane, 1, 0)
  movePoint(lane, p.id, -3, 9)
  eq(lane.points[0].t, 0)
  eq(lane.points[0].value, 1)
  throws(() => movePoint(lane, 'nope', 1, 0), 'unknown point')
  eq(movePoint(lane, p.id, 2, 0), lane.points[0])
  eq(lane.points[0].t, 2)
})

test('setCurve changes one segment shape', () => {
  const lane = laneOf()
  const p = addPoint(lane, 0, 0)
  eq(setCurve(lane, p.id, 'hold').curve, 'hold')
  eq(lane.points[0].curve, 'hold')
  setCurve(lane, p.id, 'exp')
  eq(lane.points[0].curve, 'exp')
  throws(() => setCurve(lane, p.id, 'smooth'), 'unknown curve')
  throws(() => setCurve(lane, 'nope', 'hold'), 'unknown point')
})

test('read returns the initial value on an empty lane', () => {
  eq(read(laneOf('volume', -12), 0), -12)
  eq(read(laneOf('pan', 0.5), 99), 0.5)
  eq(read(laneOf('send', 0.2), 3), 0.2)
})

test('read holds the first and last values outside the points', () => {
  const lane = laneOf('volume')
  addPoint(lane, 2, -6)
  addPoint(lane, 6, 0)
  eq(read(lane, 0), -6)
  eq(read(lane, 2), -6)
  eq(read(lane, 6), 0)
  eq(read(lane, 100), 0)
})

test('read interpolates linearly in the middle of a segment', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -12)
  addPoint(lane, 8, 4)
  near(read(lane, 4), -4, 1e-9, 'halfway')
  near(read(lane, 2), -8, 1e-9, 'quarter')
  near(read(lane, 6), 0, 1e-9, 'three quarters')
})

test('read applies the exp curve as a slow-then-fast ramp', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0, 'exp')
  addPoint(lane, 10, 6)
  near(read(lane, 5), 1.5, 1e-9, 'u^2 quarter value')
  near(read(lane, 2.5), 0.375, 1e-9, 'u=0.25 -> 0.0625')
  near(read(lane, 10), 6, 1e-9, 'endpoint exact')
})

test('read applies the exp curve downward too', () => {
  const lane = laneOf('send')
  addPoint(lane, 0, 1, 'exp')
  addPoint(lane, 10, 0)
  near(read(lane, 5), 0.75, 1e-9)
  near(read(lane, 10), 0, 1e-9)
})

test('read holds a hold segment flat until the next point', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -6, 'hold')
  addPoint(lane, 10, 6)
  eq(read(lane, 0), -6)
  eq(read(lane, 5), -6)
  near(read(lane, 9.999), -6, 1e-9)
  eq(read(lane, 10), 6)
  eq(read(lane, 20), 6)
})

test('read mixes curves per segment, one shape at a time', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0, 'hold')
  addPoint(lane, 4, 6)
  addPoint(lane, 8, -6, 'exp')
  eq(read(lane, 2), 0, 'hold keeps first half flat')
  near(read(lane, 4), 6, 1e-9, 'joint is exact')
  near(read(lane, 6), 0, 1e-9, 'linear segment halfway down')
  near(read(lane, 8), -6, 1e-9)
})

test('read clamps results into the param range', () => {
  const lane = laneOf('send', 1)
  addPoint(lane, 0, 0.5)
  addPoint(lane, 4, 0)
  const v = read(lane, 1)
  ok(v >= 0 && v <= 1)
  near(v, 0.375, 1e-9)
})

test('read treats a non-finite time as zero and rejects bad lanes', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -6)
  addPoint(lane, 4, 0)
  eq(read(lane, NaN), -6)
  eq(read(lane, undefined), -6)
  throws(() => read(null, 0), 'null lane')
  throws(() => read({ points: [] }, 0), 'lane without param')
})

test('single-point lanes read that value everywhere', () => {
  const lane = laneOf('pan')
  addPoint(lane, 5, -0.5)
  eq(read(lane, 0), -0.5)
  eq(read(lane, 5), -0.5)
  eq(read(lane, 500), -0.5)
})

test('range reports the point extremes', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -20)
  addPoint(lane, 3, 2)
  addPoint(lane, 6, -5)
  const r = range(lane)
  eq(r.min, -20)
  eq(r.max, 2)
})

test('range on an empty lane is null/null', () => {
  const r = range(laneOf())
  eq(r.min, null)
  eq(r.max, null)
})

test('normalise maps values onto 0..1', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -20)
  addPoint(lane, 3, 2)
  addPoint(lane, 6, -9)
  const out = normalise(lane)
  eq(out.param, 'volume')
  eq(out.points.length, 3)
  eq(out.points[0].value, 0)
  eq(out.points[1].value, 1)
  near(out.points[2].value, 11 / 22, 1e-12)
  for (const p of out.points) ok(p.value >= 0 && p.value <= 1)
  ok(out !== lane)
  eq(read(out, 3), 1)
})

test('normalise keeps time and curve data', () => {
  const lane = laneOf('pan')
  addPoint(lane, 2, -1, 'hold')
  addPoint(lane, 4, 1)
  const out = normalise(lane)
  eq(out.points[0].t, 2)
  eq(out.points[0].curve, 'hold')
  eq(out.points.length, 2)
})

test('normalise flattens a zero-span lane to 0.5', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -3)
  addPoint(lane, 4, -3)
  const out = normalise(lane)
  eq(out.points[0].value, 0.5)
  eq(out.points[1].value, 0.5)
  eq(out.initial, 0.5)
  eq(normalise(laneOf()).initial, 0.5)
})

test('normalise never mutates the source lane', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, -20)
  addPoint(lane, 3, 2)
  const before = JSON.stringify(lane)
  normalise(lane)
  eq(JSON.stringify(lane), before)
  ok(normalise(lane).points[0] !== lane.points[0])
})

test('simplify drops points inside the tolerance', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 1, 0.001)
  addPoint(lane, 2, 0.002)
  addPoint(lane, 3, 0.003)
  const out = simplify(lane, 0.5)
  eq(out.points.length, 2)
  eq(out.points[0].t, 0)
  eq(out.points[1].t, 3)
})

test('simplify keeps a corner that exceeds the tolerance', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 2, 6)
  addPoint(lane, 4, 0)
  const out = simplify(lane, 0.5)
  eq(out.points.length, 3)
  eq(out.points[1].t, 2)
  eq(out.points[1].value, 6)
})

test('simplify with epsilon 0 keeps every bend but drops collinear points', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 1, 0)
  addPoint(lane, 2, 0)
  addPoint(lane, 3, 6)
  const out = simplify(lane, 0)
  eq(out.points.length, 3)
  eq(out.points.map((p) => p.t).join(','), '0,2,3')
})

test('simplify always keeps both endpoints and the param', () => {
  const lane = laneOf('send')
  addPoint(lane, 1, 0.1)
  addPoint(lane, 2, 0.2)
  addPoint(lane, 3, 0.3)
  const out = simplify(lane, 99)
  eq(out.points.length, 2)
  eq(out.points[0].t, 1)
  eq(out.points[1].t, 3)
  eq(out.param, 'send')
  eq(out.initial, lane.initial)
})

test('simplify never mutates the source and copies points', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 2, 6)
  addPoint(lane, 4, 0)
  const before = JSON.stringify(lane)
  const out = simplify(lane, 0.1)
  eq(JSON.stringify(lane), before)
  ok(out.points[0] !== lane.points[0])
  eq(lane.points.length, 3)
})

test('simplify passes short lanes through as copies', () => {
  const empty = simplify(laneOf())
  eq(empty.points.length, 0)
  const one = laneOf()
  addPoint(one, 1, -2)
  const kept = simplify(one)
  eq(kept.points.length, 1)
  ok(kept.points[0] !== one.points[0])
})

test('simplify falls back to the default epsilon on nonsense', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 1, 3)
  addPoint(lane, 2, 0)
  eq(simplify(lane, NaN).points.length, 3)
  eq(simplify(lane, -4).points.length, 3)
  eq(simplify(lane).points.length, 3)
})

test('cloneLane copies a lane deeply', () => {
  const lane = laneOf('pan')
  addPoint(lane, 1, 0.5, 'hold')
  const copy = cloneLane(lane)
  ok(copy !== lane && copy.points !== lane.points && copy.points[0] !== lane.points[0])
  copy.points[0].value = -1
  copy.points[0].curve = 'exp'
  copy.initial = 1
  eq(lane.points[0].value, 0.5)
  eq(lane.points[0].curve, 'hold')
  eq(lane.initial, 0)
})

test('simplify output still reads correctly', () => {
  const lane = laneOf('volume')
  addPoint(lane, 0, 0)
  addPoint(lane, 2, 6)
  addPoint(lane, 4, 0)
  const out = simplify(lane, 0.1)
  near(read(out, 1), 3, 1e-9)
  near(read(out, 3), 3, 1e-9)
  eq(read(out, 2), 6)
})

test('a full automation pass survives a rebuild', () => {
  const lane = laneOf('volume', -60)
  const a = addPoint(lane, 0, -60)
  addPoint(lane, 4, -12)
  const b = addPoint(lane, 8, 0)
  setCurve(lane, a.id, 'exp')
  movePoint(lane, b.id, 12, -3)
  const out = normalise(lane)
  eq(out.points.length, 3)
  near(read(lane, 2), -48, 1e-9, 'exp quarter of the way from -60 to -12')
  eq(range(lane).min, -60)
  eq(range(lane).max, -3)
  const simplified = simplify(lane, 1)
  ok(simplified.points.length <= lane.points.length)
  eq(read(simplified, 0), -60)
})

report()
