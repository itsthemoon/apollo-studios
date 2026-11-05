// js/tracks.js — project track model and mixer state.
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and
// in the browser.
//
// A track is plain data so it can be JSON-dumped with the project:
//   { id, index, type, name, color, volumeDb, pan, mute, solo, armed,
//     sends: { reverb, delay }, chain: [], roll: null, pattern: null,
//     automation: { volume: [], pan: [] },
//     clip: { startBeat, lengthBeats, gain, fadeIn, fadeOut, stretch } }
//
// Mutators edit the track in place and return it, so calls chain:
//   setVolumeDb(track, -6) -> track
// List helpers edit the list in place, reindex every survivor (index always
// equals array position), and return the affected track, or null when the id
// is unknown.

export const TRACK_TYPES = Object.freeze([
  Object.freeze({ slug: 'voice', glyph: '🎤', label: 'Voice/Audio', icon: 'mic', color: '#7c6cf0', hint: 'Record with AutoPitch + FX', midi: false, picker: true }),
  Object.freeze({ slug: 'instrument', glyph: '🎹', label: 'Virtual instruments', icon: 'keys', color: '#3fa9a0', hint: 'Record kits, keys and more', midi: true, picker: true }),
  Object.freeze({ slug: 'drums', glyph: '🥁', label: 'Drum Machine', icon: 'drum', color: '#e0813f', hint: 'Create beats in seconds', midi: true, picker: true }),
  Object.freeze({ slug: 'sampler', glyph: '〰', label: 'Sampler', icon: 'wave', color: '#56a7e0', hint: 'Turn any sound into an instrument', midi: true, picker: true }),
  Object.freeze({ slug: 'guitar', glyph: '🎸', label: 'Guitar', icon: 'guitar', color: '#c9a227', hint: 'Jam with Amps + FX', midi: false, picker: true }),
  Object.freeze({ slug: 'bass', glyph: '🎻', label: 'Bass', icon: 'bass', color: '#5dbb63', hint: 'Find your signature tone', midi: false, picker: true }),
  Object.freeze({ slug: 'loop', glyph: '🔁', label: 'Loop', icon: 'repeat', color: '#c94f8c', hint: 'Repeat an audio phrase', midi: false, picker: false }),
])

const TYPE_BY_SLUG = new Map(TRACK_TYPES.map((t) => [t.slug, t]))
export const TRACK_TYPE_SLUGS = Object.freeze(TRACK_TYPES.map((t) => t.slug))

export const VOLUME_MIN_DB = -60
export const VOLUME_MAX_DB = 6
export const PAN_MIN = -1
export const PAN_MAX = 1
export const SEND_MIN = 0
export const SEND_MAX = 1
export const SEND_KEYS = Object.freeze(['reverb', 'delay'])
export const MAX_NAME_LENGTH = 60

// --- clamps --------------------------------------------------------------
// Non-finite input falls back to the neutral value for that parameter, then
// gets clamped, so a lane can never carry NaN into the graph.

export function clampDb(db) {
  if (!Number.isFinite(db)) return 0
  return Math.min(VOLUME_MAX_DB, Math.max(VOLUME_MIN_DB, db))
}

export function clampPan(pan) {
  if (!Number.isFinite(pan)) return 0
  return Math.min(PAN_MAX, Math.max(PAN_MIN, pan))
}

export function clampSend(mix) {
  if (!Number.isFinite(mix)) return 0
  return Math.min(SEND_MAX, Math.max(SEND_MIN, mix))
}

export function clampIndex(index, max) {
  const n = Number.isFinite(index) ? Math.trunc(index) : 0
  return Math.min(Math.max(0, n), Math.max(0, max))
}

export function isTrackType(type) {
  return typeof type === 'string' && TYPE_BY_SLUG.has(type)
}

export function typeInfo(type) {
  return TYPE_BY_SLUG.get(type) ?? null
}

// --- ids -----------------------------------------------------------------

let nextId = 1

// `t1`, `t2`, ... — stable, readable, and cheap to diff in a saved project.
export function makeTrackId() {
  return `t${nextId++}`
}

// Test hook: restarts the counter so a fresh run is reproducible.
export function resetTrackIds(to = 1) {
  nextId = Number.isFinite(to) ? Math.max(1, Math.trunc(to)) : 1
  return nextId
}

// --- guards --------------------------------------------------------------

function assertTrack(track) {
  if (track === null || typeof track !== 'object' || Array.isArray(track)) {
    throw new Error('track must be an object')
  }
  return track
}

function assertList(list) {
  if (!Array.isArray(list)) throw new Error('track list must be an array')
  return list
}

function findIndexById(list, id) {
  return list.findIndex((track) => track && track.id === id)
}

function reindex(list) {
  list.forEach((track, i) => {
    track.index = i
  })
  return list
}

// --- construction --------------------------------------------------------

export function createTrack(spec = {}) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('track spec must be an object')
  }
  const type = spec.type ?? 'voice'
  if (!isTrackType(type)) throw new Error('unknown track type')
  const info = TYPE_BY_SLUG.get(type)
  const index = clampIndex(spec.index, 9999)
  const name = typeof spec.name === 'string' && spec.name.trim() ? spec.name.trim() : `${info.label} ${index + 1}`
  return {
    id: typeof spec.id === 'string' && spec.id ? spec.id : makeTrackId(),
    index,
    type,
    name: name.slice(0, MAX_NAME_LENGTH),
    color: typeof spec.color === 'string' && spec.color ? spec.color : info.color,
    volumeDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    frozen: false,
    sends: { reverb: 0, delay: 0 },
    chain: [],
    roll: null,
    pattern: null,
    automation: { volume: [], pan: [] },
    clip: { startBeat: 0, lengthBeats: 4, gain: 1, fadeIn: 0, fadeOut: 0, stretch: 1 },
  }
}

// --- scalar setters ------------------------------------------------------

export function rename(track, name) {
  assertTrack(track)
  const next = String(name ?? '').trim()
  if (!next) throw new Error('name must be a non-empty string')
  track.name = next.slice(0, MAX_NAME_LENGTH)
  return track
}

export function setColor(track, color) {
  assertTrack(track)
  const raw = String(color ?? '').trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw)
  const full = /^#[0-9a-f]{6}$/i.exec(raw)
  if (!short && !full) throw new Error('color must be a hex string')
  track.color = short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() : raw.toLowerCase()
  return track
}

export function setVolumeDb(track, db) {
  assertTrack(track)
  track.volumeDb = clampDb(db)
  return track
}

export function setPan(track, pan) {
  assertTrack(track)
  track.pan = clampPan(pan)
  return track
}

export function setSend(track, key, mix) {
  assertTrack(track)
  if (!SEND_KEYS.includes(key)) throw new Error('unknown send')
  track.sends[key] = clampSend(mix)
  return track
}

export function toggleMute(track) {
  assertTrack(track)
  track.mute = !track.mute
  return track
}

export function toggleSolo(track) {
  assertTrack(track)
  track.solo = !track.solo
  return track
}

export function toggleArm(track) {
  assertTrack(track)
  track.armed = !track.armed
  return track
}

// --- solo resolution -----------------------------------------------------

// Any solo (muted or not) silences every non-solo track. A muted track is
// never audible, even when soloed — mute outranks solo.
export function resolveSolo(tracks) {
  assertList(tracks)
  const anySolo = tracks.some((track) => track && track.solo)
  const audible = new Set()
  for (const track of tracks) {
    if (!track) continue
    if (track.mute) continue
    if (anySolo && !track.solo) continue
    audible.add(track.id)
  }
  return audible
}

// --- list operations -----------------------------------------------------

export function addTrack(list, spec = {}) {
  assertList(list)
  const track = createTrack({ ...spec, index: list.length })
  list.push(track)
  reindex(list)
  return track
}

export function removeTrack(list, id) {
  assertList(list)
  const at = findIndexById(list, id)
  if (at === -1) return null
  const [gone] = list.splice(at, 1)
  reindex(list)
  return gone
}

export function moveTrack(list, id, toIndex) {
  assertList(list)
  const at = findIndexById(list, id)
  if (at === -1) return null
  const target = clampIndex(toIndex, list.length - 1)
  const [track] = list.splice(at, 1)
  list.splice(target, 0, track)
  reindex(list)
  return track
}

export function duplicateTrack(list, id) {
  assertList(list)
  const at = findIndexById(list, id)
  if (at === -1) return null
  const copy = deepClone(list[at])
  copy.id = makeTrackId()
  copy.name = `${copy.name.slice(0, MAX_NAME_LENGTH - 5)} copy`
  list.splice(at + 1, 0, copy)
  reindex(list)
  return copy
}

// --- summary -------------------------------------------------------------

export function summarise(list) {
  assertList(list)
  const types = {}
  for (const slug of TRACK_TYPE_SLUGS) types[slug] = 0
  let armed = 0
  for (const track of list) {
    if (!track) continue
    if (track.armed) armed += 1
    if (Object.hasOwn(types, track.type)) types[track.type] += 1
  }
  return { count: list.length, audible: resolveSolo(list).size, armed, types }
}

// --- clone ---------------------------------------------------------------

export function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = deepClone(value[key])
    return out
  }
  return value
}
