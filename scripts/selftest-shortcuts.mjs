// scripts/selftest-shortcuts.mjs — self-test for js/shortcuts.js.
// Run from the project root:  node scripts/selftest-shortcuts.mjs
import {
  GROUPS,
  BINDINGS,
  find,
  format,
  byGroup,
  conflicts,
  isTypingTarget,
} from '../js/shortcuts.js'
import { test, eq, ok, throws, report } from './lib/assert.mjs'

// action -> exact combo the product spec demands
const REQUIRED = {
  'edit.undo': { key: 'z', cmd: true, shift: false, alt: false },
  'edit.redo': { key: 'z', cmd: true, shift: true, alt: false },
  'edit.cut': { key: 'x', cmd: true, shift: false, alt: false },
  'edit.copy': { key: 'c', cmd: true, shift: false, alt: false },
  'edit.paste': { key: 'v', cmd: true, shift: false, alt: false },
  'edit.duplicate': { key: 'd', cmd: true, shift: false, alt: false },
  'edit.delete': { key: 'delete', cmd: false, shift: false, alt: false },
  'edit.selectAll': { key: 'a', cmd: true, shift: false, alt: false },
  'tools.split': { key: 'e', cmd: true, shift: false, alt: false },
  'tools.join': { key: 'j', cmd: true, shift: false, alt: false },
  'tools.quantize': { key: 'q', cmd: false, shift: false, alt: false },
  'tools.openEditor': { key: 'e', cmd: false, shift: false, alt: false },
  'tools.toggleAutomation': { key: 'a', cmd: false, shift: false, alt: false },
  'tools.armAutomation': { key: 'a', cmd: false, shift: true, alt: false },
  'tools.stretch': { key: 't', cmd: false, shift: false, alt: false },
  'view.zoomIn': { key: '=', cmd: false, shift: false, alt: false },
  'view.zoomOut': { key: '-', cmd: false, shift: false, alt: false },
  'view.fit': { key: '0', cmd: true, shift: false, alt: false },
  'view.mixer': { key: 'm', cmd: false, shift: false, alt: false },
  'view.effects': { key: 'f', cmd: false, shift: false, alt: false },
  'view.sounds': { key: 'k', cmd: true, shift: false, alt: false },
  'view.lyrics': { key: 'y', cmd: false, shift: false, alt: false },
  'transport.metronome': { key: 'k', cmd: false, shift: false, alt: false },
  'transport.countIn': { key: 'k', cmd: false, shift: true, alt: false },
  'transport.punch': { key: 'p', cmd: false, shift: false, alt: false },
  'transport.playStop': { key: 'space', cmd: false, shift: false, alt: false },
  'transport.toStart': { key: 'enter', cmd: false, shift: false, alt: false },
  'transport.record': { key: 'r', cmd: false, shift: false, alt: false },
  'transport.loop': { key: 'l', cmd: false, shift: false, alt: false },
  'settings.open': { key: ',', cmd: true, shift: false, alt: false },
  'project.save': { key: 's', cmd: true, shift: false, alt: false },
  'project.publish': { key: 'p', cmd: true, shift: true, alt: false },
  'project.newTrack': { key: 't', cmd: true, shift: true, alt: false },
  'project.settings': { key: ',', cmd: true, shift: false, alt: true },
  'project.history': { key: 'h', cmd: true, shift: false, alt: true },
  'project.export': { key: 'e', cmd: true, shift: true, alt: false },
  'special.shortcuts': { key: '?', cmd: false, shift: true, alt: false },
  'special.close': { key: 'escape', cmd: false, shift: false, alt: false },
}

const byAction = new Map(BINDINGS.map(b => [b.action, b]))

function eventFor(b, overrides = {}) {
  return {
    key: b.key,
    metaKey: b.cmd,
    shiftKey: b.shift,
    altKey: b.alt,
    ...overrides,
  }
}

// ---- 1. groups --------------------------------------------------------------

test('GROUPS: the seven fixed groups, frozen and ordered', () => {
  eq(Array.isArray(GROUPS), true)
  eq(GROUPS.length, 7)
  eq(GROUPS.join('|'), 'Edit|Tools|View|Transport|Settings|Project|Special')
  ok(Object.isFrozen(GROUPS))
  for (const g of GROUPS) ok(typeof g === 'string' && g.length > 0, `group ${g}`)
})

test('GROUPS: all seven are used and no other group appears', () => {
  const used = new Set(BINDINGS.map(b => b.group))
  eq(used.size, 7)
  for (const g of GROUPS) ok(used.has(g), `${g} has bindings`)
})

test('BINDINGS are printed grouped and in registry order', () => {
  let last = -1
  for (const b of BINDINGS) {
    const at = GROUPS.indexOf(b.group)
    ok(at >= last, `${b.action} group order`)
    last = at
  }
})

// ---- 2. table integrity -----------------------------------------------------

test('BINDINGS: frozen array of frozen records', () => {
  ok(Array.isArray(BINDINGS))
  ok(Object.isFrozen(BINDINGS))
  for (const b of BINDINGS) ok(Object.isFrozen(b), `${b.action} frozen`)
})

test('BINDINGS: every record has the full, well-typed shape', () => {
  for (const b of BINDINGS) {
    for (const field of ['group', 'key', 'action', 'label']) {
      eq(typeof b[field], 'string', `${b.action}.${field} is a string`)
      ok(b[field].trim().length > 0, `${b.action}.${field} is filled`)
    }
    eq(typeof b.shift, 'boolean', `${b.action}.shift boolean`)
    eq(typeof b.cmd, 'boolean', `${b.action}.cmd boolean`)
    eq(typeof b.alt, 'boolean', `${b.action}.alt boolean`)
    ok(/^[a-z]+\.[a-zA-Z]+$/.test(b.action), `${b.action} action shape`)
    ok(b.key === b.key.toLowerCase(), `${b.action} key stored lowercase`)
  }
})

test('BINDINGS: actions, labels and combos are unique', () => {
  eq(new Set(BINDINGS.map(b => b.action)).size, BINDINGS.length)
  eq(new Set(BINDINGS.map(b => b.label)).size, BINDINGS.length)
  const combos = BINDINGS.map(b => `${b.cmd}${b.alt}${b.shift}${b.key}`)
  eq(new Set(combos).size, BINDINGS.length)
})

test('BINDINGS: covers all required actions, plus only the backspace alias', () => {
  eq(BINDINGS.length, Object.keys(REQUIRED).length + 1)
  eq(byAction.get('edit.deleteBack').group, 'Edit')
  for (const action of Object.keys(REQUIRED)) ok(byAction.has(action), `missing ${action}`)
})

test('required actions sit in the expected groups', () => {
  const expected = {
    'edit.undo': 'Edit', 'edit.redo': 'Edit', 'edit.cut': 'Edit', 'edit.copy': 'Edit',
    'edit.paste': 'Edit', 'edit.duplicate': 'Edit', 'edit.delete': 'Edit', 'edit.selectAll': 'Edit',
    'tools.split': 'Tools', 'tools.join': 'Tools', 'tools.quantize': 'Tools',
    'tools.openEditor': 'Tools', 'tools.toggleAutomation': 'Tools', 'tools.armAutomation': 'Tools',
    'tools.stretch': 'Tools',
    'view.zoomIn': 'View', 'view.zoomOut': 'View', 'view.fit': 'View', 'view.mixer': 'View',
    'view.effects': 'View', 'view.sounds': 'View', 'view.lyrics': 'View',
    'transport.metronome': 'Transport', 'transport.countIn': 'Transport', 'transport.punch': 'Transport',
    'transport.playStop': 'Transport', 'transport.toStart': 'Transport', 'transport.record': 'Transport',
    'transport.loop': 'Transport', 'settings.open': 'Settings',
    'project.save': 'Project', 'project.publish': 'Project', 'project.newTrack': 'Project',
    'project.settings': 'Project', 'project.history': 'Project', 'project.export': 'Project',
    'special.shortcuts': 'Special', 'special.close': 'Special',
  }
  for (const [action, group] of Object.entries(expected)) eq(byAction.get(action).group, group, action)
})

// ---- 3. exact combos --------------------------------------------------------

test('every required action has its exact key and modifiers', () => {
  for (const [action, combo] of Object.entries(REQUIRED)) {
    const b = byAction.get(action)
    eq(b.key, combo.key, `${action} key`)
    eq(b.cmd, combo.cmd, `${action} cmd`)
    eq(b.shift, combo.shift, `${action} shift`)
    eq(b.alt, combo.alt, `${action} alt`)
  }
})

// ---- 4. resolution ----------------------------------------------------------

test('every binding resolves to itself', () => {
  for (const b of BINDINGS) {
    const hit = find(eventFor(b))
    ok(hit, `${b.action} resolves`)
    eq(hit.action, b.action, `${b.action} identity`)
    eq(hit, b, `${b.action} returns the registry record`)
  }
})

test('every binding resolves with ctrlKey instead of metaKey', () => {
  for (const b of BINDINGS) {
    const hit = find({ key: b.key, ctrlKey: b.cmd, shiftKey: b.shift, altKey: b.alt })
    eq(hit?.action, b.action, `${b.action} ctrl form`)
  }
})

test('both command keys at once still resolve', () => {
  for (const b of BINDINGS.filter(x => x.cmd)) {
    const hit = find({ key: b.key, metaKey: true, ctrlKey: true, shiftKey: b.shift, altKey: b.alt })
    eq(hit?.action, b.action, `${b.action} meta+ctrl`)
  }
})

test('wrong key never resolves to a binding', () => {
  for (const b of BINDINGS) eq(find(eventFor(b, { key: 'f13' })), null, `${b.action} wrong key`)
})

test('modifier matching is exact — adding an unused modifier changes the hit', () => {
  for (const b of BINDINGS) {
    if (!b.cmd) {
      const hit = find(eventFor(b, { metaKey: true }))
      if (hit) ok(hit.action !== b.action, `${b.action} +cmd differs`)
      else eq(hit, null, `${b.action} +cmd`)
    }
    if (b.cmd) {
      const hit = find(eventFor(b, { metaKey: false }))
      if (hit) ok(hit.action !== b.action, `${b.action} -cmd differs`)
      else eq(hit, null, `${b.action} -cmd`)
    }
  }
})

test('shift is exact', () => {
  for (const b of BINDINGS.filter(x => x.shift)) {
    const hit = find(eventFor(b, { shiftKey: false }))
    if (hit) ok(hit.action !== b.action, `${b.action} -shift differs`)
    else eq(hit, null, `${b.action} -shift`)
  }
  for (const b of BINDINGS.filter(x => !x.shift)) {
    const hit = find(eventFor(b, { shiftKey: true }))
    if (hit) ok(hit.action !== b.action, `${b.action} +shift differs`)
    else eq(hit, null, `${b.action} +shift`)
  }
})

test('alt is exact', () => {
  for (const b of BINDINGS.filter(x => x.alt)) {
    const hit = find(eventFor(b, { altKey: false }))
    if (hit) ok(hit.action !== b.action, `${b.action} -alt differs`)
    else eq(hit, null, `${b.action} -alt`)
  }
  for (const b of BINDINGS.filter(x => !x.alt)) {
    const hit = find(eventFor(b, { altKey: true }))
    if (hit) ok(hit.action !== b.action, `${b.action} +alt differs`)
    else eq(hit, null, `${b.action} +alt`)
  }
})

test('unassigned combos are null', () => {
  for (const ev of [
    { key: 'z', metaKey: true, altKey: true },
    { key: 'z', altKey: true },
    { key: 'z', metaKey: true, shiftKey: true, altKey: true },
    { key: 'q', metaKey: true, shiftKey: true },
    { key: 'q', shiftKey: true },
    { key: 'space', metaKey: true },
    { key: 'space', shiftKey: true },
    { key: 'space', altKey: true },
    { key: 'enter', metaKey: true },
    { key: 'delete', metaKey: true },
    { key: 'escape', shiftKey: true },
    { key: '0', altKey: true },
  ]) eq(find(ev), null, JSON.stringify(ev))
})

test('case-insensitivity: uppercase and mixed-case keys resolve', () => {
  eq(find({ key: 'Z', metaKey: true })?.action, 'edit.undo')
  eq(find({ key: 'Z', metaKey: true, shiftKey: true })?.action, 'edit.redo')
  eq(find({ key: 'Q' })?.action, 'tools.quantize')
  eq(find({ key: 'Space' })?.action, 'transport.playStop')
  eq(find({ key: 'ENTER' })?.action, 'transport.toStart')
  eq(find({ key: 'Escape' })?.action, 'special.close')
  eq(find({ key: 'Delete' })?.action, 'edit.delete')
  eq(find({ key: 'A', shiftKey: true })?.action, 'tools.armAutomation')
})

test('event key aliases resolve', () => {
  eq(find({ key: ' ' })?.action, 'transport.playStop')
  eq(find({ key: 'Spacebar' })?.action, 'transport.playStop')
  eq(find({ key: 'Return' })?.action, 'transport.toStart')
  eq(find({ key: 'esc' })?.action, 'special.close')
  eq(find({ key: 'Del' })?.action, 'edit.delete')
})

test('unknown and malformed events are null', () => {
  eq(find(), null)
  eq(find(null), null)
  eq(find({}), null)
  eq(find({ key: '' }), null)
  eq(find({ key: 'F13' }), null)
  eq(find({ key: 'F24' }), null)
  eq(find({ key: 'Unidentified' }), null)
  eq(find({ key: 'Dead' }), null)
  eq(find({ key: 'ArrowUp' }), null)
  eq(find({ key: '{' }), null)
  eq(find({ key: 'f13', metaKey: true }), null)
  eq(find({ key: 42 }), null)
})

// ---- 5. conflicts -----------------------------------------------------------

test('conflicts: registry is clean', () => {
  eq(Array.isArray(conflicts()), true)
  eq(conflicts().length, 0)
  eq(JSON.stringify(conflicts()), '[]')
})

// ---- 6. formatting ----------------------------------------------------------

test('format: macOS glyph order, shift closest to the glyph before cmd', () => {
  eq(format(byAction.get('edit.undo'), 'darwin'), '⌘Z')
  eq(format(byAction.get('edit.redo'), 'darwin'), '⇧⌘Z')
  eq(format(byAction.get('edit.cut'), 'darwin'), '⌘X')
  eq(format(byAction.get('edit.duplicate'), 'darwin'), '⌘D')
  eq(format(byAction.get('project.export'), 'darwin'), '⇧⌘E')
  eq(format(byAction.get('project.publish'), 'darwin'), '⇧⌘P')
  eq(format(byAction.get('project.newTrack'), 'darwin'), '⇧⌘T')
  eq(format(byAction.get('project.settings'), 'darwin'), '⌥⌘,')
  eq(format(byAction.get('project.history'), 'darwin'), '⌥⌘H')
  eq(format(byAction.get('settings.open'), 'darwin'), '⌘,')
  eq(format(byAction.get('view.fit'), 'darwin'), '⌘0')
  eq(format(byAction.get('view.sounds'), 'darwin'), '⌘K')
})

test('format: macOS named keys and shift-implicit symbols', () => {
  eq(format(byAction.get('transport.playStop'), 'darwin'), 'Space')
  eq(format(byAction.get('transport.toStart'), 'darwin'), '↩')
  eq(format(byAction.get('edit.delete'), 'darwin'), '⌫')
  eq(format(byAction.get('edit.deleteBack'), 'darwin'), '⌫')
  eq(format(byAction.get('special.close'), 'darwin'), 'Esc')
  eq(format(byAction.get('special.shortcuts'), 'darwin'), '?')
  eq(format(byAction.get('view.zoomIn'), 'darwin'), '=')
  eq(format(byAction.get('view.zoomOut'), 'darwin'), '-')
})

test('format: Windows and Linux use Ctrl words', () => {
  eq(format(byAction.get('edit.undo'), 'win32'), 'Ctrl+Z')
  eq(format(byAction.get('edit.redo'), 'win32'), 'Ctrl+Shift+Z')
  eq(format(byAction.get('project.export'), 'win32'), 'Ctrl+Shift+E')
  eq(format(byAction.get('project.settings'), 'win32'), 'Ctrl+Alt+,')
  eq(format(byAction.get('settings.open'), 'win32'), 'Ctrl+,')
  eq(format(byAction.get('transport.playStop'), 'win32'), 'Space')
  eq(format(byAction.get('transport.toStart'), 'win32'), 'Enter')
  eq(format(byAction.get('edit.delete'), 'win32'), 'Del')
  eq(format(byAction.get('edit.deleteBack'), 'win32'), 'Backspace')
  eq(format(byAction.get('special.shortcuts'), 'win32'), '?')
  eq(format(byAction.get('special.shortcuts'), 'linux'), '?')
  eq(format(byAction.get('edit.undo'), 'linux'), 'Ctrl+Z')
  eq(format(byAction.get('project.save'), 'linux'), 'Ctrl+S')
})

test('format: all three modifiers in canonical order', () => {
  const all = { key: 'z', cmd: true, alt: true, shift: true }
  eq(format(all, 'darwin'), '⌥⇧⌘Z')
  eq(format(all, 'win32'), 'Ctrl+Alt+Shift+Z')
})

test('format: platform aliases', () => {
  eq(format(byAction.get('edit.undo'), 'MacIntel'), '⌘Z')
  eq(format(byAction.get('edit.undo'), 'mac'), '⌘Z')
  eq(format(byAction.get('edit.undo'), 'windows'), 'Ctrl+Z')
  eq(format(byAction.get('edit.undo'), undefined), format(byAction.get('edit.undo')))
})

test('format: every binding formats cleanly on every platform', () => {
  for (const b of BINDINGS) {
    for (const platform of ['darwin', 'win32', 'linux']) {
      const out = format(b, platform)
      ok(out.length > 0, `${b.action} ${platform} non-empty`)
      ok(!out.includes('undefined'), `${b.action} ${platform} clean`)
      ok(!out.includes('null'), `${b.action} ${platform} no null`)
    }
  }
})

test('format: rejects junk', () => {
  throws(() => format(null))
  throws(() => format({}))
  throws(() => format('z'))
})

// ---- 7. typing targets ------------------------------------------------------

test('isTypingTarget: form fields are typing targets', () => {
  eq(isTypingTarget({ tagName: 'INPUT' }), true)
  eq(isTypingTarget({ tagName: 'TEXTAREA' }), true)
  eq(isTypingTarget({ tagName: 'SELECT' }), true)
  eq(isTypingTarget({ tagName: 'input' }), true)
  eq(isTypingTarget({ nodeName: 'TEXTAREA' }), true)
})

test('isTypingTarget: contenteditable is a typing target', () => {
  eq(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  eq(isTypingTarget({ tagName: 'DIV', contentEditable: 'true' }), true)
  eq(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'true' }), true)
  eq(isTypingTarget({ tagName: 'DIV', getAttribute: () => '' }), true)
  eq(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'plaintext-only' }), true)
})

test('isTypingTarget: contenteditable="false" and ordinary nodes are not', () => {
  eq(isTypingTarget({ tagName: 'DIV', getAttribute: () => 'false' }), false)
  eq(isTypingTarget({ tagName: 'DIV', contentEditable: 'false' }), false)
  eq(isTypingTarget({ tagName: 'DIV' }), false)
  eq(isTypingTarget({ tagName: 'BUTTON' }), false)
  eq(isTypingTarget({}), false)
})

test('isTypingTarget: null and junk are false', () => {
  eq(isTypingTarget(null), false)
  eq(isTypingTarget(undefined), false)
  eq(isTypingTarget('input'), false)
  eq(isTypingTarget(0), false)
})

// ---- 8. byGroup -------------------------------------------------------------

test('byGroup: every group returns only its own bindings', () => {
  for (const g of GROUPS) {
    const list = byGroup(g)
    ok(list.length > 0, `${g} non-empty`)
    for (const b of list) eq(b.group, g, `${b.action} in ${g}`)
  }
})

test('byGroup: exact sizes', () => {
  eq(byGroup('Edit').length, 9)
  eq(byGroup('Tools').length, 7)
  eq(byGroup('View').length, 7)
  eq(byGroup('Transport').length, 7)
  eq(byGroup('Settings').length, 1)
  eq(byGroup('Project').length, 6)
  eq(byGroup('Special').length, 2)
  eq(GROUPS.reduce((n, g) => n + byGroup(g).length, 0), BINDINGS.length)
})

test('byGroup: returns registry records but a fresh array', () => {
  const list = byGroup('Edit')
  const again = byGroup('Edit')
  ok(list !== again)
  eq(list[0], again[0])
  list.push('junk')
  eq(byGroup('Edit').length, 9)
})

test('byGroup: unknown groups throw', () => {
  throws(() => byGroup('Nope'))
  throws(() => byGroup('edit'))
  throws(() => byGroup(''))
  throws(() => byGroup())
})

report()
