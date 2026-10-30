# Undertow

Sing it. Shape it. Ship it.

Undertow is an open-source, local-only vocal studio that runs entirely in a browser tab. Sing a
phrase, get editable notes back, tune them to a key, stack harmonies, shape a master, export a WAV.
No account, no upload, no build step, no dependencies, and no backend beyond a static folder on
loopback.

```
node scripts/serve.mjs      # http://127.0.0.1:4173 — landing page, studio at /app.html
node scripts/test.mjs       # full verification, exit 0 = pass
```

The studio's "Load demo" button synthesizes a take, so everything works with no microphone.

## Site

- `index.html` + `styles-landing.css` — public landing page
- `app.html` — the studio itself
- `docs/` — getting started, features, architecture, FAQ

## What it does

Twelve tools, each a pure module with a Node self-test:

| Module | Job |
| --- | --- |
| `js/pitch.js` | Normalized-autocorrelation pitch tracking, 50-cent note merging |
| `js/tune.js` | 12-TET maths, scales, strength-weighted snap, grid quantize, speed curve |
| `js/harmony.js` | Interval presets, transposition, stacked parts |
| `js/voicechar.js` | Resample, treble tilt, soft drive, breath |
| `js/stems.js` | Frame-median harmonic/percussive split, exact recombination |
| `js/beat.js` | Genre tables, synthesized kick/snare/hat |
| `js/compose.js` | Seeded melody walk and chord stacking |
| `js/automix.js` | Genre-derived master suggestion, level balancing |
| `js/master.js` | RBJ biquads, EQ, compressor, loudness target, limiter, true metering |
| `js/wav.js` | 16-bit RIFF encode |
| `js/presets.js` + `presets/builtin.json` | Versioned patch format, validation, six factory patches |
| `js/capture.js` | Mono microphone capture |

`js/app.js` is the only DOM layer. Everything above is pure, imports under bare Node, and never
touches a browser global at import time. `js/contract.md` and `js/contract-appendix.md` are the
interfaces the modules were built against, parameter ranges included.

## What is original

Everything in `js/` was written for this project. BandLab's shipped studio was studied as a product
(notes in `docs/bandlab-rea-notes.md`), never copied: no BandLab code, preset data, names or assets
are in the tree. The audio maths are textbook — autocorrelation pitch tracking and RBJ biquads are
published, and the master chain is ordinary EQ, compression and limiting rather than anything
reverse engineered.

Undertow is independent and not affiliated with BandLab, Ableton or any other DAW vendor.

## Verify

```
node scripts/test.mjs
```

Exit 0 only when all four module self-tests pass, the synthetic phrase becomes four correct notes,
snapping stays in key without mutating its input, presets round-trip and reject malformed files,
the master chain stays under 0 dBFS, the WAV header is byte-exact, and the site serves. `npm test`
runs the same thing. CI runs it on Node 22 across the whole `js/` tree with `node --check` first.

## Known gaps

- Live microphone capture is not exercised by the test; the CI path uses the synthetic take.
- Playback is not asserted, only export bytes.
- 24-bit is offered in the UI but the encoder writes 16-bit.
- Preset import reads this project's JSON, not a BandLab export.
- The stem split is a median filter, not a model. It is crude on dense mixes, by design.
- Mono only until the master stage; no undo, no MIDI import, no regions.

## Licence

MIT. See `LICENSE`. The audio you render is yours.
