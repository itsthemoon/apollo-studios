// scripts/selftest-synth.mjs — self-test for js/synth.js.
// The engine only touches Web Audio, so the test runs it against a recording
// fake context and asserts the node graph and every scheduled parameter.
// Run from the project root:  node scripts/selftest-synth.mjs
import {
  SYNTH_DEFAULTS,
  VOICE_PRESETS,
  presetNames,
  midiToHz,
  MUSICAL_TYPING,
  OCTAVE_KEYS,
  typingMidi,
  resolveParams,
  makeVoice,
  renderNotes,
  stopAll,
  liveVoiceCount,
} from '../js/synth.js'
import { test, ok, eq, near, throws, report } from './lib/assert.mjs'

// --- fake AudioContext -----------------------------------------------------

function param(value = 0) {
  const p = { value, calls: [] }
  p.setValueAtTime = (v, t) => { p.calls.push({ op: 'set', v, t }); return p }
  p.linearRampToValueAtTime = (v, t) => { p.calls.push({ op: 'linear', v, t }); return p }
  p.exponentialRampToValueAtTime = (v, t) => { p.calls.push({ op: 'exp', v, t }); return p }
  p.cancelScheduledValues = (t) => { p.calls.push({ op: 'cancel', t }); return p }
  p.setTargetAtTime = (v, t, c) => { p.calls.push({ op: 'target', v, t, c }); return p }
  return p
}

function makeCtx(now = 0) {
  const ctx = { currentTime: now, sampleRate: 48000, created: [], destination: null }
  const node = (kind) => {
    const n = {
      kind,
      outs: [],
      started: [],
      stopped: [],
      disconnected: false,
      connect(target) { n.outs.push(target); return target },
      disconnect() { n.disconnected = true },
    }
    ctx.created.push(n)
    return n
  }
  ctx.destination = node('destination')
  ctx.node = node
  ctx.createGain = () => Object.assign(node('gain'), { gain: param(1) })
  ctx.createOscillator = () => Object.assign(node('osc'), {
    type: 'sine',
    frequency: param(440),
    detune: param(0),
    onended: null,
    start(t) { this.started.push(t) },
    stop(t) { this.stopped.push(t) },
  })
  ctx.createBiquadFilter = () => Object.assign(node('filter'), {
    type: 'lowpass',
    frequency: param(350),
    Q: param(1),
    detune: param(0),
    gain: param(0),
  })
  ctx.createBufferSource = () => Object.assign(node('noise'), {
    buffer: null,
    loop: false,
    onended: null,
    start(t) { this.started.push(t) },
    stop(t) { this.stopped.push(t) },
  })
  ctx.createBuffer = (channels, length, rate) => ({
    numberOfChannels: channels,
    length,
    sampleRate: rate,
    getChannelData: () => new Float32Array(length),
  })
  return ctx
}

const of = (ctx, kind) => ctx.created.filter((n) => n.kind === kind)
const peakFor = (velocity) => 0.22 * (0.15 + 0.85 * (velocity / 127))

// --- defaults and presets ---------------------------------------------------

test('SYNTH_DEFAULTS carries every required field', () => {
  const keys = ['osc1', 'osc2', 'detuneCents', 'osc2Gain', 'noise', 'cutoff', 'resonance', 'env', 'filterEnv', 'glide']
  eq(Object.keys(SYNTH_DEFAULTS).length, keys.length)
  for (const key of keys) ok(key in SYNTH_DEFAULTS, `missing ${key}`)
})

test('SYNTH_DEFAULTS values match the spec', () => {
  eq(SYNTH_DEFAULTS.osc1, 'sawtooth')
  eq(SYNTH_DEFAULTS.osc2, 'square')
  eq(SYNTH_DEFAULTS.detuneCents, 7)
  eq(SYNTH_DEFAULTS.osc2Gain, 0.35)
  eq(SYNTH_DEFAULTS.noise, 0.05)
  eq(SYNTH_DEFAULTS.cutoff, 2400)
  eq(SYNTH_DEFAULTS.resonance, 1.2)
  eq(SYNTH_DEFAULTS.filterEnv, 0.5)
  eq(SYNTH_DEFAULTS.glide, 0)
})

test('SYNTH_DEFAULTS env is a 0.01 / 0.18 / 0.6 / 0.22 ADSR', () => {
  eq(SYNTH_DEFAULTS.env.a, 0.01)
  eq(SYNTH_DEFAULTS.env.d, 0.18)
  eq(SYNTH_DEFAULTS.env.s, 0.6)
  eq(SYNTH_DEFAULTS.env.r, 0.22)
})

test('defaults are frozen', () => {
  ok(Object.isFrozen(SYNTH_DEFAULTS))
  ok(Object.isFrozen(SYNTH_DEFAULTS.env))
})

test('VOICE_PRESETS ships exactly the six named patches', () => {
  eq(presetNames().join(','), 'keys,pad,bass,pluck,strings,lead')
  for (const name of ['keys', 'pad', 'bass', 'pluck', 'strings', 'lead']) ok(name in VOICE_PRESETS, `missing ${name}`)
  eq(Object.keys(VOICE_PRESETS).length, 6)
})

test('every preset is a complete, frozen patch', () => {
  const keys = Object.keys(SYNTH_DEFAULTS)
  for (const [name, preset] of Object.entries(VOICE_PRESETS)) {
    eq(Object.keys(preset).length, keys.length, `${name} must be complete`)
    for (const key of keys) ok(key in preset, `${name} missing ${key}`)
    eq(Object.keys(preset.env).length, 4, `${name} env must be complete`)
    ok(Object.isFrozen(preset) && Object.isFrozen(preset.env), `${name} must be frozen`)
  }
})

test('every preset overrides the default patch', () => {
  for (const [name, preset] of Object.entries(VOICE_PRESETS)) {
    const differs = Object.keys(SYNTH_DEFAULTS).some((key) => {
      if (key === 'env') return Object.keys(preset.env).some((k) => preset.env[k] !== SYNTH_DEFAULTS.env[k])
      return preset[key] !== SYNTH_DEFAULTS[key]
    })
    ok(differs, `${name} is identical to the defaults`)
  }
})

test('preset pitches are inside the documented ranges', () => {
  for (const [name, preset] of Object.entries(VOICE_PRESETS)) {
    ok(['sawtooth', 'square', 'triangle', 'sine'].includes(preset.osc1), `${name} osc1 wave`)
    ok(['sawtooth', 'square', 'triangle', 'sine'].includes(preset.osc2), `${name} osc2 wave`)
    ok(Math.abs(preset.detuneCents) <= 1200, `${name} detune range`)
    ok(preset.osc2Gain >= 0 && preset.osc2Gain <= 1, `${name} osc2Gain range`)
    ok(preset.noise >= 0 && preset.noise <= 1, `${name} noise range`)
    ok(preset.cutoff >= 40 && preset.cutoff <= 18000, `${name} cutoff range`)
    ok(preset.resonance >= 0.1 && preset.resonance <= 30, `${name} resonance range`)
    ok(preset.filterEnv >= 0 && preset.filterEnv <= 1, `${name} filterEnv range`)
    ok(preset.glide >= 0 && preset.glide <= 2, `${name} glide range`)
    ok(preset.env.r > 0, `${name} needs a release`)
  }
})

test('pad is the slow, dark patch and pluck the short one', () => {
  ok(VOICE_PRESETS.pad.env.a > VOICE_PRESETS.keys.env.a, 'pad attack is the longest')
  ok(VOICE_PRESETS.pluck.env.d < VOICE_PRESETS.strings.env.d, 'pluck decays fastest')
  ok(VOICE_PRESETS.pad.cutoff < VOICE_PRESETS.pluck.cutoff, 'pad is darker than pluck')
  ok(VOICE_PRESETS.bass.cutoff < VOICE_PRESETS.lead.cutoff, 'bass is darker than lead')
})

// --- pitch -----------------------------------------------------------------

test('midiToHz anchors A4 and octaves', () => {
  eq(midiToHz(69), 440)
  eq(midiToHz(57), 220)
  eq(midiToHz(81), 880)
  near(midiToHz(60), 261.625565, 1e-5)
  near(midiToHz(72), 523.251131, 1e-5)
})

test('midiToHz handles the low and edge range', () => {
  near(midiToHz(0), 8.175799, 1e-5)
  near(midiToHz(127), 12543.853951, 1e-4)
  eq(midiToHz(Number.NaN), 0)
  eq(midiToHz(Number.POSITIVE_INFINITY), 0)
})

// --- musical typing --------------------------------------------------------

test('MUSICAL_TYPING maps the home row chromatically to 60..72', () => {
  const noteKeys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k']
  eq(noteKeys.length, 13)
  for (let i = 0; i < noteKeys.length; i++) eq(MUSICAL_TYPING[noteKeys[i]], 60 + i, `key ${noteKeys[i]}`)
})

test('MUSICAL_TYPING shifts octaves on z and x', () => {
  eq(MUSICAL_TYPING.z, -12)
  eq(MUSICAL_TYPING.x, 12)
  eq(OCTAVE_KEYS.z, -1)
  eq(OCTAVE_KEYS.x, 1)
  eq(Object.keys(MUSICAL_TYPING).length, 15)
})

test('every mapped note lands in 60..72', () => {
  for (const [key, value] of Object.entries(MUSICAL_TYPING)) {
    if (key === 'z' || key === 'x') continue
    ok(value >= 60 && value <= 72, `${key} out of bounds`)
  }
})

test('typingMidi resolves keys with an octave offset', () => {
  eq(typingMidi('a'), 60)
  eq(typingMidi('k'), 72)
  eq(typingMidi('a', 1), 72)
  eq(typingMidi('a', -1), 48)
  eq(typingMidi('a', 2), 84)
})

test('typingMidi clamps and rejects non-notes', () => {
  eq(typingMidi('k', 9), 127)
  eq(typingMidi('a', -9), 0)
  eq(typingMidi('z'), null, 'z shifts, it does not sound')
  eq(typingMidi('x'), null)
  eq(typingMidi('q'), null)
  eq(typingMidi('a', Number.NaN), 60)
})

// --- resolveParams ---------------------------------------------------------

test('resolveParams fills the defaults', () => {
  const p = resolveParams()
  eq(p.osc1, 'sawtooth')
  eq(p.cutoff, 2400)
  eq(p.env.s, 0.6)
  eq(p.velocity, 100)
})

test('resolveParams applies a preset', () => {
  const p = resolveParams({ preset: 'pad' })
  eq(p.cutoff, 1400)
  eq(p.osc1, 'sawtooth')
  eq(p.osc2Gain, 0.4)
  near(p.env.a, 0.6, 1e-12)
})

test('resolveParams accepts a bare preset name', () => {
  eq(resolveParams('bass').cutoff, 420)
  eq(resolveParams('lead').filterEnv, 0.6)
})

test('per-call overrides beat the preset', () => {
  const p = resolveParams({ preset: 'bass', cutoff: 900, env: { s: 0.2 } })
  eq(p.cutoff, 900)
  eq(p.env.s, 0.2)
  eq(p.env.d, 0.12, 'non-overridden env fields survive')
})

test('resolveParams clamps every number into range', () => {
  const p = resolveParams({ cutoff: 5, resonance: 99, osc2Gain: -2, noise: 5, filterEnv: 4, glide: 9, detuneCents: 9000 })
  eq(p.cutoff, 40)
  eq(p.resonance, 30)
  eq(p.osc2Gain, 0)
  eq(p.noise, 1)
  eq(p.filterEnv, 1)
  eq(p.glide, 2)
  eq(p.detuneCents, 1200)
  eq(resolveParams({ cutoff: 99999 }).cutoff, 18000)
  eq(resolveParams({ env: { r: 0 } }).env.r > 0, true, 'release has a floor')
})

test('resolveParams replaces unknown waves and non-finite numbers', () => {
  const p = resolveParams({ osc1: 'noise', osc2: 'hiss', cutoff: Number.NaN, env: { a: Number.NaN, s: Number.NaN } })
  eq(p.osc1, 'sawtooth')
  eq(p.osc2, 'square')
  eq(p.cutoff, 2400)
  eq(p.env.a, 0)
  eq(p.env.s, 1)
})

test('resolveParams throws on an unknown preset', () => {
  throws(() => resolveParams({ preset: 'nope' }), 'unknown preset')
})

test('resolveParams returns a fresh env object', () => {
  const a = resolveParams()
  const b = resolveParams()
  ok(a.env !== b.env && a.env !== SYNTH_DEFAULTS.env)
  a.env.a = 3
  eq(resolveParams().env.a, 0.01)
})

// --- voice graph ------------------------------------------------------------

test('makeVoice returns an output gain and a stop function', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, {})
  ok(voice.gain && voice.gain.kind === 'gain')
  eq(typeof voice.stop, 'function')
  voice.stop()
})

test('makeVoice builds exactly two oscillators, a noise source and a filter', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, {})
  eq(of(ctx, 'osc').length, 2)
  eq(of(ctx, 'noise').length, 1)
  eq(of(ctx, 'filter').length, 1)
  eq(voice.sources.length, 3)
  voice.stop()
})

test('makeVoice sets both oscillator waves from params', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, { osc1: 'triangle', osc2: 'sine' }).stop()
  eq(of(ctx, 'osc')[0].type, 'triangle')
  eq(of(ctx, 'osc')[1].type, 'sine')
})

test('the filter is a lowpass at the patch cutoff and resonance', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, { cutoff: 900, resonance: 4 }).stop()
  const filter = of(ctx, 'filter')[0]
  eq(filter.type, 'lowpass')
  eq(filter.frequency.value, 900)
  eq(filter.Q.value, 4)
})

test('the filter env is summed onto detune in cents', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, { filterEnv: 0.5, env: { a: 0.01, d: 0.18 } }).stop()
  const detune = of(ctx, 'filter')[0].detune
  eq(detune.calls[0].op, 'set')
  eq(detune.calls[0].v, 2400, '0.5 env = two octaves')
  eq(detune.calls[0].t, 0)
  eq(detune.calls[1].op, 'linear')
  eq(detune.calls[1].v, 0)
  near(detune.calls[1].t, 0.19, 1e-12)
})

test('oscillator detune carries the patch spread and osc1 stays centred', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, { detuneCents: 12 }).stop()
  eq(of(ctx, 'osc')[0].detune.value, 0)
  eq(of(ctx, 'osc')[1].detune.value, 12)
})

test('both oscillators track the same frequency', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 69, 0, 1, {}).stop()
  eq(of(ctx, 'osc')[0].frequency.calls[0].v, 440)
  eq(of(ctx, 'osc')[1].frequency.calls[0].v, 440)
})

test('the mix gains follow osc2Gain and noise', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, { osc2Gain: 0.4, noise: 0.2 }).stop()
  const gains = of(ctx, 'gain')
  eq(gains.length, 4, 'out + amp + two mix stages')
  ok(gains.some((g) => g.gain.value === 0.4), 'osc2 stage 0.4')
  ok(gains.some((g) => g.gain.value === 0.2), 'noise stage 0.2')
})

test('the voice gain starts silent', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, {})
  eq(voice.gain.gain.value, 1, 'output node is unity')
  const amp = of(ctx, 'gain')[1]
  eq(amp.gain.calls[0].op, 'set')
  eq(amp.gain.calls[0].v, 0)
  eq(amp.gain.calls[0].t, 0)
  voice.stop()
})

test('signal path runs osc/noise -> amp -> filter -> out -> destination', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, {})
  const [osc1, osc2] = of(ctx, 'osc')
  const [noise] = of(ctx, 'noise')
  const [filter] = of(ctx, 'filter')
  const amp = of(ctx, 'gain').find((g) => g.gain.calls.some((c) => c.v === 0 && c.op === 'set'))
  ok(osc1.outs.includes(amp), 'osc1 -> amp')
  ok(osc2.outs.some((n) => n.kind === 'gain'), 'osc2 passes a level stage')
  ok(noise.outs.some((n) => n.kind === 'gain'), 'noise passes a level stage')
  ok(amp.outs.includes(filter), 'amp -> filter')
  ok(filter.outs.includes(voice.gain), 'filter -> output')
  ok(voice.gain.outs.includes(ctx.destination), 'output -> destination')
  voice.stop()
})

test('a custom destination is honoured', () => {
  stopAll()
  const ctx = makeCtx()
  const bus = ctx.node('bus')
  const voice = makeVoice(ctx, 60, 0, 1, { dest: bus })
  ok(voice.gain.outs.includes(bus))
  voice.stop()
})

// --- envelope and velocity --------------------------------------------------

test('the amp envelope is A -> peak, D -> sustain, then release', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, { velocity: 100 })
  const amp = of(ctx, 'gain')[1].gain
  const peak = peakFor(100)
  eq(amp.calls.length, 5)
  near(amp.calls[1].v, peak, 1e-12, 'attack reaches velocity-scaled peak')
  near(amp.calls[1].t, 0.01, 1e-12)
  near(amp.calls[2].v, peak * 0.6, 1e-12, 'decay falls to sustain')
  near(amp.calls[2].t, 0.19, 1e-12)
  near(amp.calls[3].v, peak * 0.6, 1e-12, 'sustain is held to note end')
  near(amp.calls[3].t, 1, 1e-12)
  near(amp.calls[4].v, 0.0001, 1e-12, 'release lands on silence')
  near(amp.calls[4].t, 1.22, 1e-12)
  voice.stop()
})

test('velocity scales the peak, full velocity is the loudest', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, { velocity: 127 }).stop()
  makeVoice(ctx, 60, 0, 1, { velocity: 0 }).stop()
  const amps = of(ctx, 'gain').filter((g) => g.gain.calls.length > 0).map((g) => g.gain)
  near(amps[0].calls[1].v, 0.22, 1e-12, 'velocity 127')
  near(amps[1].calls[1].v, 0.033, 1e-12, 'velocity 0 still audible')
  ok(amps[0].calls[1].v > amps[1].calls[1].v)
})

test('attack and decay squeeze into a very short note', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 0.05, { env: { a: 1, d: 4 } }).stop()
  const amp = of(ctx, 'gain')[1].gain
  near(amp.calls[1].t, 0.02, 1e-12, 'attack is 40% of the note')
  near(amp.calls[2].t, 0.05, 1e-12, 'decay fills the rest')
})

test('a zero and a NaN duration fall back to the 20 ms floor', () => {
  stopAll()
  const ctx = makeCtx()
  const zero = makeVoice(ctx, 60, 0, 0, {})
  eq(zero.sources[0].stopped[0], 0.02 + 0.22 + 0.02)
  const nan = makeVoice(ctx, 60, 0, Number.NaN, {})
  eq(nan.sources[0].stopped[0], 0.02 + 0.22 + 0.02)
  zero.stop()
  nan.stop()
})

test('the sources start and stop around the note', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 2, 0.5, {}).stop()
  for (const source of [...of(ctx, 'osc'), ...of(ctx, 'noise')]) {
    eq(source.started[0], 2, 'starts at the requested time')
    near(source.stopped[0], 2.5 + 0.22 + 0.02, 1e-12)
  }
})

test('glide ramps from the previous note on the context', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 0.5, { glide: 0.1 }).stop()
  eq(of(ctx, 'osc')[0].frequency.calls.length, 1, 'first note has nothing to glide from')
  makeVoice(ctx, 72, 0, 0.5, { glide: 0.1 }).stop()
  const freq = of(ctx, 'osc')[2].frequency
  eq(freq.calls[0].op, 'set')
  eq(freq.calls[0].v, midiToHz(60))
  eq(freq.calls[1].op, 'exp')
  eq(freq.calls[1].v, midiToHz(72))
  near(freq.calls[1].t, 0.1, 1e-12)
})

test('zero glide is a plain set', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 0.5, {}).stop()
  makeVoice(ctx, 72, 0, 0.5, {}).stop()
  eq(of(ctx, 'osc')[2].frequency.calls.length, 1)
  eq(of(ctx, 'osc')[2].frequency.calls[0].op, 'set')
})

// --- stop / stopAll ---------------------------------------------------------

test('stop releases from the live level and is idempotent', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, {})
  const amp = of(ctx, 'gain')[1].gain
  const before = amp.calls.length
  voice.stop(0.5)
  ok(amp.calls.length > before, 'release added')
  eq(amp.calls.at(-1).op, 'linear')
  near(amp.calls.at(-1).t, 0.72, 1e-12)
  eq(of(ctx, 'osc')[0].stopped.at(-1), 0.5 + 0.22 + 0.02)
  const after = amp.calls.length
  voice.stop(0.6)
  eq(amp.calls.length, after, 'second stop is a no-op')
})

test('stop never schedules before the note start', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 4, 1, {})
  voice.stop(1)
  const amp = of(ctx, 'gain')[1].gain
  eq(amp.calls.at(-1).t, 4.22)
})

test('stop removes the voice from the live set', () => {
  stopAll()
  eq(liveVoiceCount(), 0)
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, {}).stop()
  eq(liveVoiceCount(), 0)
})

test('liveVoiceCount tracks running voices', () => {
  stopAll()
  const ctx = makeCtx()
  makeVoice(ctx, 60, 0, 1, {})
  eq(liveVoiceCount(), 1)
  makeVoice(ctx, 62, 0, 1, {})
  eq(liveVoiceCount(), 2)
  stopAll()
  eq(liveVoiceCount(), 0)
})

test('stopAll releases every voice', () => {
  stopAll()
  const ctx = makeCtx()
  const voices = [60, 62, 64].map((m) => makeVoice(ctx, m, 0, 1, {}))
  stopAll(0.1)
  for (const voice of voices) eq(voice.sources[0].stopped.at(-1), 0.1 + 0.22 + 0.02)
  eq(liveVoiceCount(), 0)
})

test('polyphony is capped and steals the oldest voice', () => {
  stopAll()
  const ctx = makeCtx()
  const first = makeVoice(ctx, 60, 0, 1, {})
  for (let m = 40; m < 72; m++) makeVoice(ctx, m, 0, 1, {})
  ok(liveVoiceCount() <= 32)
  ok(first.sources[0].stopped.length > 1, 'oldest voice was stopped')
  stopAll()
})

test('disconnect tears the voice down', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, {})
  voice.disconnect()
  ok(voice.gain.disconnected)
  ok(voice.filter.disconnected)
  for (const source of voice.sources) ok(source.disconnected)
  voice.stop()
})

// --- renderNotes ------------------------------------------------------------

test('renderNotes schedules at currentTime + start', () => {
  stopAll()
  const ctx = makeCtx(5)
  const voices = renderNotes(ctx, [{ midi: 60, start: 0, dur: 1 }, { midi: 67, start: 0.5, dur: 0.5 }])
  eq(voices.length, 2)
  eq(of(ctx, 'osc')[0].started[0], 5)
  eq(of(ctx, 'osc')[2].started[0], 5.5)
  stopAll()
})

test('renderNotes sorts by start and reports voices in that order', () => {
  stopAll()
  const ctx = makeCtx()
  const voices = renderNotes(ctx, [{ midi: 64, start: 2, dur: 0.5 }, { midi: 60, start: 0, dur: 0.5 }])
  eq(voices[0].midi, 60)
  eq(voices[1].midi, 64)
  stopAll()
})

test('renderNotes passes per-note velocity', () => {
  stopAll()
  const ctx = makeCtx()
  renderNotes(ctx, [{ midi: 60, start: 0, dur: 0.5, velocity: 64 }])
  near(of(ctx, 'gain')[1].gain.calls[1].v, peakFor(64), 1e-12)
  stopAll()
})

test('renderNotes defaults a missing velocity to 100', () => {
  stopAll()
  const ctx = makeCtx()
  renderNotes(ctx, [{ midi: 60, start: 0, dur: 0.5 }])
  near(of(ctx, 'gain')[1].gain.calls[1].v, peakFor(100), 1e-12)
  stopAll()
})

test('renderNotes applies shared params to every note', () => {
  stopAll()
  const ctx = makeCtx()
  renderNotes(ctx, [{ midi: 60, start: 0, dur: 0.5 }, { midi: 64, start: 1, dur: 0.5 }], { cutoff: 700, preset: 'pluck' })
  for (const filter of of(ctx, 'filter')) eq(filter.frequency.value, 700)
  stopAll()
})

test('renderNotes skips invalid entries without throwing', () => {
  stopAll()
  const ctx = makeCtx()
  const voices = renderNotes(ctx, [
    { midi: 60, start: 0, dur: 0.5 },
    null,
    { midi: Number.NaN, start: 1, dur: 1 },
    { midi: 62, start: Number.NaN, dur: 1 },
    { midi: 64, start: 1, dur: 0 },
    { midi: 65, start: 1, dur: -1 },
  ])
  eq(voices.length, 1)
  eq(voices[0].midi, 60)
  stopAll()
})

test('renderNotes accepts an empty list and rejects a non-array', () => {
  eq(renderNotes(makeCtx(), []).length, 0)
  throws(() => renderNotes(makeCtx(), 'nope'), 'non-array')
})

test('renderNotes accepts a bare preset name', () => {
  stopAll()
  const ctx = makeCtx()
  renderNotes(ctx, [{ midi: 40, start: 0, dur: 0.5 }], 'bass')
  eq(of(ctx, 'filter')[0].frequency.value, 420)
  stopAll()
})

// --- guards -----------------------------------------------------------------

test('makeVoice rejects a missing context', () => {
  throws(() => makeVoice(null, 60, 0, 1), 'no context')
})

test('makeVoice rejects a non-finite midi', () => {
  const ctx = makeCtx()
  throws(() => makeVoice(ctx, Number.NaN, 0, 1), 'NaN midi')
  throws(() => makeVoice(ctx, 'C4', 0, 1), 'string midi')
})

test('makeVoice clamps midi and negative start times', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 200, -4, 0.5, {})
  eq(voice.midi, 127)
  eq(of(ctx, 'osc')[0].started[0], 0)
  voice.stop()
})

test('a voice with a preset name resolves it', () => {
  stopAll()
  const ctx = makeCtx()
  const voice = makeVoice(ctx, 60, 0, 1, 'bass')
  eq(of(ctx, 'filter')[0].frequency.value, 420)
  voice.stop()
})

report()
