# Reverse-engineering notes — BandLab premium web (real pass)

Method: live authenticated studio session in Jackson's own Chrome over the local CDP port, REA bundle
analysis, then direct reads of the shipped engine. Traffic was same-origin from the normal browser
profile; nothing of theirs was executed by an automated client.

Evidence, in capture order:

- `~/.hermes/cache/scratch/re-bandlab/ev1.json` — feed page, 23 route candidates, service map
- `~/.hermes/cache/scratch/re-bandlab/ev2.json` — studio shell, 445 scripts analysed
- `~/.hermes/cache/scratch/re-bandlab/ev3.json` — studio with a live Voice/Audio track
- `/tmp/ball/*.js` — all 247 studio chunks, downloaded for local search
- `/tmp/engine.wasm` (9,913,030 bytes) and `/tmp/engine.js` (294,870 bytes) — the audio engine

## Architecture (established)

The studio engine is **AudioWorklet + WebAssembly**, not Web Audio nodes:

- `https://www.bandlab.com/web-app/common/workers/libaudioengine-f72bb152d0.wasm` — SIMD build
- `libaudioengine_no_simd-462cf44897.wasm` — fallback, chosen by a feature test
- `libaudioengine-81aae6c072.js` — worklet wrapper, posted through `audioWorklet.addModule`
- UI is AngularJS (`angular.module('bandlab.audio')`); the effect layer is fronted by a `Katnip`
  factory and an `effectMetadataManager`

The DSP is C++ compiled to wasm, so there is no readable effect code in the web app. Effect and preset
metadata are constructed inside the wasm and marshalled back over the worklet port
(`FloatParamMetadataToJS`, `EnumParamMetadataToJS`, `BoolParamMetadataToJS`, `PresetMetadataToJS`).

An earlier run against the empty shell found none of this; the engine only loads once a track exists.

## Parameter model (established, from the worklet wrapper)

Every effect parameter carries `slug, name, visible, automatable, defaultVal, minVal, maxVal, scale,
unit, step, displayMin, displayMax, displayUnit, desc, floatType`, with `choices` for enums.

Preset metadata carries `slug, name, desc, isMembershipOnly, picture, packs, effectChain, isNew`.

Two invariants are asserted in the wasm itself:

- `"masteringLimiter" == effectChainData.back().slug` — the mastering limiter must be last in a chain
- chain length is capped at runtime by `getMaxEffectsPerChain()`, and the caller derives
  `getMaxEffectsPerChainWithoutMembership = max / 2` — free accounts get half the effect slots

## Mastering (established, from the mastering chunk)

The client's whole mastering state is:

```js
mastering: { preset, intensity, inputGain, lowFreqGain, midFreqGain, highFreqGain, eqBypass, bypass }
```

- `preset` is a slug; `intensity` and `inputGain` are floats; the EQ is **three fixed bands**
  (low / mid / high) sharing a single `eqBypass` — not a parametric EQ.
- The work is a remote job: `POST https://mastering.bandlab.cloud/v1/task`, polled.
  `makeMasteringData` packages `{ preset, intensity, version, inputGain, bypass, lowFreqGain,
  midFreqGain, highFreqGain, eqBypass }` with a client version stamp.
- Bounce analytics record `mastering_preset`, `intensity`, `input_gain_db` and the `eq_*` values, which
  confirms those are the only things a user actually sets.

## AutoPitch (established, from the live UI)

A per-track insert opened from the track inspector. Free presets **Classic, Duet, Big Harmony**;
membership-locked **Natural, Third, Chip**. Controls: on/off, `AutoDetect Key`, category dropdown,
correction-strength dial (labelled "Heaviest"), scale dropdown (defaults to Chromatic) and a 12-button
tonic grid. Engine param slugs: `apSlug`, `scaleToSlug`, `tonicToSlug`, `wet`, `duet`. It runs locally
in the worklet.

Harmony beyond that is remote — `harmonizer.bandlab.cloud` with `/v1/presets` and `/v1/models` — so
"Big Harmony"/"Duet" are engine presets while the heavy harmonizer is server side.

## Service map (established)

| Service | Endpoint | Feature |
|---|---|---|
| mastering | `mastering.bandlab.cloud/v1/task` | AI mastering |
| audio2midi | `audio2midi.bandlab.cloud/v1/task` | audio → MIDI |
| voice-transfer | `voice-transfer.bandlab.io/v1/transfer`, `/v2/models` | AI voice models |
| vocal-enhancer | `vocal-enhancer.bandlab.io/v1/task` | vocal cleanup |
| harmonizer | `harmonizer.bandlab.cloud/v1/task`, `/v1/presets`, `/v1/models` | harmony |
| autobeat | `autobeat.bandlab.io/v1/task` | beat generation |
| automix | `automix.bandlab.cloud/v1/task`, `/v1/genres`, `/v1/instruction-suggestions` | AI mixing |
| compose | `compose.bandlab.io/v1/remix`, `/v1/autocomplete` | song starter |
| source-separation | `source-separation.bandlab.io/v4/separation`, `/v1/status` | stems |
| matching-sounds / similar-sounds | `matching-sounds.bandlab.cloud/v1/task`, `similar-sounds.bandlab.io/v1/task` | sample matching |
| vi-generator | `vi-generator.bandlab.cloud/v1/search` | instrument search |

Platform API is versioned (`www.bandlab.com/api/v3.0` … `v4.3`), auth through `accounts.bandlab.com/oauth/*`
(OIDC). A `/sounds` route inventory sits in the evidence bundle.

## Still unknown (honest)

- The full effect list and each parameter's numeric range. They exist only as wasm objects; reading
  them needs a live `effectMetadataManager.getAvailableEffects()` then `getMetadataForEffect()`. The
  `Katnip` injectable resolved but came back empty on this page, and the engine services are not
  registered under the obvious injector names.
- The preset catalogue per effect group.
- Request and response bodies for any of the eleven services.
- Source maps: 591 declared, all 404 under `/web-app/scripts/`.

## What we adopted

- Our mastering shape copies theirs deliberately: preset slug + intensity + input gain + three-band EQ
  with bypass. It is a small, sane surface and it is what users of the real thing expect.
- Their limiter-last rule is worth keeping as an invariant wherever `masterChain` is called.
- Their half-slots-for-free-accounts split maps onto anything we later do about limits.

Nothing of theirs is copied: the engine is theirs, our implementation is our own.
