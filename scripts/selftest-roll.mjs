// scripts/selftest-roll.mjs — self-test for js/roll.js.
// Run from the project root:  node scripts/selftest-roll.mjs
import {
  MIN_DURATION_BEATS,
  createRoll,
  cloneRoll,
  addNote,
  moveNote,
  resizeNote,
  deleteNote,
  setVelocity,
  quantize,
  humanize,
  lockToScale,
  notesInRange,
  rowLabels,
  overlapTrim,
} from '../js/roll.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

const MIN = MIN_DURATION_BEATS

const roll = () => createRoll(16, 4, 48)

test('MIN_DURATION_BEATS is 1/32', () => {
  eq(MIN, 1 / 32)
  near(MIN, 0.03125, 1e-12)
})

test('createRoll defaults: 32 beats, 4 octaves, low midi 48', () => {
  const r = createRoll()
  eq(r.lengthBeats, 32)
  eq(r.octaves, 4)
  eq(r.lowMidi, 48)
  eq(r.highMidi, 95)
  eq(r.notes.length, 0)
  ok(Array.isArray(r.notes))
  ok(r.counters && typeof r.counters === 'object')
})

test('createRoll keeps a custom window', () => {
  const r = createRoll(8, 2, 60)
  eq(r.lengthBeats, 8)
  eq(r.octaves, 2)
  eq(r.lowMidi, 60)
  eq(r.highMidi, 83)
})

test('createRoll clamps length, octaves and low midi', () => {
  eq(createRoll(0).lengthBeats, 32, 'zero length falls back to 32')
  eq(createRoll(-4).lengthBeats, 32)
  eq(createRoll(Number.NaN).lengthBeats, 32)
  eq(createRoll(1e9).lengthBeats, 4096)
  eq(createRoll(16, 0).octaves, 1)
  eq(createRoll(16, 99).octaves, 10)
  eq(createRoll(16, 4, -20).lowMidi, 0)
  eq(createRoll(16, 4, 500).lowMidi, 127 - 48 + 1, 'top row stays at 127')
  eq(createRoll(16, 1, 500).highMidi, 127)
})

test('rowLabels: one row per pitch, highest first, named with octave', () => {
  const rows = rowLabels(createRoll(4, 1, 60))
  eq(rows.length, 12)
  eq(rows[0].midi, 71)
  eq(rows[11].midi, 60)
  eq(rows[0].name, 'B4')
  eq(rows[11].name, 'C4')
  for (let i = 1; i < rows.length; i++) ok(rows[i].midi < rows[i - 1].midi, 'descending')
})

test('rowLabels flags exactly the black keys', () => {
  const rows = rowLabels(createRoll(4, 1, 60))
  const black = rows.filter((r) => r.isBlackKey).map((r) => r.name)
  eq(black.join(','), 'A#4,G#4,F#4,D#4,C#4')
  eq(rows.find((r) => r.name === 'C4').isBlackKey, false)
  eq(rows.find((r) => r.name === 'E4').isBlackKey, false)
})

test('rowLabels names stay correct across octaves', () => {
  const rows = rowLabels(createRoll(4, 2, 48))
  eq(rows.find((r) => r.midi === 48).name, 'C3')
  eq(rows.find((r) => r.midi === 60).name, 'C4')
  eq(rows.find((r) => r.midi === 71).name, 'B4')
})

test('addNote stores the note and returns it', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 1, dur: 0.5, velocity: 90 })
  eq(r.notes.length, 1)
  eq(r.notes[0], note)
  eq(note.midi, 60)
  eq(note.start, 1)
  eq(note.dur, 0.5)
  eq(note.velocity, 90)
  eq(note.id, '60:1')
  ok(Number.isInteger(note.seq))
})

test('addNote ids are per-pitch counters', () => {
  const r = roll()
  eq(addNote(r, { midi: 60, start: 0 }).id, '60:1')
  eq(addNote(r, { midi: 60, start: 1 }).id, '60:2')
  eq(addNote(r, { midi: 62, start: 2 }).id, '62:1')
  eq(addNote(r, { midi: 60, start: 3 }).id, '60:3')
})

test('addNote defaults: quarter-beat at 0, velocity 100, midi required', () => {
  const r = roll()
  const note = addNote(r, { midi: 64 })
  eq(note.start, 0)
  eq(note.dur, 0.5)
  eq(note.velocity, 100)
  throws(() => addNote(r, {}), 'missing midi')
  throws(() => addNote(r, { midi: Number.NaN }), 'NaN midi')
})

test('addNote clamps midi into the roll window', () => {
  const r = createRoll(8, 2, 60)
  eq(addNote(r, { midi: 20 }).midi, 60)
  eq(addNote(r, { midi: 120 }).midi, 83)
  eq(addNote(r, { midi: 60.4 }).midi, 60, 'rounds')
  eq(addNote(r, { midi: 60.6 }).midi, 61)
})

test('addNote clamps start and duration to the roll', () => {
  const r = roll()
  eq(addNote(r, { midi: 60, start: -3 }).start, 0)
  eq(addNote(r, { midi: 60, start: 99 }).start, 16 - MIN)
  const tail = addNote(r, { midi: 60, start: 15.5, dur: 8 })
  near(tail.dur, 0.5, 1e-12, 'duration stops at the roll end')
  eq(addNote(r, { midi: 60, start: 0, dur: 0 }).dur, MIN)
  eq(addNote(r, { midi: 60, start: 0, dur: -2 }).dur, MIN)
  eq(addNote(r, { midi: 60, start: 0, dur: Number.NaN }).dur, MIN)
  eq(addNote(r, { midi: 60, start: Number.NaN }).start, 0)
})

test('addNote clamps velocity into 1..127', () => {
  const r = roll()
  eq(addNote(r, { midi: 60, velocity: 0 }).velocity, 1)
  eq(addNote(r, { midi: 60, velocity: 300 }).velocity, 127)
  eq(addNote(r, { midi: 60, velocity: 64.4 }).velocity, 64)
})

test('addNote keeps notes sorted by start, then midi', () => {
  const r = roll()
  addNote(r, { midi: 64, start: 2 })
  addNote(r, { midi: 60, start: 0 })
  addNote(r, { midi: 62, start: 0 })
  eq(r.notes.map((n) => n.start).join(','), '0,0,2')
  eq(r.notes[0].midi, 60)
  eq(r.notes[1].midi, 62)
})

test('moveNote updates start and pitch, keeps id, duration and order', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 0, dur: 1 })
  const moved = moveNote(r, note.id, 4, 62)
  eq(moved, note)
  eq(note.start, 4)
  eq(note.midi, 62)
  eq(note.dur, 1, 'duration survives the move')
  eq(note.id, '60:1', 'id is stable across a pitch change')
})

test('moveNote clamps pitch and start', () => {
  const r = createRoll(8, 2, 60)
  const note = addNote(r, { midi: 60, start: 2, dur: 1 })
  moveNote(r, note.id, -5, 10)
  eq(note.midi, 60)
  eq(note.start, 0)
  moveNote(r, note.id, 500, 999)
  eq(note.midi, 83)
  eq(note.start, 8 - MIN)
  near(note.dur, MIN, 1e-12, 'duration re-clamped at the end')
})

test('moveNote re-sorts after a move', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 0 })
  const b = addNote(r, { midi: 62, start: 1 })
  moveNote(r, a.id, 5)
  eq(r.notes[0], b)
  eq(r.notes[1], a)
})

test('moveNote returns null for an unknown id', () => {
  eq(moveNote(roll(), 'nope:1', 0, 60), null)
})

test('resizeNote sets duration and clamps it', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 2, dur: 1 })
  eq(resizeNote(r, note.id, 3).dur, 3)
  eq(resizeNote(r, note.id, 0).dur, MIN)
  eq(resizeNote(r, note.id, -1).dur, MIN)
  near(resizeNote(r, note.id, 99).dur, 14, 1e-12, 'stops at the roll end')
  eq(resizeNote(r, 'nope:1', 1), null)
})

test('deleteNote removes a note and reports success', () => {
  const r = roll()
  const note = addNote(r, { midi: 60 })
  eq(deleteNote(r, note.id), true)
  eq(r.notes.length, 0)
  eq(deleteNote(r, note.id), false)
  eq(deleteNote(r, 'nope:1'), false)
})

test('a deleted pitch keeps counting from where it left off', () => {
  const r = roll()
  const first = addNote(r, { midi: 60 })
  deleteNote(r, first.id)
  eq(addNote(r, { midi: 60 }).id, '60:2')
})

test('setVelocity clamps into 1..127 and rounds', () => {
  const r = roll()
  const note = addNote(r, { midi: 60 })
  eq(setVelocity(r, note.id, 1).velocity, 1)
  eq(setVelocity(r, note.id, 0).velocity, 1)
  eq(setVelocity(r, note.id, 999).velocity, 127)
  eq(setVelocity(r, note.id, 90.6).velocity, 91)
  eq(setVelocity(r, 'nope:1', 20), null)
})

test('quantize strength 1 snaps every start to the grid', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 0.13, dur: 0.2 })
  quantize(r, 0.25, 1)
  near(note.start, 0.25, 1e-12)
  near(note.dur, 0.2, 1e-12)
})

test('quantize strength 0 is the identity', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 0.13, dur: 0.2 })
  quantize(r, 0.25, 0)
  near(note.start, 0.13, 1e-12)
})

test('quantize strength 0.5 moves halfway to the grid', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 0.13, dur: 0.2 })
  quantize(r, 0.25, 0.5)
  near(note.start, 0.19, 1e-12)
  eq(quantize(r, 0.25).notes.length ?? r.notes.length, 1)
})

test('quantize defaults to a 16th grid at full strength', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 0.13 })
  quantize(r)
  near(note.start, 0.25, 1e-12)
})

test('quantize clamps a snapped start into the roll', () => {
  const r = createRoll(4, 2, 48)
  const note = addNote(r, { midi: 60, start: 3.99, dur: 0.005 })
  quantize(r, 1, 1)
  eq(note.start, 4 - MIN)
  ok(note.start + note.dur <= 4 + 1e-12)
})

test('quantize rejects a bad grid', () => {
  throws(() => quantize(roll(), 0), 'zero grid')
  throws(() => quantize(roll(), -1), 'negative grid')
  throws(() => quantize(roll(), Number.NaN), 'NaN grid')
})

test('quantize returns the roll', () => {
  const r = roll()
  eq(quantize(r), r)
})

test('lockToScale snaps every out-of-key pitch to C major', () => {
  const r = roll()
  const note = addNote(r, { midi: 61 })
  lockToScale(r, [0, 2, 4, 5, 7, 9, 11], 60)
  eq(note.midi, 60, 'C# pulls down to C on a tie')
})

test('lockToScale leaves in-key notes alone', () => {
  const r = roll()
  const notes = [60, 62, 64, 65, 67, 69, 71].map((m) => addNote(r, { midi: m }))
  lockToScale(r, [0, 2, 4, 5, 7, 9, 11], 60)
  eq(notes.map((n) => n.midi).join(','), '60,62,64,65,67,69,71')
})

test('lockToScale moves sharp and flat notes to the nearest degree', () => {
  const r = roll()
  const sharp = addNote(r, { midi: 66 })
  const flat = addNote(r, { midi: 63 })
  lockToScale(r, [0, 2, 4, 5, 7, 9, 11], 60)
  eq(sharp.midi, 65)
  eq(flat.midi, 62)
})

test('lockToScale honours the root', () => {
  const r = roll()
  const note = addNote(r, { midi: 63 })
  lockToScale(r, [0, 2, 4, 5, 7, 9, 11], 62)
  eq(note.midi, 62, 'D# falls to the root D')
})

test('lockToScale with a chromatic set changes nothing', () => {
  const r = roll()
  const note = addNote(r, { midi: 61 })
  lockToScale(r, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 60)
  eq(note.midi, 61)
})

test('lockToScale clamps a snap into the roll window', () => {
  const r = createRoll(4, 1, 60)
  const note = addNote(r, { midi: 60 })
  lockToScale(r, [1], 60)
  eq(note.midi, 61)
})

test('lockToScale rejects an empty scale', () => {
  throws(() => lockToScale(roll(), []), 'empty scale')
  throws(() => lockToScale(roll(), null), 'null scale')
})

test('notesInRange selects by overlap, not by start', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 4, dur: 2 })
  const b = addNote(r, { midi: 62, start: 8, dur: 1 })
  eq(notesInRange(r, 5, 6).length, 1)
  eq(notesInRange(r, 5, 6)[0], a)
  eq(notesInRange(r, 3.9, 4.1).length, 1, 'touching the head counts')
  eq(notesInRange(r, 9.5, 10).length, 0)
  eq(notesInRange(r, 8, 9).length, 1)
  eq(notesInRange(r, 8, 9)[0], b)
})

test('notesInRange is half-open at the end', () => {
  const r = roll()
  addNote(r, { midi: 60, start: 0, dur: 1 })
  eq(notesInRange(r, 1, 2).length, 0, 'a note ending at 1 is not in [1, 2)')
  eq(notesInRange(r, 0, 1).length, 1)
})

test('notesInRange handles empty and inverted windows', () => {
  const r = roll()
  addNote(r, { midi: 60, start: 0, dur: 1 })
  eq(notesInRange(r, 2, 2).length, 0)
  eq(notesInRange(r, 5, 1).length, 0)
  eq(notesInRange(r, Number.NaN, Number.NaN).length, 1, 'NaN window covers the roll')
})

test('overlapTrim cuts a note where the next same-pitch note starts', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 0, dur: 2 })
  addNote(r, { midi: 60, start: 1, dur: 1 })
  overlapTrim(r)
  eq(a.dur, 1)
})

test('overlapTrim leaves different pitches alone', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 0, dur: 2 })
  addNote(r, { midi: 62, start: 1, dur: 1 })
  overlapTrim(r)
  eq(a.dur, 2)
})

test('overlapTrim keeps the 1/32 floor for stacked duplicates', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 0, dur: 2 })
  addNote(r, { midi: 60, start: 0, dur: 1 })
  overlapTrim(r)
  eq(a.dur, MIN)
})

test('overlapTrim trims every note in a three-deep pile', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 0, dur: 4 })
  const b = addNote(r, { midi: 60, start: 1, dur: 2 })
  const c = addNote(r, { midi: 60, start: 2, dur: 1 })
  overlapTrim(r)
  eq(a.dur, 1)
  eq(b.dur, 1)
  eq(c.dur, 1)
})

test('overlapTrim leaves already-clean lanes untouched', () => {
  const r = roll()
  const a = addNote(r, { midi: 60, start: 0, dur: 0.5 })
  const b = addNote(r, { midi: 60, start: 0.5, dur: 0.5 })
  overlapTrim(r)
  eq(a.dur, 0.5)
  eq(b.dur, 0.5)
})

test('overlapTrim returns the roll and stays sorted', () => {
  const r = roll()
  addNote(r, { midi: 60, start: 0, dur: 2 })
  addNote(r, { midi: 60, start: 1, dur: 2 })
  eq(overlapTrim(r), r)
  ok(r.notes[0].start <= r.notes[1].start)
})

test('cloneRoll is deep and independent', () => {
  const r = roll()
  const note = addNote(r, { midi: 60, start: 1, dur: 1 })
  const copy = cloneRoll(r)
  eq(copy.lengthBeats, r.lengthBeats)
  eq(copy.lowMidi, r.lowMidi)
  eq(copy.notes.length, 1)
  eq(copy.notes[0].id, note.id)
  ok(copy.notes[0] !== note)
  ok(copy.notes !== r.notes)
  moveNote(copy, note.id, 5, 64)
  eq(note.start, 1, 'moving the copy does not touch the source')
  eq(note.midi, 60)
  ok(copy.counters !== r.counters)
})

test('cloneRoll keeps id sequencing independent', () => {
  const r = roll()
  addNote(r, { midi: 60 })
  const copy = cloneRoll(r)
  eq(addNote(copy, { midi: 60 }).id, '60:2')
  eq(addNote(r, { midi: 60 }).id, '60:2')
})

test('mutators reject a garbage roll', () => {
  throws(() => addNote({}, { midi: 60 }), 'not a roll')
  throws(() => quantize(null), 'null roll')
  throws(() => notesInRange({ notes: 'nope' }, 0, 1))
})

test('empty roll round-trips through every read helper', () => {
  const r = roll()
  eq(notesInRange(r, 0, 16).length, 0)
  eq(rowLabels(r).length, 48)
  eq(overlapTrim(r).notes.length, 0)
  eq(quantize(r).notes.length, 0)
  eq(lockToScale(r, [0], 0).notes.length, 0)
})

test('a busy roll stays sorted and inside the window', () => {
  const r = createRoll(8, 3, 50)
  for (let i = 0; i < 40; i++) addNote(r, { midi: 40 + i * 2, start: i * 0.3, dur: 0.1 + (i % 5) })
  for (let i = 1; i < r.notes.length; i++) ok(r.notes[i].start >= r.notes[i - 1].start, 'sorted')
  ok(r.notes.every((n) => n.midi >= r.lowMidi && n.midi <= r.highMidi), 'pitches inside')
  ok(r.notes.every((n) => n.start >= 0 && n.start + n.dur <= r.lengthBeats + 1e-12), 'inside the roll')
})


test('humanize moves starts and velocities within its range', () => {
  const r = createRoll({ lengthBeats: 8 })
  addNote(r, { midi: 60, start: 1, dur: 1, velocity: 100 })
  addNote(r, { midi: 62, start: 2, dur: 1, velocity: 100 })
  // a fixed generator that alternates high and low draws
  let n = 0
  const rand = () => ((n++ * 2) % 5) / 4
  humanize(r, 0.1, rand)
  for (const note of r.notes) {
    ok(Math.abs(note.start - Math.round(note.start / 0.5) * 0.5) <= 0.6, 'starts stay near where they were')
    ok(note.start >= 0, 'starts stay inside the roll')
    ok(note.velocity >= 1 && note.velocity <= 127, 'velocities stay legal')
  }
  ok(r.notes.some((note) => Math.abs(note.start - 1) > 1e-9 || Math.abs(note.start - 2) > 1e-9), 'something moved')
  ok(new Set(r.notes.map((n2) => n2.velocity)).size > 1, 'and velocities differ')
})

test('humanize is bounded and rejects a bad amount', () => {
  const r = createRoll({ lengthBeats: 4 })
  addNote(r, { midi: 60, start: 2, dur: 1 })
  const before = r.notes[0].velocity
  humanize(r, 0.02, () => 0.999999)
  ok(Math.abs(r.notes[0].start - 2) <= 0.021, 'a small amount barely moves the note')
  ok(Math.abs(r.notes[0].velocity - before) <= 3, 'and barely touches velocity')
  throws(() => humanize(r, 0), 'zero amount throws')
})

report()
