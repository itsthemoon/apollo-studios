# Build

Undertow has **no dependencies and no build step**. There is nothing to install, compile or bundle —
the browser loads the ES modules in `js/` exactly as they are on disk. A checkout runs immediately.

## Requirements

- **Node 22 or newer** — only for the local static server and the test harness. The app itself is
  plain browser JavaScript and does not use Node.
- A browser with Web Audio, `AudioContext` and `getUserMedia` (for recording). Chrome, Edge, Firefox
  and Safari all work. Microphone input needs a secure context, which `http://127.0.0.1` satisfies;
  serving from a LAN IP over plain HTTP may not.

## Serve

```
npm run serve
```

Starts `scripts/serve.mjs` on <http://127.0.0.1:4173>. Override the port with `PORT=8080 npm run serve`.
The server is a ~40-line static file server with no caching and correct MIME types; it is for local
use and is not intended to be exposed to the internet.

Open the page, then either press **Record** (allow the mic prompt) or press **Load demo** to work with
a synthetic take and skip the microphone entirely.

## Test

```
npm test
```

Runs `scripts/test.mjs`: the four module self-tests, then pitch detection, tuning, preset validation,
mastering, WAV encoding and DOM wiring. It exits 0 only when every check passes, and prints a
`checks passed` total. Expect the run to take about a second.

The final section asserts that `/`, `/js/app.js` and `/styles.css` serve over HTTP, so a server must
already be listening on :4173 — start `npm run serve` in another terminal first, or use `npm run e2e`.

## End-to-end

```
npm run e2e
```

Self-contained: it reuses a server already on :4173 if there is one, otherwise starts one and shuts it
down afterwards, then runs the full suite. This is the command to use from a cold checkout or in CI.

## Layout of the suite

- `scripts/selftest-*.mjs` — per-module checks (`input`, `tune`, `presets`, `master`)
- `scripts/test.mjs` — the whole suite, including the DOM wiring and HTTP assertions
- `scripts/e2e.mjs` — server lifecycle wrapper around `test.mjs`

Everything under test except `scripts/test.mjs`'s wiring check is pure: functions take a sample rate
and typed arrays, and never touch the DOM.
