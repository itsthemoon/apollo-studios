# Not affiliated with BandLab

Apollo Studios is an independent project. It is **not affiliated with, endorsed by, or derived from the
source code of BandLab**, Cakewalk, Soundtrap or any other DAW vendor.

## What "original" means here

Every file in `js/`, `index.html`, `app.html` and `styles.css` was written for this project. Nothing
was copied in, and no third-party code, preset data, sample audio, icon set or stylesheet is
vendored.

BandLab was studied the way any shipped product can be studied — by using it and observing how it
behaves. `docs/bandlab-rea-notes.md` records the observations: what the controls do, what order the
studio presents them in, and which behaviours are worth having. That file is notes about a product,
not a transcription of its implementation. Everything was then reimplemented from the observed
behaviour against this project's own `js/contract.md`.

## The maths is textbook, not reverse engineered

The DSP is standard published material, so similarity to other tools is expected and not evidence of
copying:

- pitch tracking by normalised autocorrelation with parabolic peak refinement
- RBJ audio-EQ-cookbook biquads for every EQ band
- an ordinary compressor, RMS loudness targeting and a lookahead-free limiter
- 12-TET / MIDI note maths and equal-tempered playback rates

Any competent implementation of these lands on similar shape. The choice of constants, the module
boundaries and the patch format are this project's own.

## Their endpoints are theirs to change

Apollo Studios calls no remote API. There is no account, no sync, no cloud render and no analytics, so the
app cannot break when someone else ships. That is a deliberate property, not an accident: the whole
signal path — capture, detect, tune, master, encode — runs in the tab and the WAV is written by
`Blob` from memory.

Where a comparison to another product is made in the notes or README, treat it as a description of
observed behaviour at the time of writing. Those products can change their UI, their preset format or
their rendering at any point, and this project makes no promise to track them. Preset import reads
Apollo Studios's own JSON (`js/presets.js`), not a BandLab export.

## Names and marks

"BandLab", "Cakewalk" and "Soundtrap" are the property of their respective owners and are used here
only to describe what was compared. "Apollo Studios" is this project's name.
