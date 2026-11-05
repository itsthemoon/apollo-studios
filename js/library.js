// js/library.js — the Sounds browser data for apollo-studios.
// Pure ESM, dependency-free, no browser globals. Runs under plain Node 22 and in the
// browser. See js/contract-appendix.md.
//
// There are no audio files in the repository. Every sample carries a compact `pattern`
// string instead, so the UI can draw a strip and render a preview from arithmetic:
//
//   drum patterns   16 chars of 'x' (hit), 'o' (soft hit) and '.' (rest), one bar of 16ths
//   pitched patterns tokens `<semitones-from-key>:<length-in-16ths>` separated by spaces,
//                   '.' for a rest — e.g. '0:2 . 7:2 4:4' is a one-bar riff
//   one-shots       'x' or a single token, one hit
//
// Packs are either 'free' or 'membership'; membership packs are flagged `locked` and the
// Sounds browser shows them behind the join wall. Six of the twelve packs are free.

export const CATEGORIES = Object.freeze([
  Object.freeze({ slug: 'mine', label: 'My Sounds' }),
  Object.freeze({ slug: 'ambient-electronica', label: 'Ambient Electronica' }),
  Object.freeze({ slug: 'ricch-rap-trap', label: 'Ricch Rap Trap' }),
  Object.freeze({ slug: 'pop-punk', label: 'Pop Punk' }),
  Object.freeze({ slug: 'melodic-metal', label: 'Melodic Metal' }),
  Object.freeze({ slug: 'lo-fi', label: 'Lo-fi' }),
  Object.freeze({ slug: 'house', label: 'House' }),
  Object.freeze({ slug: 'afrobeats', label: 'Afrobeats' }),
  Object.freeze({ slug: 'cinematic', label: 'Cinematic' }),
])

// Art is a two-stop CSS gradient: [from, to]. Deliberately dark-to-bright so the cards
// read at thumbnail size and never need an image request.
export const PACKS = Object.freeze([
  Object.freeze({
    slug: 'still-air',
    name: 'Still Air',
    author: 'Nadia Woolf',
    tier: 'free',
    locked: false,
    category: 'ambient-electronica',
    art: Object.freeze(['#1b2a4a', '#7fd6c9']),
    bpm: 72,
    key: 'D dorian',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'cold-bloom',
    name: 'Cold Bloom',
    author: 'Nadia Woolf',
    tier: 'membership',
    locked: true,
    category: 'ambient-electronica',
    art: Object.freeze(['#0e1626', '#5b8bd6']),
    bpm: 64,
    key: 'A minor',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'night-shift-808',
    name: 'Night Shift 808',
    author: 'Kaze',
    tier: 'free',
    locked: false,
    category: 'ricch-rap-trap',
    art: Object.freeze(['#2a0f3a', '#ff5f8f']),
    bpm: 140,
    key: 'F minor',
    bars: 2,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'chrome-trap',
    name: 'Chrome Trap Kit',
    author: 'Kaze',
    tier: 'membership',
    locked: true,
    category: 'ricch-rap-trap',
    art: Object.freeze(['#1a1a22', '#9aa7ff']),
    bpm: 146,
    key: 'G# minor',
    bars: 1,
    kind: 'oneshots',
  }),
  Object.freeze({
    slug: 'garage-summer',
    name: 'Garage Summer',
    author: 'The Tilt',
    tier: 'free',
    locked: false,
    category: 'pop-punk',
    art: Object.freeze(['#3a1c10', '#ffb347']),
    bpm: 168,
    key: 'E major',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'melodeath-forge',
    name: 'Melodeath Forge',
    author: 'Halvard Skog',
    tier: 'free',
    locked: false,
    category: 'melodic-metal',
    art: Object.freeze(['#241016', '#ff4d4d']),
    bpm: 172,
    key: 'B minor',
    bars: 1,
    kind: 'oneshots',
  }),
  Object.freeze({
    slug: 'dusty-tape',
    name: 'Dusty Tape',
    author: 'Mori',
    tier: 'free',
    locked: false,
    category: 'lo-fi',
    art: Object.freeze(['#2b2118', '#c9a26b']),
    bpm: 82,
    key: 'A minor',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'rain-window',
    name: 'Rain On The Window',
    author: 'Mori',
    tier: 'membership',
    locked: true,
    category: 'lo-fi',
    art: Object.freeze(['#1d2630', '#8fb8c9']),
    bpm: 74,
    key: 'C major',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'basement-club',
    name: 'Basement Club',
    author: 'Dovi',
    tier: 'free',
    locked: false,
    category: 'house',
    art: Object.freeze(['#101c2b', '#4fd1ff']),
    bpm: 124,
    key: 'A minor',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'deep-current',
    name: 'Deep Current',
    author: 'Dovi',
    tier: 'membership',
    locked: true,
    category: 'house',
    art: Object.freeze(['#0b1a18', '#33e0b0']),
    bpm: 122,
    key: 'F minor',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'lagos-lift',
    name: 'Lagos Lift',
    author: 'Tunde B',
    tier: 'membership',
    locked: true,
    category: 'afrobeats',
    art: Object.freeze(['#2b1a08', '#ffcc33']),
    bpm: 108,
    key: 'C minor',
    bars: 4,
    kind: 'loops',
  }),
  Object.freeze({
    slug: 'wide-horizon',
    name: 'Wide Horizon',
    author: 'Iris Vane',
    tier: 'membership',
    locked: true,
    category: 'cinematic',
    art: Object.freeze(['#141821', '#b0a4ff']),
    bpm: 88,
    key: 'D minor',
    bars: 1,
    kind: 'packs',
  }),
])

// 40 samples, four per free pack and two or three per locked pack. bpm and key are
// copied from the parent pack so a preview never has to look at two records.
// Uploads live beside the factory list, in memory only: the buffers are far too
// big for the project slot, so a reload drops them like a take.
const USER = []

export function addUserSample({ name, data, rate, bpm = 96 }) {
  if (!data?.length || !(rate > 0)) throw new Error('an upload needs decoded audio')
  const base = String(name || 'upload').replace(/\.[a-z0-9]+$/i, '').trim().slice(0, 40) || 'upload'
  const sample = Object.freeze({
    slug: `user-${Date.now()}-${USER.length}`,
    name: base,
    pack: 'Uploads',
    author: 'You',
    kind: 'sample',
    category: 'mine',
    user: true,
    bpm,
    key: 'C',
    data,
    rate,
  })
  USER.push(sample)
  return sample
}

export function userSamples() {
  return USER.slice()
}

export const SAMPLE_LIST = Object.freeze([
  Object.freeze({
    slug: 'still-air-pad',
    name: 'Halogen Pad',
    pack: 'still-air',
    kind: 'loops',
    instrument: 'pad',
    bpm: 72,
    key: 'D dorian',
    bars: 4,
    pattern: '0:8 . 3:8 . 5:8 . 10:8 .',
  }),
  Object.freeze({
    slug: 'still-air-keys',
    name: 'Glass Keys',
    pack: 'still-air',
    kind: 'loops',
    instrument: 'keys',
    bpm: 72,
    key: 'D dorian',
    bars: 4,
    pattern: '0:2 . 5:2 . 7:4 . 10:2 7:2',
  }),
  Object.freeze({
    slug: 'still-air-texture',
    name: 'Tape Hiss Bed',
    pack: 'still-air',
    kind: 'loops',
    instrument: 'texture',
    bpm: 72,
    key: 'D dorian',
    bars: 4,
    pattern: 'oooooooooooooooo',
  }),
  Object.freeze({
    slug: 'still-air-swell',
    name: 'Slow Swell',
    pack: 'still-air',
    kind: 'loops',
    instrument: 'fx',
    bpm: 72,
    key: 'D dorian',
    bars: 4,
    pattern: '. . . . . . . . 0:16',
  }),

  Object.freeze({
    slug: 'cold-bloom-pad',
    name: 'Frozen Choir',
    pack: 'cold-bloom',
    kind: 'loops',
    instrument: 'pad',
    bpm: 64,
    key: 'A minor',
    bars: 4,
    pattern: '0:16 . 3:16 .',
  }),
  Object.freeze({
    slug: 'cold-bloom-voice',
    name: 'Breath Voice',
    pack: 'cold-bloom',
    kind: 'loops',
    instrument: 'vocal',
    bpm: 64,
    key: 'A minor',
    bars: 4,
    pattern: '0:2 3:2 5:2 . 3:2 0:6',
  }),
  Object.freeze({
    slug: 'cold-bloom-drone',
    name: 'Sub Drone',
    pack: 'cold-bloom',
    kind: 'loops',
    instrument: 'bass',
    bpm: 64,
    key: 'A minor',
    bars: 4,
    pattern: '0:32',
  }),

  Object.freeze({
    slug: 'night-shift-kick',
    name: 'Mud Kick',
    pack: 'night-shift-808',
    kind: 'loops',
    instrument: 'kick',
    bpm: 140,
    key: 'F minor',
    bars: 2,
    pattern: 'x.....x...x.....',
  }),
  Object.freeze({
    slug: 'night-shift-hats',
    name: 'Rolling Hats',
    pack: 'night-shift-808',
    kind: 'loops',
    instrument: 'hat',
    bpm: 140,
    key: 'F minor',
    bars: 2,
    pattern: 'x.xxx.xxx.xxx.xx',
  }),
  Object.freeze({
    slug: 'night-shift-rim',
    name: 'Rim Clap',
    pack: 'night-shift-808',
    kind: 'loops',
    instrument: 'snare',
    bpm: 140,
    key: 'F minor',
    bars: 2,
    pattern: '....x.......x...',
  }),
  Object.freeze({
    slug: 'night-shift-sub',
    name: 'Sub Slide',
    pack: 'night-shift-808',
    kind: 'loops',
    instrument: 'bass',
    bpm: 140,
    key: 'F minor',
    bars: 2,
    pattern: '0:4 0:2 3:2 . 5:8',
  }),

  Object.freeze({
    slug: 'chrome-808',
    name: 'Chrome 808',
    pack: 'chrome-trap',
    kind: 'oneshots',
    instrument: 'bass',
    bpm: 146,
    key: 'G# minor',
    bars: 1,
    pattern: '0:2',
  }),
  Object.freeze({
    slug: 'chrome-snare',
    name: 'Clap Stack',
    pack: 'chrome-trap',
    kind: 'oneshots',
    instrument: 'snare',
    bpm: 146,
    key: 'G# minor',
    bars: 1,
    pattern: 'x',
  }),
  Object.freeze({
    slug: 'chrome-hat',
    name: 'Metal Hat',
    pack: 'chrome-trap',
    kind: 'oneshots',
    instrument: 'hat',
    bpm: 146,
    key: 'G# minor',
    bars: 1,
    pattern: 'x',
  }),

  Object.freeze({
    slug: 'garage-gtr',
    name: 'Chugged Eighths',
    pack: 'garage-summer',
    kind: 'loops',
    instrument: 'guitar',
    bpm: 168,
    key: 'E major',
    bars: 4,
    pattern: '0:2 0:2 0:2 0:2 0:2 0:2 0:2 0:2',
  }),
  Object.freeze({
    slug: 'garage-drums',
    name: 'Room Drums',
    pack: 'garage-summer',
    kind: 'loops',
    instrument: 'drum',
    bpm: 168,
    key: 'E major',
    bars: 4,
    pattern: 'x...x...x...x...',
  }),
  Object.freeze({
    slug: 'garage-bass',
    name: 'Pick Bass',
    pack: 'garage-summer',
    kind: 'loops',
    instrument: 'bass',
    bpm: 168,
    key: 'E major',
    bars: 4,
    pattern: '0:4 0:4 5:4 7:4',
  }),
  Object.freeze({
    slug: 'garage-crash',
    name: 'Crash Hit',
    pack: 'garage-summer',
    kind: 'loops',
    instrument: 'drum',
    bpm: 168,
    key: 'E major',
    bars: 1,
    pattern: 'x...............',
  }),

  Object.freeze({
    slug: 'forge-chug',
    name: 'Palm Mute Chug',
    pack: 'melodeath-forge',
    kind: 'oneshots',
    instrument: 'guitar',
    bpm: 172,
    key: 'B minor',
    bars: 1,
    pattern: '0:1',
  }),
  Object.freeze({
    slug: 'forge-lead',
    name: 'Harmony Lead',
    pack: 'melodeath-forge',
    kind: 'oneshots',
    instrument: 'lead',
    bpm: 172,
    key: 'B minor',
    bars: 1,
    pattern: '0:2 7:2 5:2',
  }),
  Object.freeze({
    slug: 'forge-snare',
    name: 'Crack Snare',
    pack: 'melodeath-forge',
    kind: 'oneshots',
    instrument: 'snare',
    bpm: 172,
    key: 'B minor',
    bars: 1,
    pattern: 'x',
  }),
  Object.freeze({
    slug: 'forge-tom',
    name: 'Floor Tom',
    pack: 'melodeath-forge',
    kind: 'oneshots',
    instrument: 'tom',
    bpm: 172,
    key: 'B minor',
    bars: 1,
    pattern: 'x',
  }),

  Object.freeze({
    slug: 'dusty-keys',
    name: 'Warped Rhodes',
    pack: 'dusty-tape',
    kind: 'loops',
    instrument: 'keys',
    bpm: 82,
    key: 'A minor',
    bars: 4,
    pattern: '0:2 3:2 7:4 . 5:2 3:2 0:4',
  }),
  Object.freeze({
    slug: 'dusty-drums',
    name: 'Tape Drums',
    pack: 'dusty-tape',
    kind: 'loops',
    instrument: 'drum',
    bpm: 82,
    key: 'A minor',
    bars: 4,
    pattern: 'x......x..x.....',
  }),
  Object.freeze({
    slug: 'dusty-bass',
    name: 'Round Bass',
    pack: 'dusty-tape',
    kind: 'loops',
    instrument: 'bass',
    bpm: 82,
    key: 'A minor',
    bars: 4,
    pattern: '0:8 . 3:4 . 5:4',
  }),
  Object.freeze({
    slug: 'dusty-vinyl',
    name: 'Vinyl Crackle',
    pack: 'dusty-tape',
    kind: 'loops',
    instrument: 'fx',
    bpm: 82,
    key: 'A minor',
    bars: 4,
    pattern: 'oo.o.ooo.o.oo.oo',
  }),

  Object.freeze({
    slug: 'rain-keys',
    name: 'Rain Rhodes',
    pack: 'rain-window',
    kind: 'loops',
    instrument: 'keys',
    bpm: 74,
    key: 'C major',
    bars: 4,
    pattern: '0:4 4:4 7:4 12:4',
  }),
  Object.freeze({
    slug: 'rain-fx',
    name: 'Window Rain',
    pack: 'rain-window',
    kind: 'loops',
    instrument: 'fx',
    bpm: 74,
    key: 'C major',
    bars: 4,
    pattern: 'oooooooooooooooo',
  }),

  Object.freeze({
    slug: 'basement-kick',
    name: 'Club Kick',
    pack: 'basement-club',
    kind: 'loops',
    instrument: 'kick',
    bpm: 124,
    key: 'A minor',
    bars: 4,
    pattern: 'x...x...x...x...',
  }),
  Object.freeze({
    slug: 'basement-conga',
    name: 'Conga Top',
    pack: 'basement-club',
    kind: 'loops',
    instrument: 'perc',
    bpm: 124,
    key: 'A minor',
    bars: 4,
    pattern: '..x...x...x...x.',
  }),
  Object.freeze({
    slug: 'basement-bass',
    name: 'Rolling Bass',
    pack: 'basement-club',
    kind: 'loops',
    instrument: 'bass',
    bpm: 124,
    key: 'A minor',
    bars: 4,
    pattern: '0:2 0:2 0:2 3:2 . 5:2 5:2 .',
  }),
  Object.freeze({
    slug: 'basement-clap',
    name: 'Backbeat Clap',
    pack: 'basement-club',
    kind: 'loops',
    instrument: 'snare',
    bpm: 124,
    key: 'A minor',
    bars: 4,
    pattern: '....x.......x...',
  }),

  Object.freeze({
    slug: 'current-bass',
    name: 'Deep Roller',
    pack: 'deep-current',
    kind: 'loops',
    instrument: 'bass',
    bpm: 122,
    key: 'F minor',
    bars: 4,
    pattern: '0:8 0:8 3:8 5:8',
  }),
  Object.freeze({
    slug: 'current-stab',
    name: 'Chord Stab',
    pack: 'deep-current',
    kind: 'loops',
    instrument: 'keys',
    bpm: 122,
    key: 'F minor',
    bars: 4,
    pattern: '. 0:2 . 5:2 . 3:2 . 7:2',
  }),
  Object.freeze({
    slug: 'current-shaker',
    name: 'Loose Shaker',
    pack: 'deep-current',
    kind: 'loops',
    instrument: 'perc',
    bpm: 122,
    key: 'F minor',
    bars: 4,
    pattern: 'o.oo.oo.o.oo.oo.',
  }),

  Object.freeze({
    slug: 'lagos-log',
    name: 'Talk Drum',
    pack: 'lagos-lift',
    kind: 'loops',
    instrument: 'perc',
    bpm: 108,
    key: 'C minor',
    bars: 4,
    pattern: 'x..x..x...x..x..',
  }),
  Object.freeze({
    slug: 'lagos-shaker',
    name: 'Grid Shaker',
    pack: 'lagos-lift',
    kind: 'loops',
    instrument: 'perc',
    bpm: 108,
    key: 'C minor',
    bars: 4,
    pattern: 'o.o.o.o.o.o.o.o.',
  }),
  Object.freeze({
    slug: 'lagos-gtr',
    name: 'Highlife Guitar',
    pack: 'lagos-lift',
    kind: 'loops',
    instrument: 'guitar',
    bpm: 108,
    key: 'C minor',
    bars: 4,
    pattern: '0:2 3:2 5:2 7:2 5:2 3:2 0:4',
  }),

  Object.freeze({
    slug: 'horizon-swell',
    name: 'Horizon Swell',
    pack: 'wide-horizon',
    kind: 'packs',
    instrument: 'texture',
    bpm: 88,
    key: 'D minor',
    bars: 1,
    pattern: '0:16',
  }),
  Object.freeze({
    slug: 'horizon-brass',
    name: 'Low Brass Hit',
    pack: 'wide-horizon',
    kind: 'packs',
    instrument: 'brass',
    bpm: 88,
    key: 'D minor',
    bars: 1,
    pattern: '0:4',
  }),
])

const PACK_BY_SLUG = new Map(PACKS.map((p) => [p.slug, p]))
const SAMPLE_BY_SLUG = new Map(SAMPLE_LIST.map((s) => [s.slug, s]))
const CATEGORY_BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]))
const BARS_PER_LOOP = 4
const BEATS_PER_BAR = 4
const PREVIEW_STEPS = 16
const SEARCH_LIMIT = 40
const SUGGEST_LIMIT = 6

const byName = (a, b) => a.name.localeCompare(b.name)

function normaliseQuery(query) {
  return typeof query === 'string' ? query.trim().toLowerCase() : ''
}

function sampleFor(slug) {
  if (typeof slug !== 'string') return null
  return SAMPLE_BY_SLUG.get(slug) ?? null
}

function packFor(slug) {
  if (typeof slug !== 'string') return null
  return PACK_BY_SLUG.get(slug) ?? null
}

// Search hits name, instrument, pack name and category label, all case-insensitively.
// Partial words count ('rhod' finds Warped Rhodes) and an empty or non-string query
// returns [] rather than the whole library, so the browser can show its own landing state.
export function search(query) {
  const mineHits = USER.filter((s) => s.name.toLowerCase().includes(String(query || '').toLowerCase()))
  const q = normaliseQuery(query)
  if (!q) return []
  const hits = []
  for (const sample of SAMPLE_LIST) {
    const pack = PACK_BY_SLUG.get(sample.pack)
    const category = pack ? CATEGORY_BY_SLUG.get(pack.category) : null
    const haystack = [
      sample.name,
      sample.instrument,
      pack ? pack.name : '',
      pack ? pack.author : '',
      category ? category.label : '',
    ]
      .join(' ')
      .toLowerCase()
    if (haystack.includes(q)) hits.push(sample)
    if (hits.length >= SEARCH_LIMIT) break
  }
  return [...mineHits, ...hits.sort(byName)]
}

export function byCategory(slug) {
  if (slug === 'mine') return USER.slice()
  if (!CATEGORY_BY_SLUG.has(slug)) return []
  const out = []
  for (const sample of SAMPLE_LIST) {
    const pack = PACK_BY_SLUG.get(sample.pack)
    if (pack && pack.category === slug) out.push(sample)
  }
  return out.sort(byName)
}

export function byPack(slug) {
  if (!PACK_BY_SLUG.has(slug)) return []
  const out = []
  for (const sample of SAMPLE_LIST) {
    if (sample.pack === slug) out.push(sample)
  }
  return out.sort(byName)
}

// Favourites are a plain array of slugs owned by the caller: toggling returns a new
// array, always with the newest favourite first, and never touches the input.
export function favourite(slugs, slug) {
  const list = Array.isArray(slugs) ? slugs.slice() : []
  if (!sampleFor(slug) && !packFor(slug)) return list
  if (list.includes(slug)) return list.filter((s) => s !== slug)
  list.unshift(slug)
  return list
}

export function isFavourite(slugs, slug) {
  if (!Array.isArray(slugs) || typeof slug !== 'string') return false
  return slugs.includes(slug)
}

// Same category, different pack, never the sample itself, alphabetical and capped.
export function suggested(slug, limit = SUGGEST_LIMIT) {
  const sample = sampleFor(slug)
  if (!sample) return []
  const pack = PACK_BY_SLUG.get(sample.pack)
  if (!pack) return []
  const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SUGGEST_LIMIT
  const out = []
  for (const other of SAMPLE_LIST) {
    if (other.slug === sample.slug || other.pack === pack.slug) continue
    const otherPack = PACK_BY_SLUG.get(other.pack)
    if (!otherPack || otherPack.category !== pack.category) continue
    out.push(other)
  }
  return out.sort(byName).slice(0, cap)
}

export function packOf(slug) {
  const sample = sampleFor(slug)
  return sample ? PACK_BY_SLUG.get(sample.pack) ?? null : null
}

// Loop length in seconds, or one beat for a one-shot / pack preview.
export function durationSeconds(sample, bpm) {
  const record = typeof sample === 'string' ? sampleFor(sample) : sample
  if (!record || typeof record !== 'object') throw new Error('unknown sample')
  const tempo = bpm === undefined ? record.bpm : bpm
  if (!Number.isFinite(tempo) || tempo <= 0) throw new Error('bad bpm')
  const beats = record.kind === 'loops' ? (record.bars || 1) * BEATS_PER_BAR : 1
  return (beats * 60) / tempo
}

// Parse a pattern into steps a preview can walk: { steps, hit, offset, dur }. Drum rows
// give one entry per 16th with hit true/false; melodic rows give sounded steps only.
export function parsePattern(sample) {
  const record = typeof sample === 'string' ? sampleFor(sample) : sample
  if (!record || typeof record.pattern !== 'string') throw new Error('unknown sample')
  const steps = []
  if (record.pattern.includes(':')) {
    const tokens = record.pattern.split(/\s+/).filter(Boolean)
    let at = 0
    for (const token of tokens) {
      if (token === '.') {
        at += 1
        continue
      }
      const [offsetText, lenText] = token.split(':')
      const offset = Number(offsetText)
      const dur = Number(lenText ?? 1)
      if (!Number.isFinite(offset) || !Number.isFinite(dur) || dur < 1) throw new Error('bad pattern')
      steps.push({ step: at, hit: true, offset, dur })
      at += dur
    }
    return { steps, length: at }
  }
  if (record.pattern.length !== PREVIEW_STEPS && record.pattern.length !== 1) throw new Error('bad pattern')
  for (let i = 0; i < record.pattern.length; i++) {
    const c = record.pattern[i]
    if (c !== 'x' && c !== 'o' && c !== '.') throw new Error('bad pattern')
    steps.push({ step: i, hit: c !== '.', soft: c === 'o', offset: 0, dur: 1 })
  }
  return { steps, length: record.pattern.length }
}

export const FREE_PACKS = Object.freeze(PACKS.filter((p) => p.tier === 'free'))
export const MEMBERSHIP_PACKS = Object.freeze(PACKS.filter((p) => p.tier === 'membership'))
export const PREVIEW_STEP_COUNT = PREVIEW_STEPS
export const LOOP_BARS = BARS_PER_LOOP
