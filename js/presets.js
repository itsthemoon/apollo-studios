// js/presets.js — patch shape, validation, serialization, and builtin presets.
// Pure ESM, dependency-free, runs under plain Node 22 and in the browser.
// Built-in preset data lives in presets/builtin.json (mirror of BUILTIN;
// scripts/selftest-presets.mjs fails if the two ever drift).

export const PATCH_VERSION = 1

const EQ_KINDS = ['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass']

// Local copy of the scale table. NOTE: js/tune.js does not exist yet, so this
// module keeps its own SCALES. When tune.js lands, replace this table with
// `import { SCALES } from './tune.js'` and delete the local copy so the two
// modules can never disagree. Keep the key names identical to tune.js SCALES.
const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
}

// Stable key order used by serializePatch. '' is the top-level order; known
// keys first, then any extra keys sorted alphabetically so exports diff cleanly.
const KEY_ORDER = {
  '': ['version', 'name', 'tune', 'master', 'vocal'],
  tune: ['root', 'scale', 'amount'],
  master: ['eq', 'comp', 'limitDb', 'targetRmsDb'],
  comp: ['thresholdDb', 'ratio', 'attackMs', 'releaseMs', 'makeupDb'],
  eq: ['kind', 'freq', 'q', 'gainDb'],
  vocal: ['gainDb', 'reverbMix'],
}

const DEFAULT_TUNE = { root: 0, scale: 'chromatic', amount: 0.5 }
const DEFAULT_COMP = { thresholdDb: -18, ratio: 2, attackMs: 10, releaseMs: 150, makeupDb: 0 }
const DEFAULT_MASTER = { eq: [], comp: DEFAULT_COMP, limitDb: -1, targetRmsDb: -16 }
const DEFAULT_VOCAL = { gainDb: 0, reverbMix: 0.15 }

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value)) out[key] = deepClone(value[key])
    return out
  }
  return value
}

export function makePatch(name) {
  return {
    version: PATCH_VERSION,
    name: String(name ?? ''),
    tune: deepClone(DEFAULT_TUNE),
    master: {
      eq: [],
      comp: { ...DEFAULT_COMP },
      limitDb: DEFAULT_MASTER.limitDb,
      targetRmsDb: DEFAULT_MASTER.targetRmsDb,
    },
    vocal: deepClone(DEFAULT_VOCAL),
  }
}

// Never throws; collects every failure into errors instead of stopping early.
export function validatePatch(o) {
  const errors = []
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    return { ok: false, errors: ['patch must be an object'] }
  }
  for (const key of Object.keys(o)) {
    if (!KEY_ORDER[''].includes(key)) errors.push(`unknown key: ${key}`)
  }
  if (o.version !== PATCH_VERSION) errors.push(`version must be ${PATCH_VERSION}`)
  if (typeof o.name !== 'string' || o.name.length === 0) {
    errors.push('name must be a non-empty string')
  } else if (o.name.length >= 60) {
    errors.push('name must be under 60 characters')
  }

  const tune = o.tune
  if (tune === null || typeof tune !== 'object' || Array.isArray(tune)) {
    errors.push('tune must be an object')
  } else {
    if (typeof tune.root !== 'number' || !Number.isInteger(tune.root) || tune.root < 0 || tune.root > 11) {
      errors.push('tune.root must be an integer from 0 to 11')
    }
    if (typeof tune.scale !== 'string' || !(tune.scale in SCALES)) {
      errors.push('tune.scale must be a known scale')
    }
    if (typeof tune.amount !== 'number' || !Number.isFinite(tune.amount) || tune.amount < 0 || tune.amount > 1) {
      errors.push('tune.amount must be between 0 and 1')
    }
  }

  const master = o.master
  if (master === null || typeof master !== 'object' || Array.isArray(master)) {
    errors.push('master must be an object')
  } else {
    if (!Array.isArray(master.eq)) {
      errors.push('master.eq must be an array')
    } else {
      if (master.eq.length > 8) errors.push('master.eq must have at most 8 bands')
      master.eq.forEach((band, i) => {
        if (band === null || typeof band !== 'object' || Array.isArray(band)) {
          errors.push(`master.eq[${i}] must be an object`)
          return
        }
        if (!EQ_KINDS.includes(band.kind)) errors.push(`master.eq[${i}].kind must be a valid eq kind`)
        if (typeof band.freq !== 'number' || !Number.isFinite(band.freq) || band.freq <= 0) {
          errors.push(`master.eq[${i}].freq must be a finite positive number`)
        }
        if (typeof band.q !== 'number' || !Number.isFinite(band.q) || band.q <= 0) {
          errors.push(`master.eq[${i}].q must be a finite positive number`)
        }
        if (typeof band.gainDb !== 'number' || !Number.isFinite(band.gainDb)) {
          errors.push(`master.eq[${i}].gainDb must be a finite number`)
        }
      })
    }
    const comp = master.comp
    if (comp === null || typeof comp !== 'object' || Array.isArray(comp)) {
      errors.push('master.comp must be an object')
    } else {
      if (typeof comp.thresholdDb !== 'number' || !Number.isFinite(comp.thresholdDb) || comp.thresholdDb < -60 || comp.thresholdDb > 0) {
        errors.push('master.comp.thresholdDb must be between -60 and 0')
      }
      if (typeof comp.ratio !== 'number' || !Number.isFinite(comp.ratio) || comp.ratio < 1 || comp.ratio > 100) {
        errors.push('master.comp.ratio must be between 1 and 100')
      }
      if (typeof comp.attackMs !== 'number' || !Number.isFinite(comp.attackMs) || comp.attackMs < 0) {
        errors.push('master.comp.attackMs must be a finite non-negative number')
      }
      if (typeof comp.releaseMs !== 'number' || !Number.isFinite(comp.releaseMs) || comp.releaseMs <= 0) {
        errors.push('master.comp.releaseMs must be a finite positive number')
      }
      if (typeof comp.makeupDb !== 'number' || !Number.isFinite(comp.makeupDb)) {
        errors.push('master.comp.makeupDb must be a finite number')
      }
    }
    if (typeof master.limitDb !== 'number' || !Number.isFinite(master.limitDb) || master.limitDb < -12 || master.limitDb > 0) {
      errors.push('master.limitDb must be between -12 and 0')
    }
    if (typeof master.targetRmsDb !== 'number' || !Number.isFinite(master.targetRmsDb) || master.targetRmsDb < -30 || master.targetRmsDb > -6) {
      errors.push('master.targetRmsDb must be between -30 and -6')
    }
  }

  const vocal = o.vocal
  if (vocal === null || typeof vocal !== 'object' || Array.isArray(vocal)) {
    errors.push('vocal must be an object')
  } else {
    if (typeof vocal.gainDb !== 'number' || !Number.isFinite(vocal.gainDb)) {
      errors.push('vocal.gainDb must be a finite number')
    }
    if (typeof vocal.reverbMix !== 'number' || !Number.isFinite(vocal.reverbMix) || vocal.reverbMix < 0 || vocal.reverbMix > 1) {
      errors.push('vocal.reverbMix must be between 0 and 1')
    }
  }

  return { ok: errors.length === 0, errors }
}

// Deep-merges tune/master/vocal one level (top level is a shallow key merge),
// then re-validates. Throws a short lowercase Error when the result is invalid.
export function mergePatch(base, patch) {
  const merged = {
    ...deepClone(base),
    ...deepClone(patch),
    tune: { ...(base && base.tune), ...(patch && patch.tune) },
    master: { ...(base && base.master), ...(patch && patch.master) },
    vocal: { ...(base && base.vocal), ...(patch && patch.vocal) },
  }
  const result = validatePatch(merged)
  if (!result.ok) throw new Error(result.errors[0])
  return merged
}

function orderedKeys(obj, path) {
  const known = KEY_ORDER[path] ?? []
  const keys = Object.keys(obj)
  const rest = keys.filter((key) => !known.includes(key)).sort()
  return [...known.filter((key) => keys.includes(key)), ...rest]
}

function reorder(value, path) {
  if (Array.isArray(value)) return value.map((item) => reorder(item, path))
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of orderedKeys(value, path)) out[key] = reorder(value[key], key)
    return out
  }
  return value
}

// Stable key order (version, name, tune, master, vocal, then sorted extras)
// so exported files diff cleanly.
export function serializePatch(patch) {
  return JSON.stringify(reorder(patch, ''), null, 2)
}

// Never throws. { ok: true, patch } | { ok: false, error } with a short
// lowercase message. Rejects non-JSON, non-objects, arrays, and anything
// failing validatePatch.
export function parsePatch(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'invalid json' }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'patch must be an object' }
  }
  const result = validatePatch(data)
  if (!result.ok) return { ok: false, error: `invalid patch: ${result.errors.join('; ')}` }
  return { ok: true, patch: data }
}

// Factory presets — our own patches with real, musically sensible values.
// Each one passes validatePatch (checked at module load).
const BUILTIN_SPECS = [
  {
    name: 'Clean Vocal',
    tune: { root: 0, scale: 'chromatic', amount: 0.35 },
    master: {
      eq: [
        { kind: 'highpass', freq: 80, q: 0.71, gainDb: 0 },
        { kind: 'peaking', freq: 240, q: 1.0, gainDb: -2 },
        { kind: 'peaking', freq: 3200, q: 1.2, gainDb: 1.5 },
        { kind: 'highshelf', freq: 8000, q: 0.71, gainDb: 1.5 },
      ],
      comp: { thresholdDb: -20, ratio: 2, attackMs: 12, releaseMs: 140, makeupDb: 0 },
      limitDb: -1,
      targetRmsDb: -16,
    },
    vocal: { gainDb: 0, reverbMix: 0.1 },
  },
  {
    name: 'Radio Pop',
    tune: { root: 0, scale: 'major', amount: 0.85 },
    master: {
      eq: [
        { kind: 'highpass', freq: 90, q: 0.71, gainDb: 0 },
        { kind: 'peaking', freq: 300, q: 1.0, gainDb: -2.5 },
        { kind: 'peaking', freq: 2500, q: 1.0, gainDb: 3 },
        { kind: 'highshelf', freq: 9000, q: 0.71, gainDb: 2.5 },
      ],
      comp: { thresholdDb: -24, ratio: 3, attackMs: 8, releaseMs: 100, makeupDb: 2 },
      limitDb: -0.5,
      targetRmsDb: -11,
    },
    vocal: { gainDb: 1, reverbMix: 0.15 },
  },
  {
    name: 'Warm Ballad',
    tune: { root: 9, scale: 'minor', amount: 0.6 },
    master: {
      eq: [
        { kind: 'highpass', freq: 60, q: 0.71, gainDb: 0 },
        { kind: 'lowshelf', freq: 120, q: 0.71, gainDb: 1.5 },
        { kind: 'peaking', freq: 400, q: 0.8, gainDb: -1 },
        { kind: 'peaking', freq: 7000, q: 1.0, gainDb: -1.5 },
      ],
      comp: { thresholdDb: -18, ratio: 2.5, attackMs: 20, releaseMs: 250, makeupDb: 1 },
      limitDb: -1.5,
      targetRmsDb: -18,
    },
    vocal: { gainDb: 0.5, reverbMix: 0.3 },
  },
  {
    name: 'Hard Tune',
    tune: { root: 0, scale: 'chromatic', amount: 1 },
    master: {
      eq: [
        { kind: 'highpass', freq: 100, q: 0.71, gainDb: 0 },
        { kind: 'peaking', freq: 200, q: 1.0, gainDb: -3 },
        { kind: 'peaking', freq: 3000, q: 1.0, gainDb: 4 },
        { kind: 'peaking', freq: 6000, q: 1.4, gainDb: 2 },
        { kind: 'highshelf', freq: 10000, q: 0.71, gainDb: 3 },
      ],
      comp: { thresholdDb: -26, ratio: 4, attackMs: 5, releaseMs: 80, makeupDb: 3 },
      limitDb: -0.3,
      targetRmsDb: -10,
    },
    vocal: { gainDb: 0, reverbMix: 0.08 },
  },
  {
    name: 'Spoken Word',
    tune: { root: 0, scale: 'chromatic', amount: 0 },
    master: {
      eq: [
        { kind: 'highpass', freq: 70, q: 0.71, gainDb: 0 },
        { kind: 'peaking', freq: 150, q: 1.0, gainDb: -1.5 },
        { kind: 'peaking', freq: 1500, q: 0.9, gainDb: 2 },
        { kind: 'highshelf', freq: 7000, q: 0.71, gainDb: 1 },
      ],
      comp: { thresholdDb: -16, ratio: 2.5, attackMs: 6, releaseMs: 200, makeupDb: 0 },
      limitDb: -1,
      targetRmsDb: -16,
    },
    vocal: { gainDb: 0, reverbMix: 0.05 },
  },
  {
    name: 'Room Demo',
    tune: { root: 7, scale: 'pentatonicMinor', amount: 0.45 },
    master: {
      eq: [
        { kind: 'highpass', freq: 85, q: 0.71, gainDb: 0 },
        { kind: 'peaking', freq: 300, q: 1.0, gainDb: -1.5 },
        { kind: 'peaking', freq: 4500, q: 1.1, gainDb: 1.5 },
      ],
      comp: { thresholdDb: -15, ratio: 2, attackMs: 15, releaseMs: 180, makeupDb: 0 },
      limitDb: -1,
      targetRmsDb: -14,
    },
    vocal: { gainDb: 0, reverbMix: 0.2 },
  },
]

export const BUILTIN = BUILTIN_SPECS.map((spec) => {
  const patch = makePatch(spec.name)
  patch.tune = { ...patch.tune, ...spec.tune }
  patch.master = {
    ...patch.master,
    ...spec.master,
    eq: spec.master.eq.map((band) => ({ ...band })),
    comp: { ...patch.master.comp, ...spec.master.comp },
  }
  patch.vocal = { ...patch.vocal, ...spec.vocal }
  const result = validatePatch(patch)
  if (!result.ok) {
    throw new Error(`builtin preset "${patch.name}" is invalid: ${result.errors.join('; ')}`)
  }
  return patch
})
