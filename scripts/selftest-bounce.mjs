import { renderRegions, renderTrack, trackSource } from '../js/bounce.js'
import { ok, throws, report } from './lib/assert.mjs'

// 8 beats at 120 bpm, 1 kHz: one second per two beats, 8000 samples.
const rate = 1000
const take = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 20))
const bpm = 120

// a full-length region at unity gain is the take back, sample for sample
const whole = renderRegions(take, bpm, [{ startBeat: 0, lengthBeats: 16, gain: 1 }], rate)
ok(whole.data.length === take.length, 'the bounce is take-length')
ok(Math.abs(whole.data[4321] - take[4321]) < 1e-6, 'unity regions pass the take through')

// a region starting at beat 4 lands four beats (2 s) in
const late = renderRegions(take, bpm, [{ startBeat: 4, lengthBeats: 2, gain: 1 }], rate)
ok(Math.abs(late.data[2000] - take[2000]) < 1e-6, 'a region lands at its beat')
ok(late.data[0] === 0, 'and leaves the front silent')
ok(late.data[3500] === 0, 'and stops at its own end')

// gain is applied
const hot = renderRegions(take, bpm, [{ startBeat: 0, lengthBeats: 16, gain: 0.5 }], rate)
ok(Math.abs(hot.data[1000] - take[1000] * 0.5) < 1e-6, 'region gain scales the samples')

// fades ramp from silence
const faded = renderRegions(take, bpm, [{ startBeat: 0, lengthBeats: 8, gain: 1, fadeIn: 2 }], rate)
ok(Math.abs(faded.data[0]) < 1e-6, 'a fade-in starts at silence')
ok(Math.abs(faded.data[2000]) > Math.abs(faded.data[500]), 'and opens up')

// reverse plays the window backwards
const rev = renderRegions(take, bpm, [{ startBeat: 0, lengthBeats: 2, gain: 1, reverse: true }], rate)
ok(Math.abs(rev.data[0] - take[999]) < 1e-6, 'reverse starts at the window end')
ok(Math.abs(rev.data[999] - take[0]) < 1e-6, 'and ends at the window start')

// stretch x2 halves the played length
const slow = renderRegions(take, bpm, [{ startBeat: 0, lengthBeats: 2, gain: 1, stretch: 2 }], rate)
ok(Math.abs(slow.data[200]) > 0, 'stretch still writes inside its slot')
ok(slow.data[1100] === 0, 'but only half as far')

// regions sum, and the peak comes back
const two = renderRegions(take, bpm, [{ startBeat: 0, lengthBeats: 2, gain: 1 }, { startBeat: 0, lengthBeats: 2, gain: 1 }], rate)
ok(Math.abs(two.data[500] - take[500] * 2) < 1e-6, 'stacked regions sum')
ok(two.peak > 1, 'and the peak reports it')

// track wrapper uses region 0 and the extras
const track = { clip: { startBeat: 0, lengthBeats: 1 }, clips: [{ startBeat: 2, lengthBeats: 1 }] }
const rendered = renderTrack(take, bpm, track, rate)
ok(rendered.regions === 2, 'renderTrack takes region 0 plus the extras')
ok(rendered.data.length === take.length, 'renderTrack keeps the take length')

ok(trackSource({}) === null, 'no bounce reads as null')
ok(trackSource({ bounced: { data: take } })?.data === take, 'a bounce is the source')

throws(() => renderRegions(take, 0, [], rate), 'zero bpm throws rather than dividing by zero')

ok(renderRegions(new Float32Array(0), bpm, [], rate).data.length === 0, 'an empty take is empty, not an error')

report()
