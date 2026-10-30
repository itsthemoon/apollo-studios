// scripts/selftest-versions.mjs — self-test for js/versions.js.
// Run from the project root:  node scripts/selftest-versions.mjs
import {
  createVersion,
  labelVersion,
  restore,
  prune,
  diffSummary,
  relativeTime,
  resetCounter,
} from '../js/versions.js'
import { test, eq, ok, throws, report } from './lib/assert.mjs'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const snapshot = () => ({ tempo: 120, tracks: [{ id: 't1' }], notes: [{ id: 'n1', midi: 60 }], fx: [] })
const clone = (v) => JSON.parse(JSON.stringify(v))

resetCounter()

test('createVersion: builds an id, label, stamp and snapshot', () => {
  const version = createVersion(snapshot(), 'first pass')
  ok(ID.test(version.id), `id shape ${version.id}`)
  eq(version.label, 'first pass', 'label kept')
  ok(ISO.test(version.at), `iso stamp ${version.at}`)
  eq(version.snapshot.tempo, 120, 'snapshot carried')
  eq(version.snapshot.tracks.length, 1, 'tracks carried')
  ok(version.snapshot !== null && typeof version.snapshot === 'object', 'snapshot is data')
})

test('createVersion: default label is used when omitted', () => {
  eq(createVersion(snapshot()).label, 'Untitled version', 'default label')
  eq(createVersion(snapshot(), undefined).label, 'Untitled version', 'undefined label')
})

test('createVersion: ids never repeat', () => {
  const ids = new Set()
  for (let i = 0; i < 300; i++) ids.add(createVersion({}).id)
  eq(ids.size, 300, 'three hundred distinct ids')
  for (const id of [...ids].slice(0, 20)) ok(ID.test(id), `id ${id} is shaped`)
})

test('createVersion: snapshot is a deep clone', () => {
  const source = snapshot()
  const version = createVersion(source, 'clone check')
  source.tempo = 999
  source.tracks[0].id = 'mutated'
  source.tracks.push({ id: 't2' })
  eq(version.snapshot.tempo, 120, 'tempo insulated')
  eq(version.snapshot.tracks[0].id, 't1', 'nested object insulated')
  eq(version.snapshot.tracks.length, 1, 'array length insulated')
  ok(version.snapshot.tracks !== source.tracks, 'no array aliasing')
})

test('createVersion: arrays and nested values survive the clone', () => {
  const rich = { tempo: 90, tracks: [{ id: 'a', name: 'vox', gainDb: -6 }], notes: [], fx: [{ id: 'f', kind: 'eq' }], extra: { deep: [1, 2, 3] } }
  const version = createVersion(rich, 'rich')
  eq(JSON.stringify(version.snapshot), JSON.stringify(rich), 'round trips exactly')
  eq(version.snapshot.extra.deep[2], 3, 'deep values kept')
})

test('createVersion: guards bad snapshots', () => {
  throws(() => createVersion(), 'missing snapshot')
  throws(() => createVersion(null), 'null snapshot')
  throws(() => createVersion([1, 2]), 'array snapshot')
  throws(() => createVersion('song'), 'string snapshot')
  throws(() => createVersion(7), 'numeric snapshot')
})

test('createVersion: labels are trimmed and capped', () => {
  eq(createVersion(snapshot(), '  spaced  ').label, 'spaced', 'trimmed')
  const long = createVersion(snapshot(), 'x'.repeat(200))
  eq(long.label.length, 80, 'capped at eighty')
  eq(createVersion(snapshot(), 'x'.repeat(200)).label.slice(0, 4), 'xxxx', 'keeps the head')
})

test('labelVersion: returns a fresh record', () => {
  const base = createVersion(snapshot(), 'old')
  const next = labelVersion(base, 'new')
  eq(next.label, 'new', 'label changed')
  eq(base.label, 'old', 'original label kept')
  eq(next.id, base.id, 'same id')
  eq(next.at, base.at, 'same stamp')
  ok(next !== base, 'new object')
  ok(next.snapshot !== base.snapshot, 'snapshot copied')
  eq(next.snapshot.tempo, base.snapshot.tempo, 'snapshot content equal')
})

test('labelVersion: editing the copy leaves the original alone', () => {
  const base = createVersion(snapshot(), 'old')
  const next = labelVersion(base, 'new')
  next.snapshot.tempo = 30
  next.snapshot.tracks.push({ id: 't9' })
  eq(base.snapshot.tempo, 120, 'tempo untouched')
  eq(base.snapshot.tracks.length, 1, 'tracks untouched')
})

test('labelVersion: trims, caps and guards', () => {
  const base = createVersion(snapshot(), 'old')
  eq(labelVersion(base, '  tight ').label, 'tight', 'trimmed')
  eq(labelVersion(base, 'y'.repeat(300)).label.length, 80, 'capped')
  throws(() => labelVersion(base, ''), 'empty label')
  throws(() => labelVersion(base, '   '), 'blank label')
  throws(() => labelVersion(base, 5), 'numeric label')
  throws(() => labelVersion(null, 'x'), 'null version')
  throws(() => labelVersion({ label: 'no snapshot' }, 'x'), 'missing snapshot')
})

test('restore: returns an equal deep clone', () => {
  const base = createVersion(snapshot(), 'restore me')
  const restored = restore(base)
  eq(JSON.stringify(restored), JSON.stringify(base.snapshot), 'identical content')
  ok(restored !== base.snapshot, 'fresh object')
  ok(restored.tracks !== base.snapshot.tracks, 'fresh array')
})

test('restore: mutating the result does not rewrite history', () => {
  const base = createVersion(snapshot(), 'stable')
  const restored = restore(base)
  restored.tempo = 40
  restored.notes[0].midi = 21
  restored.fx.push({ id: 'x' })
  eq(base.snapshot.tempo, 120, 'tempo stable')
  eq(base.snapshot.notes[0].midi, 60, 'nested note stable')
  eq(base.snapshot.fx.length, 0, 'array stable')
  eq(restore(base).tempo, 120, 'a second restore is still correct')
})

test('restore: guards bad versions', () => {
  throws(() => restore(), 'nothing passed')
  throws(() => restore(null), 'null')
  throws(() => restore([]), 'array')
  throws(() => restore({ id: 'a' }), 'no snapshot')
})

test('prune: keeps the newest entries up to the cap', () => {
  const versions = []
  for (let i = 0; i < 30; i++) {
    const v = createVersion({ n: i }, `v${i}`)
    v.at = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()
    versions.push(v)
  }
  const kept = prune(versions, 5)
  eq(kept.length, 5, 'capped')
  eq(kept.map((v) => v.snapshot.n).join(','), '29,28,27,26,25', 'newest first')
  ok(kept[0].at > kept[4].at, 'stamps descend')
})

test('prune: defaults to twenty and caps a long list', () => {
  const versions = []
  for (let i = 0; i < 45; i++) versions.push({ id: `v${i}`, at: new Date(2026, 0, 1, 0, i).toISOString(), snapshot: {} })
  eq(prune(versions).length, 20, 'default cap twenty')
  eq(prune(versions, 1).length, 1, 'cap one')
  eq(prune(versions, 100).length, 45, 'cap above the list length')
})

test('prune: does not mutate the input', () => {
  const versions = [
    { id: 'a', at: '2026-01-01T00:00:00.000Z', snapshot: {} },
    { id: 'b', at: '2026-01-02T00:00:00.000Z', snapshot: {} },
    { id: 'c', at: '2026-01-03T00:00:00.000Z', snapshot: {} },
  ]
  const kept = prune(versions, 2)
  eq(versions.length, 3, 'input still three')
  eq(versions[0].id, 'a', 'input order untouched')
  eq(kept.map((v) => v.id).join(','), 'c,b', 'kept newest two')
})

test('prune: ties fall back to id and bad stamps sort last', () => {
  const versions = [
    { id: 'a3', at: '2026-01-01T00:00:00.000Z', snapshot: {} },
    { id: 'a1', at: '2026-01-01T00:00:00.000Z', snapshot: {} },
    { id: 'a2', at: '2026-01-01T00:00:00.000Z', snapshot: {} },
    { id: 'bad', at: 'nope', snapshot: {} },
  ]
  eq(prune(versions, 3).map((v) => v.id).join(','), 'a3,a2,a1', 'id desc breaks the tie')
  eq(prune(versions, 4)[3].id, 'bad', 'unparseable stamp last')
})

test('prune: empty list and missing stamps', () => {
  eq(prune([]).length, 0, 'empty')
  eq(prune([{}, {}], 1).length, 1, 'records without a stamp')
})

test('prune: guards the list and the cap', () => {
  throws(() => prune(), 'no list')
  throws(() => prune(null), 'null list')
  throws(() => prune('nope'), 'string list')
  throws(() => prune([], 0), 'zero cap')
  throws(() => prune([], -3), 'negative cap')
  throws(() => prune([], 2.5), 'fractional cap')
  throws(() => prune([], Number.NaN), 'NaN cap')
  eq(prune([], 1).length, 0, 'valid empty call')
})

test('diffSummary: identical snapshots report nothing', () => {
  const a = snapshot()
  eq(JSON.stringify(diffSummary(a, clone(a))), JSON.stringify({ tracks: 0, notes: 0, fx: 0, tempo: 0 }), 'all zeroes')
})

test('diffSummary: shapes and defaults', () => {
  const out = diffSummary({}, {})
  eq(Object.keys(out).sort().join(','), 'fx,notes,tempo,tracks', 'exact keys')
  for (const key of ['tracks', 'notes', 'fx', 'tempo']) eq(out[key], 0, `zero ${key}`)
  eq(diffSummary(null, null).tempo, 0, 'nulls are safe')
  eq(diffSummary(undefined, undefined).tracks, 0, 'undefined is safe')
  eq(diffSummary({ tracks: 'nope' }, { tracks: 5 }).tracks, 0, 'non-array sections read empty')
})

test('diffSummary: counts added tracks by id', () => {
  const a = { tracks: [{ id: 't1' }] }
  const b = { tracks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] }
  const out = diffSummary(a, b)
  eq(out.tracks, 2, 'two added')
  eq(out.notes, 0, 'nothing else')
})

test('diffSummary: counts removed notes by id', () => {
  const a = { notes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }
  const b = { notes: [{ id: 'b' }] }
  const out = diffSummary(a, b)
  eq(out.notes, 2, 'two removed')
  eq(out.tracks, 0, 'nothing else')
})

test('diffSummary: counts changed fx records', () => {
  const a = { fx: [{ id: 'f1', gainDb: 0 }, { id: 'f2', gainDb: 0 }] }
  const b = { fx: [{ id: 'f1', gainDb: -6 }, { id: 'f2', gainDb: 0 }] }
  const out = diffSummary(a, b)
  eq(out.fx, 1, 'one change')
  eq(diffSummary(b, a).fx, 1, 'symmetric for changes')
})

test('diffSummary: added, removed and changed stack per section', () => {
  const a = { tracks: [{ id: 't1' }, { id: 't2' }] }
  const b = { tracks: [{ id: 't2', frozen: true }, { id: 't3' }] }
  const out = diffSummary(a, b)
  eq(out.tracks, 3, 'one removed, one changed, one added')
})

test('diffSummary: tempo reports a signed delta', () => {
  eq(diffSummary({ tempo: 120 }, { tempo: 132 }).tempo, 12, 'up')
  eq(diffSummary({ tempo: 140 }, { tempo: 128 }).tempo, -12, 'down')
  eq(diffSummary({ tempo: 120 }, { tempo: 120 }).tempo, 0, 'unchanged')
  eq(diffSummary({ tempo: 120 }, {}).tempo, 0, 'missing tempo zeroes')
  eq(diffSummary({ tempo: 'fast' }, { tempo: 90 }).tempo, 0, 'non-numeric tempo zeroes')
})

test('diffSummary: records without ids fall back to index', () => {
  const a = { notes: [{ midi: 60 }, { midi: 62 }] }
  const b = { notes: [{ midi: 60 }, { midi: 67 }, { midi: 72 }] }
  const out = diffSummary(a, b)
  eq(out.notes, 2, 'one changed, one added')
  eq(diffSummary(a, a).notes, 0, 'same record is unchanged')
})

test('relativeTime: recent stamps read as now', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0)
  eq(relativeTime(new Date(now).toISOString(), now), 'just now', 'zero')
  eq(relativeTime(new Date(now - 5_000).toISOString(), now), 'just now', 'five seconds')
  eq(relativeTime(new Date(now - 44_000).toISOString(), now), 'just now', 'forty-four seconds')
  eq(relativeTime(new Date(now + 30_000).toISOString(), now), 'just now', 'slightly future')
})

test('relativeTime: seconds, minutes, hours, days and weeks', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0)
  eq(relativeTime(new Date(now - 45_000).toISOString(), now), '45s ago', 'seconds')
  eq(relativeTime(new Date(now - 90_000).toISOString(), now), '1m ago', 'ninety seconds')
  eq(relativeTime(new Date(now - 39 * 60_000).toISOString(), now), '39m ago', 'minutes')
  eq(relativeTime(new Date(now - 90 * 60_000).toISOString(), now), '1h ago', 'ninety minutes')
  eq(relativeTime(new Date(now - 23 * 3_600_000).toISOString(), now), '23h ago', 'hours')
  eq(relativeTime(new Date(now - 50 * 3_600_000).toISOString(), now), '2d ago', 'two days')
  eq(relativeTime(new Date(now - 13 * 86_400_000).toISOString(), now), '1w ago', 'thirteen days')
  eq(relativeTime(new Date(now - 34 * 86_400_000).toISOString(), now), '4w ago', 'weeks')
})

test('relativeTime: older stamps fall back to a date', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0)
  eq(relativeTime('2026-01-15T08:30:00.000Z', now), '2026-01-15', 'january date')
  eq(relativeTime('2025-12-31T23:00:00.000Z', now), '2025-12-31', 'previous year')
  eq(relativeTime('2020-02-29T00:00:00.000Z', now), '2020-02-29', 'leap day')
})

test('relativeTime: guards garbage and defaults now', () => {
  eq(relativeTime('nope'), 'unknown', 'garbage')
  eq(relativeTime(''), 'unknown', 'empty')
  eq(relativeTime(undefined), 'unknown', 'undefined')
  eq(relativeTime(null), 'unknown', 'null')
  eq(relativeTime(42), 'unknown', 'number')
  const now = Date.UTC(2026, 5, 1, 12, 0, 0)
  const real = Date.now()
  eq(relativeTime(new Date(real - 60_000).toISOString(), 'soon'), '1m ago', 'bad now falls back')
  ok(typeof relativeTime(new Date().toISOString()) === 'string', 'default now runs')
})

test('history round trip keeps every version independent', () => {
  const one = createVersion(snapshot(), 'one')
  const two = createVersion({ tempo: 100, tracks: [], notes: [], fx: [] }, 'two')
  const restoredOne = restore(one)
  restoredOne.tracks[0].id = 'edited'
  eq(two.snapshot.tempo, 100, 'second version untouched')
  eq(one.snapshot.tracks[0].id, 't1', 'first version untouched')
  const summary = diffSummary(one.snapshot, two.snapshot)
  eq(summary.tracks, 1, 'one track removed')
  eq(summary.tempo, -20, 'tempo dropped twenty')
  const kept = prune([one, two], 1)
  eq(kept[0].label, 'two', 'newest kept')
})

report()
