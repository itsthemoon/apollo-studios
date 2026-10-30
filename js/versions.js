// js/versions.js — version history for apollo-studios.
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and in the
// browser. See js/contract-appendix.md.
//
// A version is a label plus a full JSON snapshot. Snapshots are plain data and are always
// deep-cloned on the way in and out, so editing the live project never rewrites history
// and restoring an old version never aliases the stored copy.
//
// Snapshot shape (all sections optional):
//   { tempo: number, tracks: [{ id, ... }], notes: [{ id, ... }], fx: [{ id, ... }] }
//
// prune keeps the newest `cap` entries. diffSummary counts added, removed and changed
// items per section by id (falling back to index when a record has none) and reports the
// tempo move as a signed delta.

const DEFAULT_LABEL = 'Untitled version'
const MAX_LABEL = 80
const DEFAULT_CAP = 20

let counter = 0

// Deterministic, uuid-shaped ids: a hashed counter in the first group, the raw counter in
// the second, so two versions can never collide inside a session.
function nextId() {
  counter += 1
  const n = counter >>> 0
  const mixed = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0
  const head = mixed.toString(16).padStart(8, '0')
  const tail = n.toString(16).padStart(4, '0')
  return `${head}-${tail}-4${head.slice(0, 3)}`
}

export function resetCounter() {
  counter = 0
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value))
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanLabel(label) {
  const text = typeof label === 'string' ? label.trim() : ''
  if (!text) throw new Error('bad label')
  return text.length > MAX_LABEL ? text.slice(0, MAX_LABEL) : text
}

function requireVersion(version) {
  if (!isRecord(version) || !isRecord(version.snapshot)) throw new Error('bad version')
  return version
}

// ---- history ------------------------------------------------------------------

export function createVersion(snapshot, label = DEFAULT_LABEL) {
  if (!isRecord(snapshot)) throw new Error('bad snapshot')
  return {
    id: nextId(),
    rev: counter,
    label: cleanLabel(label),
    at: new Date().toISOString(),
    snapshot: clone(snapshot),
  }
}

// New object, new snapshot copy, original untouched.
export function labelVersion(version, label) {
  const source = requireVersion(version)
  return { ...source, label: cleanLabel(label), snapshot: clone(source.snapshot) }
}

export function restore(version) {
  return clone(requireVersion(version).snapshot)
}

// Newest first, capped. Ties fall back to id so the order is stable for equal stamps.
export function prune(versions, cap = DEFAULT_CAP) {
  if (!Array.isArray(versions)) throw new Error('bad versions')
  if (!Number.isFinite(cap) || !Number.isInteger(cap) || cap < 1) throw new Error('bad cap')
  return versions
    .slice()
    .sort((a, b) => {
      const at = Date.parse(b?.at ?? '') || 0
      const bt = Date.parse(a?.at ?? '') || 0
      if (at !== bt) return at - bt
      const rev = (b?.rev ?? 0) - (a?.rev ?? 0)
      if (rev) return rev
      return String(b?.id ?? '').localeCompare(String(a?.id ?? ''))
    })
    .slice(0, cap)
}

// ---- diff ---------------------------------------------------------------------

const SECTIONS = ['tracks', 'notes', 'fx']

function sectionOf(snapshot, key) {
  const value = snapshot[key]
  return Array.isArray(value) ? value : []
}

function keyOf(item, index) {
  if (isRecord(item) && typeof item.id === 'string' && item.id) return `id:${item.id}`
  if (isRecord(item) && typeof item.id === 'number') return `id:${item.id}`
  return `at:${index}`
}

function countSection(before, after) {
  const left = new Map()
  const right = new Map()
  before.forEach((item, i) => left.set(keyOf(item, i), item))
  after.forEach((item, i) => right.set(keyOf(item, i), item))
  let added = 0
  let removed = 0
  let changed = 0
  for (const key of right.keys()) if (!left.has(key)) added++
  for (const key of left.keys()) if (!right.has(key)) removed++
  for (const [key, item] of right) {
    if (!left.has(key)) continue
    if (JSON.stringify(left.get(key)) !== JSON.stringify(item)) changed++
  }
  return added + removed + changed
}

// Total differing items per section plus the signed tempo delta (0 when either side has
// no usable tempo). Comparing a version with itself always reports zeroes.
export function diffSummary(a, b) {
  const left = isRecord(a) ? a : {}
  const right = isRecord(b) ? b : {}
  const out = {}
  for (const key of SECTIONS) out[key] = countSection(sectionOf(left, key), sectionOf(right, key))
  const tempoA = Number(left.tempo)
  const tempoB = Number(right.tempo)
  out.tempo = Number.isFinite(tempoA) && Number.isFinite(tempoB) ? tempoB - tempoA : 0
  return out
}

// ---- display ------------------------------------------------------------------

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

function pad(n) {
  return String(n).padStart(2, '0')
}

// 'just now', '32s ago', '5m ago', '3h ago', '2d ago', '1w ago', then 'YYYY-MM-DD'.
// A stamp slightly in the future reads as 'just now'; an unparseable one as 'unknown'.
export function relativeTime(iso, now = Date.now()) {
  if (typeof iso !== 'string') return 'unknown'
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'unknown'
  const base = Number.isFinite(now) ? now : Date.now()
  const delta = base - at
  if (delta < 45 * 1000) return 'just now'
  if (delta < MINUTE) return `${Math.floor(delta / 1000)}s ago`
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < WEEK) return `${Math.floor(delta / DAY)}d ago`
  if (delta < 5 * WEEK) return `${Math.floor(delta / WEEK)}w ago`
  const date = new Date(at)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}
