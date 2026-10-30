# Contract appendix — premium-parity modules

Same rules as the main contract: pure ESM, dependency-free, must import under plain Node 22.
Browser globals only inside `js/capture.js` and `js/app.js`. All of these are pure functions over
`Float32Array` or note arrays, sample rate always explicit.

"Notes" are `{ start, dur, hz, midi }` seconds, monotonic by `start`.

## js/harmony.js

```
HARMONY_PRESETS: Array<{ name: string, intervals: number[], gainDb: number, spreadMs: number }>
```
At least 4 presets (thirds, fifths, octave-down, wide stack). `intervals` are semitone offsets, each
within -12..+12, at most 3 entries.

```
shiftNotes(notes, semitones): notes        // new objects, midi/hz moved, never mutates
buildHarmonies(notes, presetName): Array<{ label: string, notes: notes, gainDb: number, spreadMs: number }>
```
One entry per interval. Throws `unknown harmony preset` for a bad name.

## js/voicechar.js

```
CHARACTERS: Array<{ name: string, pitchSemis: number, tiltDb: number, driveDb: number, breathMix: number }>
applyCharacter(take, characterName, sampleRate): Float32Array
```
Character = resample by `pitchSemis` (2 ** (s/12)), tilt via one-treble shelf, soft drive (`tanh`
scaled), and mixed-in noise at `breathMix`. Output length ~ input / ratio. Throws `unknown character`.

## js/stems.js

```
splitStems(take, sampleRate): { leads: Float32Array, bed: Float32Array }
recombine(stems): Float32Array
```
Frame-based median split (2048 / 512 hop): harmonic estimate = per-bin median across neighbouring
frames, percussive = residual. Return new buffers of the input length. `recombine` must sum back to
within 1e-3 of the input. Documented as a crude split, not a model.

## js/beat.js

```
GENRES: Array<{ name: string, bpm: number, swing: number, voices: { kick: object, snare: object, hat: object } }>
renderBeat(genreName, bars, sampleRate): Float32Array
```
Synthesized drums: pitch-swept sine kick, noise burst snare with a body tone, highpassed noise hat.
Deterministic. Length = bars * 4 beats at the genre bpm. At least 4 genres (boom bap, trap, drill,
house). Throws `unknown genre`.

## js/compose.js

```
mulberry32(seed): () => number
generateMelody({ root, scale, steps, bpm, seed, octave }): notes
generateChords({ root, scale, bars, bpm, seed }): Array<{ start: number, dur: number, midis: number[] }>
```
Seeded and fully deterministic (same seed = same output). Melody degrees walk by ±1..2 scale steps and
stay within the key. Chords are triads stacked from scale degrees, one per bar.

## js/automix.js

```
suggestFromGenre(genreName): { eq: band[], comp: object, targetRmsDb: number }
balance(levels): number[]        // dB trims that bring N track levels to a common target
INSTRUMENTS: Array<{ name: string, wave: 'saw'|'sine'|'square', attack: number, release: number }>
renderNote(instrumentName, hz, dur, sampleRate): Float32Array
```
`suggestFromGenre` returns a partial master setting derived from the genre's brightness and density.
`balance` returns per-track trims in dB, each clamped to -24..+12 and never boosting the loudest track.

## Wiring

`js/app.js` gains: harmony buttons, character select, stems split/recombine, beat generator (genre +
bars), melody and chord generators, automix suggest/balance, instrument preview. `app.html` gains the
matching controls. Nothing above may import from `js/app.js`.
