# Module contract — apollo-studios

Every module below is **pure ESM, dependency-free, and must import and run under plain Node 22**.
Only `js/capture.js` and `js/app.js` may touch browser globals, and only inside functions
(never at import time). Float audio is mono `Float32Array` in [-1, 1] unless stated otherwise.
Sample rate is always passed explicitly — never assume 44100.

Modules are `js/*.js`. Built-in preset data is `presets/builtin.json`.

---

## js/pitch.js  (owner: input node)

```
detectPitch(buf: Float32Array, sampleRate: number): { hz: number, clarity: number }
```
Autocorrelation (ACF) over the buffer. `hz` is 0 when `clarity < 0.5`.
Search range 70..1000 Hz. Normalise so a pure 440 Hz sine at -6 dBFS returns
`hz` within ±3 % of 440 and `clarity > 0.5`; white noise returns low clarity.

```
detectNotes(buf, sampleRate, opts?): Array<{ start: number, dur: number, hz: number, midi: number }>
```
`opts = { frame: 2048, hop: 512, minClarity: 0.5, minDur: 0.06 }`. Frames, detects per
frame, merges consecutive frames whose pitch is within 50 cents into one note.
`start`/`dur` are **seconds**. Drops notes shorter than `minDur`. Returns `[]` for
silence. Output sorted by `start`.

## js/tune.js  (owner: tune node)

```
hzToMidi(hz: number): number        // fractional midi, 69 = A4 = 440
midiToHz(m: number): number
centsBetween(hz: number, midi: number): number   // signed cents, hz relative to midi
SCALES: Record<string, number[]>    // semitone offsets from root, chromatic included
scaleNames(): string[]
nearestInScale(midi: number, root: number, scale: string): number
snapNotes(notes, { root: number, scale: string }): notes   // corrected midi, adds .cents
quantizeStarts(notes, { bpm: number, division: number }): notes  // start -> grid
snapStrength(notes, { root, scale, amount: 0..1 }): notes  // amount 0 = untouched
speedCurve(notes, sampleRate: number, lengthSamples: number): Float32Array
```
`speedCurve` returns per-sample playback multipliers (~1.0) that pull each note to its
snapped midi; gaps are 1.0.

## js/presets.js  (owner: presets node)

Patch shape:
```
{ version: 1, name: string, tune: { root, scale, amount }, master: { eq:[...], comp:{...}, limitDb, targetRmsDb }, vocal: { gainDb, reverbMix } }
```
```
PATCH_VERSION: 1
makePatch(name: string): patch                     // defaults, deep-cloned
validatePatch(o): { ok: boolean, errors: string[] } // version, ranges, unknown keys
mergePatch(base, patch): patch                      // shallow-over key merge, validated
serializePatch(patch): string                       // stable key order JSON
parsePatch(text): { ok, patch } | { ok: false, error }
BUILTIN: patch[]                                    // >= 4 factory patches
```
`parsePatch` never throws. `validatePatch` rejects: wrong version, out-of-range
(amount outside 0..1, more than 8 EQ bands, non-finite numbers), missing `name`.

## js/master.js  (owner: master node)

Stereo is `{ left: Float32Array, right: Float32Array }`, equal length.
```
analyze(stereo): { peakDb: number, rmsDb: number }      // -Infinity when silent
biquadCoeffs(kind: 'highpass'|'lowshelf'|'peaking'|'highshelf'|'lowpass', freq, q, gainDb, sampleRate)
applyEQ(stereo, bands, sampleRate): stereo              // bands: {kind,freq,q,gainDb}[]
compress(stereo, { thresholdDb, ratio, attackMs, releaseMs, makeupDb }, sampleRate): stereo
limit(stereo, ceilingDb): stereo
normalizeRms(stereo, targetDb): { stereo, gainDb }
masterChain(stereo, settings, sampleRate): { stereo, report: { peakDb, rmsDb, gainDb } }
```
`masterChain` order: EQ -> compress -> normalizeRms -> limit. It must clamp output so
peak <= 0 dBFS and report the true post values. Reduces to near-transparent when
settings are neutral.

## js/wav.js  (owner: master node)

```
encodeWav(stereo, sampleRate): Uint8Array   // 16-bit PCM, RIFF/WAVE, byte-exact header
wavHeaderBytes(): number                    // 44
```
Header: "RIFF", size, "WAVE", "fmt ", 16, 1, channels=2, sampleRate, byteRate,
blockAlign=4, bits=16, "data", dataSize. Samples rounded and clipped to int16.

## js/capture.js  (owner: input node, browser-only)

```
isSupported(): boolean
startRecording(): Promise<{ stop(): Promise<Float32Array>, sampleRate: number, cancel(): void }>
```
Mono, via `getUserMedia` + `MediaRecorder` (fallback: `ScriptProcessorNode` accumulation).
`stop()` resolves with the recorded mono Float32Array at the context sample rate.
Throws a readable Error when the mic is denied or unsupported.

## js/app.js  (owner: ui node, browser-only)

Wires the DOM ids in `index.html` to the modules above. Owns project state, playback
(`AudioContext`), and the export flow (`masterChain` -> `encodeWav` -> Blob download).
Exposes `window.VS = { version, state, setState, exportWav, loadDemo }` for the QA harness.

---

## Shared conventions

- No new runtime dependencies. No build step.
- Every exported function returns its data, never mutates its input buffers in place
  unless the name starts with `apply`/`compress`/`limit`/`normalize` (those may return
  new buffers but must not alias the input).
- Numbers stay finite: guard divide-by-zero, return `0` pitch for silence.
- Errors are `Error` objects with a short lowercase message.
