// js/roll.js — piano-roll model for apollo-studios (roll node).
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and in
// the browser.
//
// A roll is a fixed-length grid: { lengthBeats, octaves, lowMidi, highMidi,
// notes, counters }. There is no tempo here — beats are model units and the
// caller multiplies by 60 / bpm when it schedules.
//
// Unlike the note-array helpers elsewhere in the project this is an editor
// model, so the mutators work in place and return the touched note (or a
// boolean): the UI keeps one roll and re-renders from it. Anything that has to
// survive a re-render gets cloned with cloneRoll first.
//
// Invariants every mutator holds:
//   - midi is an integer inside lowMidi..highMidi
//   - start is inside 0..lengthBeats - MIN_DURATION_BEATS
//   - dur is >= MIN_DURATION_BEATS and never crosses the roll end
//   - velocity is an integer 1..127
//   - notes stay sorted by (start, midi, id)
// ids are `${midi}:${n}` with a per-pitch counter, assigned at add time and
// stable across moves so a held selection survives a pitch change.

export const MIN_DURATION_BEATS = 1 / 32

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK = new Set([1, 3, 6, 8, 10])
const MAX_BEATS = 4096

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const mod12 = (n) => ((n % 12) + 12) % 12

function assertRoll(roll) {
  if (!roll || !Array.isArray(roll.notes)) throw new Error('bad roll')
  return roll
}

function clampStart(roll, start) {
  const limit = Math.max(0, roll.lengthBeats - MIN_DURATION_BEATS)
  return clamp(Number.isFinite(start) ? start : 0, 0, limit)
}

function clampDur(roll, start, dur) {
  const room = Math.max(MIN_DURATION_BEATS, roll.lengthBeats - start)
  return clamp(Number.isFinite(dur) ? dur : MIN_DURATION_BEATS, MIN_DURATION_BEATS, room)
}

function clampMidi(roll, midi) {
  return clamp(Math.round(midi), roll.lowMidi, roll.highMidi)
}

function sortNotes(roll) {
  roll.notes.sort((a, b) => a.start - b.start || a.midi - b.midi || a.seq - b.seq)
  return roll
}

function find(roll, id) {
  return roll.notes.find((n) => n.id === id) ?? null
}

// Empty roll. lengthBeats and octaves are clamped to sane bounds; lowMidi is
// pushed down so the top row never passes 127.
export function createRoll(lengthBeats = 32, octaves = 4, lowMidi = 48) {
  const length = clamp(Number.isFinite(lengthBeats) && lengthBeats > 0 ? lengthBeats : 32, MIN_DURATION_BEATS, MAX_BEATS)
  const rows = clamp(Number.isFinite(octaves) ? Math.trunc(octaves) : 4, 1, 10)
  const low = clamp(Math.round(Number.isFinite(lowMidi) ? lowMidi : 48), 0, 127 - rows * 12 + 1)
  return {
    lengthBeats: length,
    octaves: rows,
    lowMidi: low,
    highMidi: low + rows * 12 - 1,
    notes: [],
    counters: {},
  }
}

export function cloneRoll(roll) {
  assertRoll(roll)
  return {
    ...roll,
    notes: roll.notes.map((n) => ({ ...n })),
    counters: { ...roll.counters },
  }
}

// Adds a note and returns it. Missing fields fall back to a quarter-beat note at
// beat 0; every field is clamped to the roll.
export function addNote(roll, note = {}) {
  assertRoll(roll)
  if (!Number.isFinite(note.midi)) throw new Error('bad midi')
  const midi = clampMidi(roll, note.midi)
  const start = clampStart(roll, note.start)
  const dur = clampDur(roll, start, note.dur ?? 0.5)
  const velocity = clamp(Math.round(Number.isFinite(note.velocity) ? note.velocity : 100), 1, 127)
  const seq = (roll.counters[midi] ?? 0) + 1
  roll.counters[midi] = seq
  const added = { id: `${midi}:${seq}`, midi, start, dur, velocity, seq }
  roll.notes.push(added)
  sortNotes(roll)
  return added
}

// Moves a note to a new start and/or pitch. The id is kept. Returns the note, or
// null for an unknown id.
export function moveNote(roll, id, start, midi) {
  assertRoll(roll)
  const note = find(roll, id)
  if (!note) return null
  if (Number.isFinite(midi)) note.midi = clampMidi(roll, midi)
  note.start = clampStart(roll, start)
  note.dur = clampDur(roll, note.start, note.dur)
  sortNotes(roll)
  return note
}

export function resizeNote(roll, id, dur) {
  assertRoll(roll)
  const note = find(roll, id)
  if (!note) return null
  note.dur = clampDur(roll, note.start, dur)
  return note
}

export function deleteNote(roll, id) {
  assertRoll(roll)
  const index = roll.notes.findIndex((n) => n.id === id)
  if (index === -1) return false
  roll.notes.splice(index, 1)
  return true
}

export function setVelocity(roll, id, velocity) {
  assertRoll(roll)
  const note = find(roll, id)
  if (!note) return null
  note.velocity = clamp(Math.round(Number.isFinite(velocity) ? velocity : 100), 1, 127)
  return note
}

// Pulls every start toward the nearest grid line by `strength` (0 = untouched,
// 1 = fully quantised). Durations are re-clamped to the roll end.
export function quantize(roll, gridBeats = 0.25, strength = 1) {
  assertRoll(roll)
  if (!Number.isFinite(gridBeats) || gridBeats <= 0) throw new Error('bad grid')
  const amount = clamp(Number.isFinite(strength) ? strength : 1, 0, 1)
  for (const note of roll.notes) {
    const target = Math.round(note.start / gridBeats) * gridBeats
    note.start = clampStart(roll, note.start + (target - note.start) * amount)
    note.dur = clampDur(roll, note.start, note.dur)
  }
  return sortNotes(roll)
}

// Nudges starts and velocities so a quantized part stops sounding stamped on.
// `amount` is the half-range: start moves by ±amount beats, velocity by
// ±amount*VELOCITY_RANGE. `rand` is injectable for a deterministic test.
export const VELOCITY_RANGE = 120

export function humanize(roll, amount = 0.06, rand = Math.random) {
  assertRoll(roll)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('bad amount')
  for (const note of roll.notes) {
    const shift = (rand() * 2 - 1) * amount
    note.start = clampStart(roll, note.start + shift)
    note.velocity = clamp(Math.round(note.velocity + (rand() * 2 - 1) * amount * VELOCITY_RANGE), 1, 127)
    note.dur = clampDur(roll, note.start, note.dur)
  }
  return sortNotes(roll)
}

// Snaps every out-of-scale pitch to the nearest pitch class in `scalePitches`
// (offsets from `rootPitch`, mod 12). Ties resolve downward. Returns the roll.
export function lockToScale(roll, scalePitches, rootPitch = 0) {
  assertRoll(roll)
  if (!Array.isArray(scalePitches) || scalePitches.length === 0) throw new Error('bad scale')
  const root = Number.isFinite(rootPitch) ? rootPitch : 0
  const classes = new Set(scalePitches.filter(Number.isFinite).map((p) => mod12(Math.round(p) + root)))
  if (classes.size === 0) throw new Error('bad scale')
  for (const note of roll.notes) {
    if (classes.has(mod12(note.midi))) continue
    for (let d = 1; d <= 6; d++) {
      if (classes.has(mod12(note.midi - d))) { note.midi = clampMidi(roll, note.midi - d); break }
      if (classes.has(mod12(note.midi + d))) { note.midi = clampMidi(roll, note.midi + d); break }
    }
  }
  return sortNotes(roll)
}

// Notes sounding anywhere inside [fromBeat, toBeat).
export function notesInRange(roll, fromBeat, toBeat) {
  assertRoll(roll)
  const from = Number.isFinite(fromBeat) ? fromBeat : 0
  const to = Number.isFinite(toBeat) ? toBeat : roll.lengthBeats
  if (to <= from) return []
  return roll.notes.filter((n) => n.start < to && n.start + n.dur > from)
}

// One row per pitch, top first: { midi, name, isBlackKey }.
export function rowLabels(roll) {
  assertRoll(roll)
  const rows = []
  for (let midi = roll.highMidi; midi >= roll.lowMidi; midi--) {
    rows.push({ midi, name: `${NAMES[mod12(midi)]}${Math.floor(midi / 12) - 1}`, isBlackKey: BLACK.has(mod12(midi)) })
  }
  return rows
}

// Trims each note so it ends where the next note on the same pitch begins.
// Fully-covered notes keep the 1/32-beat floor. Returns the roll.
export function overlapTrim(roll) {
  assertRoll(roll)
  const byMidi = new Map()
  for (const note of roll.notes) {
    const lane = byMidi.get(note.midi)
    if (lane) lane.push(note)
    else byMidi.set(note.midi, [note])
  }
  for (const lane of byMidi.values()) {
    lane.sort((a, b) => a.start - b.start || a.seq - b.seq)
    for (let i = 0; i < lane.length - 1; i++) {
      const note = lane[i]
      const next = lane[i + 1]
      if (note.start + note.dur > next.start) note.dur = clampDur(roll, note.start, next.start - note.start)
    }
  }
  return sortNotes(roll)
}
