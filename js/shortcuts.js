// js/shortcuts.js — the single keyboard-shortcut registry for apollo-studios.
// Pure ESM, dependency-free, no browser globals at import time. See js/contract-appendix.md.
//
// One table is the source of truth for the shortcut sheet, the menu bar, and the
// global key handler. Nothing else may hard-code a combo.
//
// Binding shape: { group, key, shift, cmd, alt, action, label }
//   key     normalised lowercase `KeyboardEvent.key` ('space', 'enter', 'escape',
//           'delete', 'f13', 'z', '='). Single letters are stored lowercase.
//   cmd     true when the platform command modifier is required. `find` accepts
//           either metaKey (macOS) or ctrlKey (Windows/Linux), so one table serves
//           every platform.
//   shift/alt exact: a binding only matches when the pressed modifiers equal its own
//           flags. There is no "cmd swallows shift" fuzz.
//
// Optional fields:
//   display          label override for the key cap (punctuation, named keys)
//   shiftIsImplicit  the symbol already implies shift, so `format` omits the glyph

export const GROUPS = Object.freeze([
  'Edit',
  'Tools',
  'View',
  'Transport',
  'Settings',
  'Project',
  'Special',
])

const G = Object.freeze(Object.fromEntries(GROUPS.map(g => [g, g])))

function bind(group, key, mods, action, label, extra = {}) {
  return Object.freeze({
    group,
    key,
    shift: mods.includes('shift'),
    cmd: mods.includes('cmd'),
    alt: mods.includes('alt'),
    action,
    label,
    ...extra,
  })
}

const PLAIN = ''
const CMD = 'cmd'
const SHIFT = 'shift'
const CMD_SHIFT = 'cmd+shift'
const CMD_ALT = 'cmd+alt'

// ---- the registry -----------------------------------------------------------
// Order is the order the shortcut sheet prints. Keep groups contiguous.

export const BINDINGS = Object.freeze([
  // Edit
  bind(G.Edit, 'z', CMD, 'edit.undo', 'Undo'),
  bind(G.Edit, 'z', CMD_SHIFT, 'edit.redo', 'Redo'),
  bind(G.Edit, 'x', CMD, 'edit.cut', 'Cut'),
  bind(G.Edit, 'c', CMD, 'edit.copy', 'Copy'),
  bind(G.Edit, 'v', CMD, 'edit.paste', 'Paste'),
  bind(G.Edit, 'd', CMD, 'edit.duplicate', 'Duplicate'),
  bind(G.Edit, 'delete', PLAIN, 'edit.delete', 'Delete'),
  bind(G.Edit, 'backspace', PLAIN, 'edit.deleteBack', 'Delete (backspace)'),
  bind(G.Edit, 'a', CMD, 'edit.selectAll', 'Select all'),

  // Tools
  bind(G.Tools, 'e', CMD, 'tools.split', 'Split at playhead'),
  bind(G.Tools, 'j', CMD, 'tools.join', 'Join regions'),
  bind(G.Tools, 'q', PLAIN, 'tools.quantize', 'Quantize'),
  bind(G.Tools, 'e', PLAIN, 'tools.openEditor', 'Open editor'),
  bind(G.Tools, 'a', PLAIN, 'tools.toggleAutomation', 'Show/hide automation'),
  bind(G.Tools, 'a', SHIFT, 'tools.armAutomation', 'Arm automation recording'),
  bind(G.Tools, 't', PLAIN, 'tools.stretch', 'Stretch region'),

  // View
  bind(G.View, '=', PLAIN, 'view.zoomIn', 'Zoom in'),
  bind(G.View, '-', PLAIN, 'view.zoomOut', 'Zoom out'),
  bind(G.View, '0', CMD, 'view.fit', 'Fit project'),
  bind(G.View, 'm', PLAIN, 'view.mixer', 'Mixer'),
  bind(G.View, 'f', PLAIN, 'view.effects', 'Effects'),
  bind(G.View, 'k', CMD, 'view.sounds', 'Sounds'),
  bind(G.View, 'y', PLAIN, 'view.lyrics', 'Lyrics'),

  // Transport
  bind(G.Transport, 'k', PLAIN, 'transport.metronome', 'Metronome'),
  bind(G.Transport, 'k', SHIFT, 'transport.countIn', 'Count-in'),
  bind(G.Transport, 'p', PLAIN, 'transport.punch', 'Punch in/out'),
  bind(G.Transport, 'space', PLAIN, 'transport.playStop', 'Play/stop'),
  bind(G.Transport, 'enter', PLAIN, 'transport.toStart', 'Return to start'),
  bind(G.Transport, 'r', PLAIN, 'transport.record', 'Record'),
  bind(G.Transport, 'l', PLAIN, 'transport.loop', 'Loop'),

  // Settings
  bind(G.Settings, ',', CMD, 'settings.open', 'Settings'),

  // Project
  bind(G.Project, 's', CMD, 'project.save', 'Save'),
  bind(G.Project, 'p', CMD_SHIFT, 'project.publish', 'Publish'),
  bind(G.Project, 't', CMD_SHIFT, 'project.newTrack', 'New track'),
  bind(G.Project, ',', CMD_ALT, 'project.settings', 'Project settings'),
  bind(G.Project, 'h', CMD_ALT, 'project.history', 'Version history'),
  bind(G.Project, 'e', CMD_SHIFT, 'project.export', 'Export'),

  // Special
  bind(G.Special, '?', SHIFT, 'special.shortcuts', 'Keyboard shortcuts', { shiftIsImplicit: true }),
  bind(G.Special, 'escape', PLAIN, 'special.close', 'Close panel'),
])

// ---- normalisation ----------------------------------------------------------

const KEY_ALIASES = Object.freeze({
  ' ': 'space',
  spacebar: 'space',
  return: 'enter',
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
})

function normaliseKey(key) {
  if (typeof key !== 'string') return ''
  const lower = key.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

function normalisePlatform(platform) {
  const p = String(platform ?? '').toLowerCase()
  if (p.includes('darwin') || p.includes('mac') || p.includes('iphone') || p.includes('ipad')) return 'mac'
  if (p.includes('win')) return 'windows'
  return 'unix'
}

function platformOf() {
  if (typeof process !== 'undefined' && typeof process?.platform === 'string') return process.platform
  /* c8 ignore next */
  if (typeof navigator !== 'undefined' && typeof navigator?.platform === 'string') return navigator.platform
  return 'unix'
}

// ---- lookup -----------------------------------------------------------------

// Exact combo match: every modifier flag must agree. Returns the frozen binding
// object or null. ctrlKey is accepted as the command modifier off macOS.
export function find(ev) {
  if (!ev || typeof ev !== 'object') return null
  const key = normaliseKey(ev.key)
  if (!key) return null
  const cmd = Boolean(ev.metaKey || ev.ctrlKey)
  const shift = Boolean(ev.shiftKey)
  const alt = Boolean(ev.altKey)
  for (const binding of BINDINGS) {
    if (binding.key !== key) continue
    if (binding.cmd !== cmd || binding.shift !== shift || binding.alt !== alt) continue
    return binding
  }
  return null
}

export function byGroup(group) {
  const out = BINDINGS.filter(b => b.group === group)
  if (!out.length) throw new Error(`unknown group ${group}`)
  return out
}

// Every combo claimed more than once, as { combo, actions }. Empty when clean.
export function conflicts() {
  const seen = new Map()
  for (const b of BINDINGS) {
    const combo = `${b.cmd ? 'cmd+' : ''}${b.alt ? 'alt+' : ''}${b.shift ? 'shift+' : ''}${b.key}`
    const actions = seen.get(combo)
    if (actions) actions.push(b.action)
    else seen.set(combo, [b.action])
  }
  return [...seen.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([combo, actions]) => Object.freeze({ combo, actions: Object.freeze(actions) }))
}

// ---- display ----------------------------------------------------------------

const MAC_KEYS = Object.freeze({
  space: 'Space',
  enter: '↩',
  escape: 'Esc',
  delete: '⌫',
  backspace: '⌫',
  tab: '⇥',
})

const PC_KEYS = Object.freeze({
  space: 'Space',
  enter: 'Enter',
  escape: 'Esc',
  delete: 'Del',
  backspace: 'Backspace',
  tab: 'Tab',
})

// Glyphs that print as themselves rather than as an uppercased letter.
const LITERAL_KEYS = new Set(['?', ',', '=', '-'])

function keyLabel(binding, mac) {
  if (binding.display) return binding.display
  const named = (mac ? MAC_KEYS : PC_KEYS)[binding.key]
  if (named) return named
  if (binding.key.length === 1) {
    return LITERAL_KEYS.has(binding.key) ? binding.key : binding.key.toUpperCase()
  }
  return binding.key.charAt(0).toUpperCase() + binding.key.slice(1)
}

// Human-readable combo for the current (or supplied) platform.
// macOS: ⇧⌘P. Everything else: Ctrl+Shift+P.
export function format(binding, platform = platformOf()) {
  if (!binding || typeof binding !== 'object' || typeof binding.key !== 'string') {
    throw new Error('not a binding')
  }
  const mac = normalisePlatform(platform) === 'mac'
  const label = keyLabel(binding, mac)
  const shift = binding.shift && !binding.shiftIsImplicit
  if (mac) {
    return `${binding.alt ? '⌥' : ''}${shift ? '⇧' : ''}${binding.cmd ? '⌘' : ''}${label}`
  }
  const parts = []
  if (binding.cmd) parts.push('Ctrl')
  if (binding.alt) parts.push('Alt')
  if (shift) parts.push('Shift')
  parts.push(label)
  return parts.join('+')
}

// ---- focus ------------------------------------------------------------------

// True when the event target swallows plain-letter shortcuts.
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false
  const tag = String(el.tagName ?? el.nodeName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable === true) return true
  if (String(el.contentEditable ?? '').toLowerCase() === 'true') return true
  if (typeof el.getAttribute === 'function') {
    const attr = el.getAttribute('contenteditable')
    if (attr !== null && attr !== undefined && String(attr).toLowerCase() !== 'false') return true
  }
  return false
}

// ---- integrity --------------------------------------------------------------
// Fail at import time, not at the first keypress, if the table is malformed.

const actions = new Set()
for (const b of BINDINGS) {
  for (const field of ['group', 'key', 'action', 'label']) {
    if (typeof b[field] !== 'string' || !b[field].trim()) {
      throw new Error(`bad binding field ${field}`)
    }
  }
  if (!GROUPS.includes(b.group)) throw new Error(`bad binding group ${b.group}`)
  if (actions.has(b.action)) throw new Error(`duplicate action ${b.action}`)
  actions.add(b.action)
}
if (conflicts().length) {
  throw new Error(`conflicting shortcut ${conflicts()[0].combo}`)
}
