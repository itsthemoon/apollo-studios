# Contributing

Undertow is a finished, small tool and it is deliberately boring to work on: no build, no
dependencies, no framework. Keep it that way and a patch will land quickly.

## Before you start

```
node scripts/serve.mjs      # look at what you are changing
node scripts/test.mjs       # must be green before you touch anything
```

Node 22 or newer. There is nothing to install — if your change needs a package, say why in the
pull request. "It saved three lines" is not enough; the answer is usually that it did not.

## What is welcome

- A real bug with a failing test that reproduces it.
- A module improvement with its self-test updated in the same commit.
- Documentation fixes, including ones that only correct a lie.
- Accessibility work: focus order, labels, contrast, reduced-motion behaviour.
- Finishing a listed gap — 24-bit export, stereo takes, undo.

## What is not

- A framework, bundler or transpiler, unless the build step stays optional and the shipped folder
  still runs untouched by hand.
- Reformatting a whole file alongside a three-line fix.
- Renamed public functions without a matching change to `js/contract.md` and the tests.
- Preset data lifted from another product, or code that assumes 44.1 kHz.

## Rules the code lives by

1. Modules under `js/` are pure ESM and must import under bare Node. Browser globals are only legal
   inside `js/capture.js` and `js/app.js`, and only inside functions.
2. Sample rate is always a parameter. Nothing hardcodes a rate.
3. Return new buffers; do not mutate an input unless the name starts with `apply`, `compress`,
   `limit` or `normalize`, and even then never alias it.
4. Numbers stay finite. Guard divide-by-zero, return zero pitch for silence, never emit `NaN`.
5. Errors are `Error` objects with a short lowercase message.
6. Every module exports get a self-test in `scripts/selftest-<module>.mjs` that ends with
   `ALL CHECKS PASSED` on success, and `scripts/test.mjs` spawns it.
7. Public signatures change in `js/contract.md` and `js/contract-appendix.md` first, and in the
   same commit as the code.

## Tests

The suite is the gate, not a formality. It builds a deterministic phrase and asserts both the
happy path and the refusals — malformed presets, uneven channel lengths, out-of-range amounts.
A patch that lowers the count of passing checks without a stated reason will be sent back.

```
node scripts/test.mjs
node scripts/selftest-tune.mjs    # one module on its own
```

Add a case for every bug you fix. If the bug cannot be reproduced in a test, explain why in the
commit message.

## Commits and pull requests

- One concern per commit. Imperative subject under about 70 characters.
- The body says what was broken and how it now behaves, not that a file changed.
- Reference the issue if there is one.
- Do not bump a version or edit a changelog unless the maintainer asks.
- State anything you could not verify. Naming a gap is better than leaving it to be discovered.

## Style

No formatter and no linter is enforced, so match the file. Two-space indent, no semicolons at line
ends, single quotes, `const` by default. Comments explain why a number is what it is, not what the
line does. No emoji in the source or the docs.

## Site changes

`index.html` and `styles-landing.css` are the public face; `app.html` is the studio. Keep the
palette: `#0b0b0f` canvas, `#ececf2` text, `#8b8b9a` muted, `#bf5af2` accent used sparingly,
`#26262f` hairlines, system font stack. Focus rings must stay visible on every interactive element.
Copy is plain and specific — no exclamation marks, no superlatives that the code cannot back up.

## Scope of the licence

By contributing you agree your work ships under the MIT licence in `LICENSE`. There is no CLA and
no copyright assignment; you keep your copyright.

## Getting stuck

Open an issue and say where you stopped. A question with the command and the output pasted in is
answered far faster than "does this work".
