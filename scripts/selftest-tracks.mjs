// scripts/selftest-tracks.mjs — self-test for js/tracks.js.
// Run from the project root:  node scripts/selftest-tracks.mjs
import {
  TRACK_TYPES,
  TRACK_TYPE_SLUGS,
  VOLUME_MIN_DB,
  VOLUME_MAX_DB,
  SEND_KEYS,
  MAX_NAME_LENGTH,
  clampDb,
  clampPan,
  clampSend,
  clampIndex,
  isTrackType,
  typeInfo,
  makeTrackId,
  resetTrackIds,
  createTrack,
  rename,
  setColor,
  setVolumeDb,
  setPan,
  setSend,
  toggleMute,
  toggleSolo,
  toggleArm,
  resolveSolo,
  addTrack,
  removeTrack,
  moveTrack,
  duplicateTrack,
  summarise,
  deepClone,
} from '../js/tracks.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const fresh = () => {
  resetTrackIds(1)
  return []
}

test('TRACK_TYPES ships the six picker types plus loop with full metadata', () => {
  eq(TRACK_TYPES.length, 7)
  eq(TRACK_TYPES.map((t) => t.slug).join(','), 'voice,instrument,drums,sampler,guitar,bass,loop')
  for (const t of TRACK_TYPES) {
    ok(typeof t.label === 'string' && t.label.length > 0, `${t.slug}: label`)
    ok(typeof t.icon === 'string' && t.icon.length > 0, `${t.slug}: icon`)
    ok(/^#[0-9a-f]{6}$/i.test(t.color), `${t.slug}: color`)
  }
})

test('TRACK_TYPES and its entries are frozen', () => {
  ok(Object.isFrozen(TRACK_TYPES))
  ok(TRACK_TYPES.every((t) => Object.isFrozen(t)))
  ok(Object.isFrozen(TRACK_TYPE_SLUGS))
  eq(TRACK_TYPE_SLUGS.length, 7)
})

test('isTrackType and typeInfo resolve only real slugs', () => {
  for (const slug of TRACK_TYPE_SLUGS) {
    ok(isTrackType(slug))
    eq(typeInfo(slug).slug, slug)
  }
  eq(isTrackType('pad'), false)
  eq(isTrackType(''), false)
  eq(isTrackType(null), false)
  eq(typeInfo('pad'), null)
})

test('clampDb pins the volume ceiling and floor', () => {
  eq(clampDb(0), 0)
  eq(clampDb(-6), -6)
  eq(clampDb(-999), VOLUME_MIN_DB)
  eq(clampDb(999), VOLUME_MAX_DB)
  eq(clampDb(-60), -60)
  eq(clampDb(6), 6)
  eq(clampDb(-60.0001), VOLUME_MIN_DB)
  eq(clampDb(6.0001), VOLUME_MAX_DB)
})

test('clampPan pins pan to -1..1 and neutralises garbage', () => {
  eq(clampPan(0), 0)
  eq(clampPan(-0.5), -0.5)
  eq(clampPan(-4), -1)
  eq(clampPan(4), 1)
  eq(clampPan(NaN), 0)
  eq(clampPan(Infinity), 0)
  eq(clampPan(undefined), 0)
})

test('clampSend pins sends to 0..1 and neutralises garbage', () => {
  eq(clampSend(0), 0)
  eq(clampSend(0.4), 0.4)
  eq(clampSend(-2), 0)
  eq(clampSend(9), 1)
  eq(clampSend(NaN), 0)
  eq(clampSend(null), 0)
})

test('clampIndex truncates, floors at 0 and caps at max', () => {
  eq(clampIndex(3, 10), 3)
  eq(clampIndex(-2, 10), 0)
  eq(clampIndex(99, 10), 10)
  eq(clampIndex(2.9, 10), 2)
  eq(clampIndex(NaN, 10), 0)
  eq(clampIndex(5, -3), 0)
})

test('makeTrackId hands out unique, prefixed ids', () => {
  resetTrackIds(1)
  const a = makeTrackId()
  const b = makeTrackId()
  eq(a, 't1')
  eq(b, 't2')
  ok(a !== b)
  resetTrackIds()
  eq(makeTrackId(), 't1')
})

test('createTrack fills the whole shape with neutral defaults', () => {
  resetTrackIds(1)
  const track = createTrack({ type: 'voice', index: 2 })
  eq(track.id, 't1')
  eq(track.type, 'voice')
  eq(track.index, 2)
  eq(track.name, 'Voice/Audio 3')
  eq(track.color, TRACK_TYPES[0].color)
  eq(track.volumeDb, 0)
  eq(track.pan, 0)
  eq(track.mute, false)
  eq(track.solo, false)
  eq(track.armed, false)
  eq(track.chain.length, 0)
  eq(track.roll, null)
  eq(track.pattern, null)
  eq(track.sends.reverb, 0)
  eq(track.sends.delay, 0)
  eq(track.automation.volume.length, 0)
  eq(track.automation.pan.length, 0)
  eq(track.clip.startBeat, 0)
  eq(track.clip.lengthBeats, 4)
  eq(track.clip.gain, 1)
  eq(track.clip.stretch, 1)
  ok(Number.isFinite(track.clip.fadeIn))
})

test('createTrack honours name, color and id overrides', () => {
  const track = createTrack({ type: 'drums', name: '  Kit  ', color: '#ABCDEF', id: 'custom' })
  eq(track.name, 'Kit')
  eq(track.color, '#ABCDEF')
  eq(track.id, 'custom')
  eq(track.type, 'drums')
})

test('createTrack defaults the type to voice', () => {
  eq(createTrack({}).type, 'voice')
  eq(createTrack().type, 'voice')
  eq(createTrack({ index: 0 }).name, 'Voice/Audio 1')
})

test('createTrack rejects bad specs', () => {
  throws(() => createTrack({ type: 'pad' }), 'unknown type')
  throws(() => createTrack(null), 'null spec')
  throws(() => createTrack([]), 'array spec')
  eq(createTrack({ type: 'loop', index: NaN }).index, 0)
})

test('every track gets its own nested objects', () => {
  const a = createTrack({ type: 'voice' })
  const b = createTrack({ type: 'voice' })
  ok(a.sends !== b.sends)
  ok(a.chain !== b.chain)
  ok(a.automation !== b.automation)
  ok(a.automation.volume !== b.automation.volume)
  ok(a.clip !== b.clip)
  a.sends.reverb = 0.8
  a.chain.push('comp')
  eq(b.sends.reverb, 0)
  eq(b.chain.length, 0)
})

test('rename trims, caps length and rejects empties', () => {
  const track = createTrack({ type: 'voice' })
  rename(track, '  Lead Vocal  ')
  eq(track.name, 'Lead Vocal')
  rename(track, 'x'.repeat(200))
  eq(track.name.length, MAX_NAME_LENGTH)
  throws(() => rename(track, ''), 'empty name')
  throws(() => rename(track, '   '), 'blank name')
  throws(() => rename(track, null), 'null name')
  eq(rename(track, 'Backing'), track, 'rename returns the track')
})

test('setColor accepts 6-digit and 3-digit hex, lowercasing', () => {
  const track = createTrack({ type: 'voice' })
  setColor(track, '#AABBCC')
  eq(track.color, '#aabbcc')
  setColor(track, '#ABC')
  eq(track.color, '#aabbcc')
  eq(setColor(track, '#123456'), track)
})

test('setColor rejects non-hex colours', () => {
  const track = createTrack({ type: 'voice' })
  for (const bad of ['red', 'aabbcc', '#ab', '#abcdef0', '#gggggg', '', null]) {
    throws(() => setColor(track, bad), `bad colour ${String(bad)}`)
  }
})

test('setVolumeDb clamps to the fader range and returns the track', () => {
  const track = createTrack({ type: 'voice' })
  eq(setVolumeDb(track, -12), track)
  eq(track.volumeDb, -12)
  setVolumeDb(track, -200)
  eq(track.volumeDb, VOLUME_MIN_DB)
  setVolumeDb(track, 200)
  eq(track.volumeDb, VOLUME_MAX_DB)
  setVolumeDb(track, NaN)
  eq(track.volumeDb, 0)
})

test('setPan clamps to -1..1', () => {
  const track = createTrack({ type: 'instrument' })
  setPan(track, -0.25)
  eq(track.pan, -0.25)
  setPan(track, -9)
  eq(track.pan, -1)
  setPan(track, 9)
  eq(track.pan, 1)
  setPan(track, Infinity)
  eq(track.pan, 0)
})

test('setSend writes the named send only and clamps it', () => {
  const track = createTrack({ type: 'voice' })
  eq(SEND_KEYS.join(','), 'reverb,delay')
  setSend(track, 'reverb', 0.5)
  eq(track.sends.reverb, 0.5)
  eq(track.sends.delay, 0)
  setSend(track, 'delay', 5)
  eq(track.sends.delay, 1)
  setSend(track, 'delay', -5)
  eq(track.sends.delay, 0)
  eq(setSend(track, 'reverb', 0.1), track)
})

test('setSend rejects unknown send names', () => {
  const track = createTrack({ type: 'voice' })
  throws(() => setSend(track, 'chorus', 0.2), 'unknown send')
  throws(() => setSend(track, 'constructor', 0.2), 'prototype key')
  throws(() => setSend(track, undefined, 0.2), 'missing send')
})

test('toggles flip booleans and return the track', () => {
  const track = createTrack({ type: 'drums' })
  eq(toggleMute(track), track)
  eq(track.mute, true)
  toggleMute(track)
  eq(track.mute, false)
  toggleSolo(track)
  eq(track.solo, true)
  toggleSolo(track)
  eq(track.solo, false)
  toggleArm(track)
  eq(track.armed, true)
  toggleArm(track)
  eq(track.armed, false)
})

test('guards reject non-tracks on every setter', () => {
  for (const fn of [rename, setColor, setVolumeDb, setPan, toggleMute, toggleSolo, toggleArm]) {
    throws(() => fn(null, 'x'), `${fn.name} on null`)
  }
  throws(() => setSend(null, 'reverb', 1))
})

test('resolveSolo returns every unmuted id when nothing is soloed', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const audible = resolveSolo(list)
  eq(audible.size, 2)
  ok(audible.has(a.id) && audible.has(b.id))
})

test('resolveSolo with one solo silences the rest', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const c = addTrack(list, { type: 'loop' })
  toggleSolo(b)
  const audible = resolveSolo(list)
  eq(audible.size, 1)
  ok(audible.has(b.id))
  ok(!audible.has(a.id) && !audible.has(c.id))
})

test('resolveSolo keeps every soloed track and drops muted ones', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const c = addTrack(list, { type: 'loop' })
  toggleSolo(a)
  toggleSolo(c)
  toggleMute(b)
  const audible = resolveSolo(list)
  eq(audible.size, 2)
  ok(audible.has(a.id) && audible.has(c.id))
  ok(!audible.has(b.id))
})

test('mute outranks solo on the same track', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  addTrack(list, { type: 'drums' })
  toggleSolo(a)
  toggleMute(a)
  const audible = resolveSolo(list)
  eq(audible.size, 0)
  eq(a.solo, true)
  eq(a.mute, true)
})

test('resolveSolo with no solos drops muted tracks only', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  toggleMute(a)
  const audible = resolveSolo(list)
  eq(audible.size, 1)
  ok(audible.has(b.id))
})

test('resolveSolo returns a Set and copes with an empty list', () => {
  const list = fresh()
  const empty = resolveSolo(list)
  ok(empty instanceof Set)
  eq(empty.size, 0)
  addTrack(list, { type: 'voice' })
  ok(resolveSolo(list) instanceof Set)
  throws(() => resolveSolo(null))
  throws(() => resolveSolo({}))
})

test('addTrack appends, assigns ids and keeps indexes in step', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const c = addTrack(list, { type: 'loop' })
  eq(list.length, 3)
  eq(list.map((t) => t.id).join(','), 't1,t2,t3')
  eq(list.map((t) => t.index).join(','), '0,1,2')
  ok(a.id !== b.id && b.id !== c.id)
  eq(c.index, 2)
})

test('addTrack gives distinct default names by index', () => {
  const list = fresh()
  eq(addTrack(list, { type: 'instrument' }).name, 'Virtual instruments 1')
  eq(addTrack(list, { type: 'instrument' }).name, 'Virtual instruments 2')
})

test('removeTrack returns the track and reindexes survivors', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const c = addTrack(list, { type: 'loop' })
  const gone = removeTrack(list, b.id)
  eq(gone.id, b.id)
  eq(list.length, 2)
  eq(list.map((t) => t.id).join(','), `${a.id},${c.id}`)
  eq(list.map((t) => t.index).join(','), '0,1')
  eq(c.index, 1)
})

test('removeTrack returns null for an unknown id and leaves the list alone', () => {
  const list = fresh()
  addTrack(list, { type: 'voice' })
  eq(removeTrack(list, 'nope'), null)
  eq(removeTrack(list, undefined), null)
  eq(list.length, 1)
  eq(list[0].index, 0)
})

test('moveTrack reorders to an index and reindexes', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const c = addTrack(list, { type: 'loop' })
  const moved = moveTrack(list, a.id, 2)
  eq(moved.id, a.id)
  eq(list.map((t) => t.id).join(','), `${b.id},${c.id},${a.id}`)
  eq(list.map((t) => t.index).join(','), '0,1,2')
})

test('moveTrack clamps out-of-range targets', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  moveTrack(list, b.id, 99)
  eq(list.map((t) => t.id).join(','), `${a.id},${b.id}`)
  moveTrack(list, b.id, -5)
  eq(list.map((t) => t.id).join(','), `${b.id},${a.id}`)
  eq(list.map((t) => t.index).join(','), '0,1')
})

test('moveTrack returns null for an unknown id', () => {
  const list = fresh()
  addTrack(list, { type: 'voice' })
  eq(moveTrack(list, 'nope', 0), null)
  eq(list.length, 1)
})

test('moveTrack to the same index is a no-op', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  moveTrack(list, a.id, 0)
  eq(list.map((t) => t.id).join(','), `${a.id},${b.id}`)
  eq(list[0].index, 0)
})

test('duplicateTrack inserts a copy right after the source', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  const b = addTrack(list, { type: 'drums' })
  const copy = duplicateTrack(list, a.id)
  eq(list.map((t) => t.id).join(','), `${a.id},${copy.id},${b.id}`)
  eq(copy.name, `${a.name} copy`)
  eq(list.map((t) => t.index).join(','), '0,1,2')
})

test('duplicateTrack gives a fresh id and deep-copies nested data', () => {
  const list = fresh()
  const src = addTrack(list, { type: 'instrument', name: 'Bass' })
  setSend(src, 'reverb', 0.4)
  src.chain.push({ kind: 'comp', thresholdDb: -12 })
  src.automation.volume.push({ param: 'volume', initial: 0, points: [] })
  src.clip.startBeat = 8
  src.roll = { steps: [1, 0] }
  const copy = duplicateTrack(list, src.id)
  ok(copy.id !== src.id)
  ok(copy.sends !== src.sends)
  ok(copy.chain !== src.chain)
  ok(copy.automation.volume !== src.automation.volume)
  ok(copy.clip !== src.clip)
  ok(copy.roll !== src.roll)
  copy.sends.reverb = 0.9
  copy.chain[0].thresholdDb = -30
  copy.automation.volume[0].initial = -6
  copy.clip.startBeat = 0
  copy.roll.steps[0] = 9
  eq(src.sends.reverb, 0.4)
  eq(src.chain[0].thresholdDb, -12)
  eq(src.automation.volume[0].initial, 0)
  eq(src.clip.startBeat, 8)
  eq(src.roll.steps[0], 1)
  eq(copy.clip.startBeat, 0)
})

test('duplicateTrack truncates a long copied name', () => {
  const list = fresh()
  const src = addTrack(list, { type: 'loop', name: 'x'.repeat(MAX_NAME_LENGTH) })
  const copy = duplicateTrack(list, src.id)
  eq(copy.name.length, MAX_NAME_LENGTH)
  ok(copy.name.endsWith(' copy'))
})

test('duplicateTrack returns null for an unknown id', () => {
  const list = fresh()
  addTrack(list, { type: 'voice' })
  eq(duplicateTrack(list, 'nope'), null)
  eq(list.length, 1)
})

test('list helpers reject non-arrays', () => {
  for (const fn of [addTrack, removeTrack, moveTrack, duplicateTrack, summarise, resolveSolo]) {
    throws(() => fn(null, 't1'), `${fn.name} on null`)
    throws(() => fn({}, 't1'), `${fn.name} on object`)
  }
})

test('summarise reports counts, audibility, arms and type mix', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  addTrack(list, { type: 'voice' })
  const c = addTrack(list, { type: 'drums' })
  toggleArm(a)
  toggleArm(c)
  toggleMute(c)
  const s = summarise(list)
  eq(s.count, 3)
  eq(s.armed, 2)
  eq(s.audible, 2)
  eq(s.types.voice, 2)
  eq(s.types.drums, 1)
  eq(s.types.instrument, 0)
  eq(s.types.loop, 0)
})

test('summarise counts audible through solo state', () => {
  const list = fresh()
  const a = addTrack(list, { type: 'voice' })
  addTrack(list, { type: 'drums' })
  toggleSolo(a)
  eq(summarise(list).audible, 1)
  eq(summarise(list).count, 2)
})

test('summarise on an empty list is all zeros', () => {
  const s = summarise([])
  eq(s.count, 0)
  eq(s.audible, 0)
  eq(s.armed, 0)
  eq(Object.values(s.types).reduce((x, y) => x + y, 0), 0)
  eq(Object.keys(s.types).length, 7)
})

test('deepClone copies nested arrays and leaves the source intact', () => {
  const src = { a: [1, { b: 2 }], c: { d: 3 } }
  const out = deepClone(src)
  ok(out !== src && out.a !== src.a && out.a[1] !== src.a[1] && out.c !== src.c)
  out.a[1].b = 99
  out.c.d = 99
  eq(src.a[1].b, 2)
  eq(src.c.d, 3)
  eq(deepClone(5), 5)
  eq(deepClone('x'), 'x')
  eq(deepClone(null), null)
  ok(Array.isArray(deepClone([1, 2])))
})

test('a full mixer session keeps ids and indexes coherent', () => {
  const list = fresh()
  const ids = []
  for (const type of TRACK_TYPE_SLUGS) ids.push(addTrack(list, { type }).id)
  toggleSolo(list[1])
  removeTrack(list, list[0].id)
  duplicateTrack(list, list[0].id)
  moveTrack(list, list[list.length - 1].id, 0)
  eq(list.length, 7)
  eq(new Set(list.map((t) => t.id)).size, 7)
  eq(list.map((t) => t.index).join(','), '0,1,2,3,4,5,6')
  eq(summarise(list).count, 7)
  near(list[0].volumeDb, 0, 0, 'fresh inserts stay at unity')
})

report()
