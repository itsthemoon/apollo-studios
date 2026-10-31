// js/icons.js — the Studio glyph set as one sprite, so every icon is a real
// vector instead of a text character. Call hydrate() after any render.
const NAMES = [
  'menu', 'logo', 'plus', 'undo', 'redo', 'metronome', 'play', 'rewind', 'record',
  'loop', 'scissors', 'zoom-in', 'zoom-out', 'mic', 'keys', 'drum', 'wave', 'plug',
  'guitar', 'bass', 'fx', 'pan', 'bell', 'chat', 'user', 'chevron', 'close', 'edit',
  'bypass', 'heart', 'sparkle', 'speaker', 'sliders', 'list', 'grid', 'globe',
  'crown', 'save', 'chevron-down', 'music', 'headphones', 'automation', 'dot-circle',
  'dots-v', 'dots-h', 'snap', 'stretch', 'skip-back', 'skip-forward', 'mute', 'solo', 'create',
  'export', 'download', 'history', 'lyrics', 'sounds', 'shortcuts', 'invite',
  'autopitch', 'mixer', 'copy', 'trash', 'reverse', 'droplet', 'settings', 'file-plus', 'repeat',
  'addtrack', 'arm', 'editor', 'mastering', 'versions', 'publish'
]

const PATHS = {
  menu: '<path d="M3 5h14M3 10h14M3 15h14"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  undo: '<path d="M7 4 3 8l4 4"/><path d="M3 8h8a5 5 0 0 1 0 10H8"/>',
  redo: '<path d="M13 4l4 4-4 4"/><path d="M17 8H9a5 5 0 0 0 0 10h3"/>',
  metronome: '<path d="M7 3h6l3 14H4z"/><path d="M10 13l3-7"/>',
  play: '<path d="M6 3.5 16 10 6 16.5z"/>',
  rewind: '<path d="M16 3.5 7 10l9 6.5z"/><path d="M7 3.5v13"/>',
  record: '<circle cx="10" cy="10" r="5.5"/>',
  loop: '<path d="M4 8V6a2 2 0 0 1 2-2h8l-2-2"/><path d="M16 12v2a2 2 0 0 1-2 2H6l2 2"/>',
  scissors: '<circle cx="5" cy="15" r="2"/><circle cx="15" cy="15" r="2"/><path d="M6.5 13.5 14 3M13.5 13.5 6 3"/>',
  'zoom-in': '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4M9 6.5v5M6.5 9h5"/>',
  'zoom-out': '<circle cx="9" cy="9" r="5"/><path d="M13 13l4 4M6.5 9h5"/>',
  mic: '<rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3"/>',
  keys: '<rect x="2.5" y="4" width="15" height="11" rx="1.5"/><path d="M6 4v6M10 4v6M14 4v6"/>',
  drum: '<ellipse cx="10" cy="6" rx="6" ry="2.5"/><path d="M4 6v6c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6"/>',
  wave: '<path d="M2 10c2.5-5 4.5 5 7 0s4.5 5 7 0"/>',
  plug: '<path d="M7 3v4M13 3v4"/><path d="M5 7h10v2a5 5 0 0 1-10 0z"/><path d="M10 14v3"/>',
  guitar: '<circle cx="13" cy="12.5" r="4"/><circle cx="13" cy="12.5" r="1.2"/><path d="M10 10 4 4M4 4h3M4 4v3"/>',
  bass: '<circle cx="13.5" cy="13" r="3.5"/><path d="M11 10.5 4 3.5"/>',
  fx: '<path d="M3 10h3l2-5 2 10 2-7 2 4h3"/>',
  pan: '<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5v13"/>',
  bell: '<path d="M10 3a4 4 0 0 0-4 4v3l-2 3h12l-2-3V7a4 4 0 0 0-4-4z"/><path d="M8.5 16a1.6 1.6 0 0 0 3 0"/>',
  chat: '<path d="M3 4h14v9H8l-4 3v-3H3z"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4 17c0-3 2.7-4.5 6-4.5s6 1.5 6 4.5"/>',
  chevron: '<path d="M7 5l5 5-5 5"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
  edit: '<path d="M3 15l1-4L13 3l3 3-9 8z"/>',
  bypass: '<circle cx="10" cy="10" r="6"/><path d="M10 4v12"/>',
  heart: '<path d="M10 16S3 12 3 7.6A3.6 3.6 0 0 1 10 6a3.6 3.6 0 0 1 7 1.6C17 12 10 16 10 16z"/>',
  sparkle: '<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z"/>',
  speaker: '<path d="M3 8h3l4-3v10l-4-3H3z"/><path d="M13 7.5a4 4 0 0 1 0 5"/>',
  sliders: '<path d="M4 5h12M4 10h12M4 15h12"/><circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="9" cy="15" r="1.5"/>',
  list: '<path d="M4 6h12M4 10h12M4 14h8"/>',
  grid: '<rect x="3" y="3" width="6" height="6"/><rect x="11" y="3" width="6" height="6"/><rect x="3" y="11" width="6" height="6"/><rect x="11" y="11" width="6" height="6"/>',
  globe: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c3 3 3 10 0 13M10 3.5c-3 3-3 10 0 13"/>',
  logo: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13"/>',
  bassnote: '<path d="M7 14V5l6-2v9"/><circle cx="5.5" cy="14.5" r="2"/><circle cx="11.5" cy="12.5" r="2"/>',
  crown: '<path d="M3.5 7 5 15.5h10L16.5 7l-4 3L10 4.5 7.5 10z"/>',
  save: '<path d="M3.5 4.5h10l3 3v8h-13z"/><path d="M6.5 4.5v4h6v-4"/><path d="M6.5 15.5V12h7v3.5"/>',
  'chevron-down': '<path d="M5 7.5l5 5 5-5"/>',
  music: '<path d="M7.5 15V5l8-1.6v9.4"/><circle cx="5.5" cy="15.5" r="2"/><circle cx="13.5" cy="13.4" r="2"/>',
  headphones: '<path d="M3.5 12v-2a6.5 6.5 0 0 1 13 0v2"/><rect x="2.5" y="11" width="3.6" height="6" rx="1.6"/><rect x="13.9" y="11" width="3.6" height="6" rx="1.6"/>',
  automation: '<path d="M2.5 15.5 6 11.5l3 3.5 4.5-8L17.5 10"/><circle cx="6" cy="11.5" r="1.3"/><circle cx="13.5" cy="7" r="1.3"/>',
  'dot-circle': '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.3"/>',
  'dots-v': '<circle cx="10" cy="4.6" r="1.25"/><circle cx="10" cy="10" r="1.25"/><circle cx="10" cy="15.4" r="1.25"/>',
  'dots-h': '<circle cx="4.6" cy="10" r="1.25"/><circle cx="10" cy="10" r="1.25"/><circle cx="15.4" cy="10" r="1.25"/>',
  snap: '<path d="M3 10h14"/><path d="M6.5 6.5 3 10l3.5 3.5M13.5 6.5 17 10l-3.5 3.5"/>',
  stretch: '<path d="M10 3v14"/><path d="M6.5 6.5 3.5 10l3 3.5M13.5 6.5 16.5 10l-3 3.5"/>',
  'skip-back': '<path d="M5.5 4v12"/><path d="M16 4.5 8 10l8 5.5z"/>',
  'skip-forward': '<path d="M14.5 4v12"/><path d="M4 4.5 12 10l-8 5.5z"/>',
  mute: '<path d="M2.5 8h3l4-3v10l-4-3h-3z"/><path d="M12.5 7.5l5 5M17.5 7.5l-5 5"/>',
  solo: '<path d="M3.5 12v-2a6.5 6.5 0 0 1 13 0v2"/><rect x="2.5" y="11" width="3.6" height="6" rx="1.6"/><rect x="13.9" y="11" width="3.6" height="6" rx="1.6"/>',
  create: '<rect x="3" y="3" width="14" height="14" rx="3.5"/><path d="M10 6.8v6.4M6.8 10h6.4"/>',
  export: '<path d="M10 13V3.5"/><path d="M6.8 6.5 10 3.2l3.2 3.3"/><path d="M3.5 12.5V16h13v-3.5"/>',
  download: '<path d="M10 3.5V13"/><path d="M6.8 10 10 13.2l3.2-3.2"/><path d="M3.5 12.5V16h13v-3.5"/>',
  history: '<path d="M3.2 10a6.8 6.8 0 1 0 2.1-4.9"/><path d="M3 3.5V8h4.4"/><path d="M10 6.3V10l3 1.8"/>',
  lyrics: '<path d="M3.5 5h9M3.5 9h13M3.5 13h7"/><path d="M14 17.5 18.2 13.2"/>',
  sounds: '<path d="M4 11.5v-3M7 14V6M10 12.5v-5M13 16V4M16 10.5v-1"/>',
  shortcuts: '<rect x="2.5" y="5.5" width="15" height="9" rx="2"/><path d="M5.5 9h1.2M8.5 9h1.2M11.5 9h1.2M14.5 9h.5M6 12.2h8"/>',
  invite: '<circle cx="7.8" cy="7.5" r="2.8"/><path d="M2.5 16.5c0-2.7 2.4-4.2 5.3-4.2"/><path d="M15 9.5v5M12.5 12h5"/>',
  autopitch: '<path d="M6 15.5V5.5l7-1.4v9.4"/><circle cx="4.3" cy="15.8" r="1.8"/><path d="M14.5 5.4l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/>',
  mixer: '<path d="M5 3v5.5M5 12.5V17M10 3v3.5M10 10.5V17M15 3v8.5M15 15.5V17"/><circle cx="5" cy="10" r="1.5"/><circle cx="10" cy="8" r="1.5"/><circle cx="15" cy="13" r="1.5"/>',
  copy: '<rect x="6.5" y="6.5" width="10" height="10" rx="2.2"/><path d="M13 6.5V5.2A1.7 1.7 0 0 0 11.3 3.5H5.2A1.7 1.7 0 0 0 3.5 5.2v6.1A1.7 1.7 0 0 0 5.2 13H6.5"/>',
  trash: '<path d="M3.5 5.8h13"/><path d="M7.5 5.8V3.8h5v2"/><path d="M5.5 5.8 6.4 16.2h7.2l.9-10.4"/><path d="M8.6 8.8v4.4M11.4 8.8v4.4"/>',
  reverse: '<path d="M3.5 10h13"/><path d="M13.5 6.5 17 10l-3.5 3.5"/><path d="M3.5 6.5v7"/>',
  droplet: '<path d="M10 3.2s4.8 5 4.8 8a4.8 4.8 0 0 1-9.6 0c0-3 4.8-8 4.8-8z"/>',
  settings: '<circle cx="10" cy="10" r="2.8"/><path d="M10 2.6v2.2M10 15.2v2.2M2.6 10h2.2M15.2 10h2.2M4.8 4.8l1.6 1.6M13.6 13.6l1.6 1.6M15.2 4.8l-1.6 1.6M6.4 13.6l-1.6 1.6"/>',
  'file-plus': '<path d="M5 3.2h6.2L15 6.8V16.8H5z"/><path d="M11.2 3.2v3.6H15"/><path d="M10 9.8v5M7.5 12.3h5"/>',
  repeat: '<path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H16l-2.4-2.2"/><path d="M16 12v1.5a2.5 2.5 0 0 1-2.5 2.5H4l2.4 2.2"/>',
  // aliases used by panels.js "more" menu keys
  addtrack: '<path d="M10 4v12M4 10h12"/>',
  demo: '<path d="M4 10h2.5l1.8-5 3.4 10 1.8-5H16"/>',
  arm: '<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2.3"/>',
  editor: '<path d="M3 15l1-4L13 3l3 3-9 8z"/>',
  mastering: '<path d="M7.5 15V5l8-1.6v9.4"/><circle cx="5.5" cy="15.5" r="2"/><circle cx="13.5" cy="13.4" r="2"/>',
  versions: '<path d="M3.2 10a6.8 6.8 0 1 0 2.1-4.9"/><path d="M3 3.5V8h4.4"/><path d="M10 6.3V10l3 1.8"/>',
  publish: '<circle cx="10" cy="10" r="6.5"/><path d="M3.5 10h13M10 3.5c3 3 3 10 0 13M10 3.5c-3 3-3 10 0 13"/>'
}

const SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${Object.entries(PATHS).map(([k, d]) => (k === 'logo' ? `<g id="${k}">${d}</g>` : `<g id="${k}">${d}</g>`)).join('')}</svg>`
)}`

export const iconNames = () => NAMES.slice()

// One SVG per element that asked for it: <span data-icon="mic">.
export function hydrate(root = document) {
  root.querySelectorAll('span[data-icon]').forEach((el) => {
    const name = el.dataset.icon
    if (!PATHS[name]) return
    el.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`
    el.removeAttribute('data-icon')
  })
}

export const sprite = SRC
