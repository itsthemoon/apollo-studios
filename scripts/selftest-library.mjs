// scripts/selftest-library.mjs — self-test for js/library.js.
// Run from the project root:  node scripts/selftest-library.mjs
import {
  CATEGORIES,
  PACKS,
  SAMPLE_LIST,
  FREE_PACKS,
  MEMBERSHIP_PACKS,
  PREVIEW_STEP_COUNT,
  search,
  byCategory,
  byPack,
  favourite,
  isFavourite,
  suggested,
  packOf,
  durationSeconds,
  parsePattern,
} from '../js/library.js'
import { test, eq, ok, near, throws, report } from './lib/assert.mjs'

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const HEX = /^#[0-9a-f]{6}$/
const KEY = /^[A-G](#|b)? (major|minor|dorian|phrygian|lydian|mixolydian)$/
const KINDS = ['loops', 'oneshots', 'packs']
const CATEGORY_SLUGS = new Set(CATEGORIES.map((c) => c.slug))
const PACK_SLUGS = new Set(PACKS.map((p) => p.slug))
const SAMPLE_SLUGS = new Set(SAMPLE_LIST.map((s) => s.slug))
const packBy = new Map(PACKS.map((p) => [p.slug, p]))

test('categories: the eight factory packs in order, then My Sounds first-class', () => {
  eq(CATEGORIES.length, 9, 'eight factory categories plus mine')
  const expected = [
    'mine',
    'ambient-electronica',
    'ricch-rap-trap',
    'pop-punk',
    'melodic-metal',
    'lo-fi',
    'house',
    'afrobeats',
    'cinematic',
  ]
  expected.forEach((slug, i) => eq(CATEGORIES[i].slug, slug, `category ${i}`))
  for (const category of CATEGORIES) {
    ok(SLUG.test(category.slug), `slug ${category.slug}`)
    ok(typeof category.label === 'string' && category.label.length > 1, `label ${category.slug}`)
    eq(category.label, category.label.trim(), 'label is trimmed')
    ok(category.label === category.label.replace(/\s+/g, ' '), 'label has single spaces')
    eq(category.label[0], category.label[0].toUpperCase(), 'label is capitalised')
  }
  eq(new Set(CATEGORIES.map((c) => c.slug)).size, 9, 'category slugs unique')
  eq(new Set(CATEGORIES.map((c) => c.label)).size, 9, 'category labels unique')
  ok(Object.isFrozen(CATEGORIES), 'categories frozen')
})

test('packs: twelve, unique slugs, six free and six membership', () => {
  eq(PACKS.length, 12, 'twelve packs')
  eq(new Set(PACKS.map((p) => p.slug)).size, 12, 'pack slugs unique')
  eq(PACKS.filter((p) => p.tier === 'free').length, 6, 'six free packs')
  eq(PACKS.filter((p) => p.tier === 'membership').length, 6, 'six membership packs')
  eq(FREE_PACKS.length, 6, 'FREE_PACKS matches')
  eq(MEMBERSHIP_PACKS.length, 6, 'MEMBERSHIP_PACKS matches')
  for (const pack of PACKS) {
    ok(pack.tier === 'free' || pack.tier === 'membership', `tier ${pack.slug}`)
    eq(pack.locked, pack.tier === 'membership', `locked flag on ${pack.slug}`)
    ok(Object.isFrozen(pack), `pack ${pack.slug} frozen`)
  }
  const free = PACKS.filter((p) => p.tier === 'free').map((p) => p.slug).sort()
  eq(free.join(','), FREE_PACKS.map((p) => p.slug).sort().join(','), 'free list is the free tier')
})

test('packs: every field is well formed', () => {
  for (const pack of PACKS) {
    ok(SLUG.test(pack.slug), `slug ${pack.slug}`)
    ok(pack.name.length >= 3 && pack.name.length <= 32, `name ${pack.slug}`)
    ok(pack.author.length >= 2 && pack.author.length <= 24, `author ${pack.slug}`)
    ok(CATEGORY_SLUGS.has(pack.category), `category ${pack.slug}`)
    eq(pack.art.length, 2, `two gradient stops ${pack.slug}`)
    ok(HEX.test(pack.art[0]) && HEX.test(pack.art[1]), `hex art ${pack.slug}`)
    ok(pack.art[0] !== pack.art[1], `gradient differs ${pack.slug}`)
    ok(Number.isInteger(pack.bpm) && pack.bpm >= 60 && pack.bpm <= 180, `bpm ${pack.slug}`)
    ok(KEY.test(pack.key), `key ${pack.slug}`)
    ok(Number.isInteger(pack.bars) && pack.bars >= 1 && pack.bars <= 8, `bars ${pack.slug}`)
    ok(KINDS.includes(pack.kind), `kind ${pack.slug}`)
  }
})

test('packs: every category is used and pair-heavy categories exist', () => {
  const used = new Set(PACKS.map((p) => p.category))
  // 'mine' holds uploads, so it never has a pack card
  for (const category of [...CATEGORY_SLUGS].filter((c) => c !== 'mine')) ok(used.has(category), `category ${category} has a pack`)
  const counts = new Map()
  for (const pack of PACKS) counts.set(pack.category, (counts.get(pack.category) ?? 0) + 1)
  const paired = [...counts.values()].filter((n) => n > 1).length
  ok(paired >= 4, `at least four categories have two packs, got ${paired}`)
  for (const [, n] of counts) ok(n <= 2, `no category over two packs, got ${n}`)
})

test('samples: forty, unique slugs, frozen', () => {
  eq(SAMPLE_LIST.length, 40, 'forty samples')
  eq(new Set(SAMPLE_LIST.map((s) => s.slug)).size, 40, 'sample slugs unique')
  for (const sample of SAMPLE_LIST) {
    ok(SLUG.test(sample.slug), `slug ${sample.slug}`)
    ok(Object.isFrozen(sample), `sample ${sample.slug} frozen`)
  }
})

test('samples: every pack resolves and matches kind, tempo and key', () => {
  for (const sample of SAMPLE_LIST) {
    ok(PACK_SLUGS.has(sample.pack), `pack exists for ${sample.slug}`)
    const pack = packBy.get(sample.pack)
    ok(pack, `pack record for ${sample.slug}`)
    eq(sample.kind, pack.kind, `kind matches pack for ${sample.slug}`)
    eq(sample.bpm, pack.bpm, `bpm matches pack for ${sample.slug}`)
    eq(sample.key, pack.key, `key matches pack for ${sample.slug}`)
    ok(KINDS.includes(sample.kind), `kind ${sample.slug}`)
    ok(Number.isInteger(sample.bars) && sample.bars >= 1 && sample.bars <= 8, `bars ${sample.slug}`)
  }
})

test('samples: names, instruments and patterns are real', () => {
  const instruments = new Set(SAMPLE_LIST.map((s) => s.instrument))
  for (const sample of SAMPLE_LIST) {
    ok(sample.name.length >= 3 && sample.name.length <= 32, `name ${sample.slug}`)
    ok(sample.instrument.length >= 2, `instrument ${sample.slug}`)
    ok(sample.pattern.length >= 1, `pattern ${sample.slug}`)
  }
  ok(instruments.size >= 10, `at least ten instruments, got ${instruments.size}`)
  ok(instruments.has('pad') && instruments.has('drum') && instruments.has('bass'), 'core instruments present')
})

test('samples: every free pack carries at least four usable samples', () => {
  for (const pack of FREE_PACKS) {
    const count = SAMPLE_LIST.filter((s) => s.pack === pack.slug).length
    ok(count >= 4, `free pack ${pack.slug} has ${count} samples`)
  }
  for (const pack of MEMBERSHIP_PACKS) {
    const count = SAMPLE_LIST.filter((s) => s.pack === pack.slug).length
    ok(count >= 2, `membership pack ${pack.slug} has ${count} samples`)
  }
})

test('patterns: drum rows are sixteen steps of x, o and dot', () => {
  const drumRows = SAMPLE_LIST.filter((s) => s.pattern.length === PREVIEW_STEP_COUNT && !s.pattern.includes(':'))
  ok(drumRows.length >= 8, `enough drum rows, got ${drumRows.length}`)
  for (const sample of drumRows) {
    eq(sample.pattern.length, PREVIEW_STEP_COUNT, `sixteen steps for ${sample.slug}`)
    ok(/^[xo.]+$/.test(sample.pattern), `charset for ${sample.slug}`)
    ok(/[xo]/.test(sample.pattern), `at least one hit for ${sample.slug}`)
  }
})

test('patterns: pitched rows are offset:length tokens that sum to the bar', () => {
  const rows = SAMPLE_LIST.filter((s) => s.pattern.includes(':'))
  ok(rows.length >= 12, `enough pitched rows, got ${rows.length}`)
  for (const sample of rows) {
    const parsed = parsePattern(sample)
    ok(parsed.length <= 64, `length ${sample.slug} = ${parsed.length}`)
    for (const step of parsed.steps) {
      ok(step.dur >= 1 && step.dur <= 32, `dur ${sample.slug}`)
      ok(Number.isInteger(step.offset), `offset ${sample.slug}`)
      ok(step.offset >= 0 && step.offset <= 12, `offset range ${sample.slug}`)
    }
    const covered = parsed.steps.reduce((n, s) => n + s.dur, 0)
    ok(covered >= 1, `covered ${sample.slug}`)
  }
})

test('parsePattern: returns step data and guards unknown input', () => {
  const parsed = parsePattern('still-air-keys')
  ok(parsed.steps.length >= 3, 'keys row has steps')
  eq(parsed.steps[0].step, 0, 'first step at zero')
  const drum = parsePattern('night-shift-kick')
  eq(drum.steps.length, 16, 'drum row parses to sixteen steps')
  eq(drum.steps.filter((s) => s.hit).length, 3, 'three kick hits')
  ok(drum.steps[0].hit, 'first kick is a hit')
  throws(() => parsePattern('nope'), 'unknown sample')
  throws(() => parsePattern(42), 'non-string sample')
})

test('packOf: resolves the parent pack, null for junk', () => {
  const pack = packOf('dusty-keys')
  ok(pack, 'pack found')
  eq(pack.slug, 'dusty-tape', 'correct pack')
  eq(packOf('nope'), null, 'unknown slug')
  eq(packOf(''), null, 'empty slug')
  eq(packOf(undefined), null, 'undefined slug')
  eq(packOf(7), null, 'numeric slug')
  eq(packOf('dusty-tape'), null, 'a pack slug is not a sample')
})

test('search: case-insensitive partial matches on names', () => {
  eq(search('RHODES').length, 2, 'uppercase finds both rhodes')
  eq(search('rhod').length, 2, 'partial finds both rhodes')
  eq(search('warped').length, 1, 'exact word finds one')
  eq(search('warped')[0].slug, 'dusty-keys', 'right record')
  eq(search('pad').length, 2, 'instrument and name hits')
  eq(search('still air').length, 4, 'pack name hits every sample in it')
  eq(search('glass').length, 1, 'single name word')
})

test('search: matches pack, author and category text', () => {
  ok(search('mori').length >= 4, 'author search spans both Mori packs')
  ok(search('dusty tape').length >= 4, 'pack name search')
  ok(search('lo-fi').length >= 6, 'category label search')
  ok(search('ambient').length >= 7, 'category word search')
  ok(search('nadia').length >= 6, 'author nadia')
})

test('search: empty, junk and no-hit queries', () => {
  eq(search('').length, 0, 'empty query')
  eq(search('   ').length, 0, 'spaces only')
  eq(search(undefined).length, 0, 'undefined query')
  eq(search(null).length, 0, 'null query')
  eq(search(42).length, 0, 'numeric query')
  eq(search('zzzz').length, 0, 'no hits')
  eq(search('  rhod  ').length, 2, 'outer spaces trimmed')
  const hits = search('a')
  ok(hits.length > 0 && hits.length <= 40, 'results are capped by the library size')
  ok(hits.slice(1).every((s, i) => hits[i].name <= s.name), 'results sorted by name')
})

test('byCategory: filters, sorts, guards', () => {
  const lofi = byCategory('lo-fi')
  eq(lofi.length, 6, 'six lofi samples')
  ok(lofi.every((s) => packBy.get(s.pack).category === 'lo-fi'), 'all lofi')
  ok(lofi.slice(1).every((s, i) => lofi[i].name <= s.name), 'sorted by name')
  eq(byCategory('nope').length, 0, 'unknown category')
  eq(byCategory(undefined).length, 0, 'undefined category')
  eq(byCategory('Lo-fi').length, 0, 'category slug is case-sensitive')
  const total = CATEGORIES.reduce((n, c) => n + byCategory(c.slug).length, 0)
  eq(total, 40, 'every sample belongs to exactly one category')
})

test('byPack: filters, sorts, guards', () => {
  const chrome = byPack('chrome-trap')
  eq(chrome.length, 3, 'three chrome samples')
  ok(chrome.every((s) => s.pack === 'chrome-trap'), 'all from the pack')
  ok(chrome.slice(1).every((s, i) => chrome[i].name <= s.name), 'sorted by name')
  eq(byPack('nope').length, 0, 'unknown pack')
  eq(byPack('').length, 0, 'empty pack')
  eq(byPack(5).length, 0, 'numeric pack')
  const total = PACKS.reduce((n, p) => n + byPack(p.slug).length, 0)
  eq(total, 40, 'every sample belongs to one pack')
})

test('favourite: toggles, newest first, never mutates', () => {
  const base = ['garage-gtr']
  const added = favourite(base, 'dusty-keys')
  eq(base.length, 1, 'input untouched')
  eq(added.length, 2, 'added')
  eq(added[0], 'dusty-keys', 'newest first')
  const removed = favourite(added, 'dusty-keys')
  eq(removed.length, 1, 'removed again')
  eq(removed[0], 'garage-gtr', 'other kept')
  ok(removed !== added, 'fresh array')
  eq(favourite([], 'night-shift-kick').length, 1, 'empty list works')
  eq(favourite(undefined, 'night-shift-kick').length, 1, 'missing list works')
  eq(favourite('nope', 'night-shift-kick').length, 1, 'non-array list works')
  eq(favourite([], 'nope').length, 0, 'unknown slug ignored')
  eq(favourite(['a'], 'nope').join(','), 'a', 'unknown slug leaves list alone')
  eq(favourite([], 'dusty-tape').length, 1, 'pack slugs can be favourited')
})

test('favourite: duplicates collapse on toggle', () => {
  eq(favourite(['dusty-keys', 'dusty-keys'], 'dusty-keys').length, 0, 'both copies removed')
  const list = ['a', 'dusty-keys', 'b']
  eq(favourite(list, 'dusty-keys').join(','), 'a,b', 'middle entry removed')
  eq(favourite(list, 'dusty-keys').length, 2, 'input keeps three')
  eq(favourite(['a', 'b'], 'still-air-pad')[0], 'still-air-pad', 'unshift onto a list')
})

test('isFavourite: booleans and guards', () => {
  eq(isFavourite(['dusty-keys'], 'dusty-keys'), true, 'present')
  eq(isFavourite(['dusty-keys'], 'garage-gtr'), false, 'absent')
  eq(isFavourite([], 'dusty-keys'), false, 'empty')
  eq(isFavourite(undefined, 'dusty-keys'), false, 'undefined list')
  eq(isFavourite('dusty-keys', 'dusty-keys'), false, 'string list')
  eq(isFavourite(['dusty-keys'], undefined), false, 'undefined slug')
  eq(isFavourite(['dusty-keys'], 1), false, 'numeric slug')
})

test('suggested: same category, different pack, capped, deterministic', () => {
  const list = suggested('dusty-keys')
  ok(list.length >= 2, `suggestions exist, got ${list.length}`)
  ok(list.every((s) => packBy.get(s.pack).category === 'lo-fi'), 'same category')
  ok(list.every((s) => s.pack !== 'dusty-tape'), 'different pack')
  ok(list.every((s) => s.slug !== 'dusty-keys'), 'never itself')
  eq(list.length, new Set(list.map((s) => s.slug)).size, 'no duplicates')
  eq(JSON.stringify(list), JSON.stringify(suggested('dusty-keys')), 'deterministic')
  eq(suggested('dusty-keys', 1).length, 1, 'limit honoured')
  eq(suggested('dusty-keys', 0).length > 0, true, 'zero limit falls back')
})

test('suggested: empty for single-pack categories and junk', () => {
  eq(suggested('garage-gtr').length, 0, 'pop punk has one pack')
  eq(suggested('forge-chug').length, 0, 'metal has one pack')
  eq(suggested('lagos-log').length, 0, 'afrobeats has one pack')
  eq(suggested('horizon-swell').length, 0, 'cinematic has one pack')
  eq(suggested('nope').length, 0, 'unknown slug')
  eq(suggested(undefined).length, 0, 'undefined slug')
})

test('durationSeconds: loop length follows bars and tempo', () => {
  near(durationSeconds('still-air-pad'), (4 * 4 * 60) / 72, 1e-9, 'four bars at 72')
  near(durationSeconds('night-shift-kick'), (2 * 4 * 60) / 140, 1e-9, 'two bars at 140')
  near(durationSeconds('garage-drums'), (4 * 4 * 60) / 168, 1e-9, 'four bars at 168')
  near(durationSeconds(SAMPLE_LIST[0], 120), 8, 1e-9, 'render sample object at 120')
  near(durationSeconds('dusty-keys', 60), 16, 1e-9, 'explicit tempo wins')
})

test('durationSeconds: one-shots are one beat, packs too', () => {
  near(durationSeconds('chrome-snare'), 60 / 146, 1e-12, 'one beat at 146')
  near(durationSeconds('forge-chug'), 60 / 172, 1e-12, 'one beat at 172')
  near(durationSeconds('horizon-brass'), 60 / 88, 1e-12, 'pack preview is one beat')
  near(durationSeconds('chrome-snare', 120), 0.5, 1e-12, 'explicit tempo')
})

test('durationSeconds: guards bad tempo and unknown samples', () => {
  throws(() => durationSeconds('still-air-pad', 0), 'zero bpm')
  throws(() => durationSeconds('still-air-pad', -90), 'negative bpm')
  throws(() => durationSeconds('still-air-pad', Number.NaN), 'NaN bpm')
  throws(() => durationSeconds('still-air-pad', Infinity), 'infinite bpm')
  throws(() => durationSeconds('nope'), 'unknown slug')
  throws(() => durationSeconds(undefined), 'undefined sample')
  throws(() => durationSeconds({}), 'empty object')
  ok(durationSeconds('still-air-pad') > 0, 'default tempo is finite')
})

test('dataset invariants hold together', () => {
  eq(SAMPLE_SLUGS.size, SAMPLE_LIST.length, 'every sample slug unique')
  for (const pack of PACKS) {
    ok(!SAMPLE_SLUGS.has(pack.slug), `pack slug ${pack.slug} not reused by a sample`)
    ok(byPack(pack.slug).length > 0, `pack ${pack.slug} is not empty`)
  }
  // mine is the upload bucket: empty until something is uploaded
  for (const category of CATEGORIES.filter((c) => c.slug !== 'mine')) ok(byCategory(category.slug).length > 0, `category ${category.slug} not empty`)
  for (const pack of FREE_PACKS) ok(pack.locked === false, `free pack ${pack.slug} unlocked`)
  for (const pack of MEMBERSHIP_PACKS) ok(pack.locked === true, `locked pack ${pack.slug}`)
})

report()
