// Bounce and freeze: one track's regions squeezed into one buffer of the take's
// length, so the transport can play a rendered file instead of re-reading the
// take window by window. Pure — samples in, samples out, no DOM.
//
// A region covers `startBeat..startBeat+lengthBeats` of the take at `bpm`.
// `gain` is linear, `fadeIn`/`fadeOut` are in beats, `stretch` is 1 (off) or 2
// (half speed), `reverse` plays the window backwards.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function sampleAt(take, pos) {
  if (pos <= 0) return 0
  const last = take.length - 1
  if (pos >= last) return take[last]
  const i = Math.floor(pos)
  const frac = pos - i
  return take[i] * (1 - frac) + take[i + 1] * frac
}

// Returns { data, peak } where data is as long as the take. Overlapping regions
// sum, which is what a bounce of a layered track should do.
export function renderRegions(take, bpm, regions, rate) {
  if (!take?.length) return { data: new Float32Array(0), peak: 0 }
  if (!(bpm > 0) || !(rate > 0)) throw new Error('bounce needs a positive bpm and sample rate')
  const out = new Float32Array(take.length)
  const beatsPer = 60 / bpm
  for (const region of regions || []) {
    const stretch = region.stretch === 2 ? 2 : 1
    const lenBeats = Math.max(1e-6, region.lengthBeats || 0)
    const gain = Number.isFinite(region.gain) ? region.gain : 1
    const fadeIn = clamp01((region.fadeIn || 0) / lenBeats)
    const fadeOut = clamp01((region.fadeOut || 0) / lenBeats)
    const from = (region.startBeat || 0) * beatsPer * rate
    const span = lenBeats * beatsPer * rate
    const at = Math.round((region.startBeat || 0) * beatsPer * rate)
    const frames = Math.floor(span / stretch)
    for (let i = 0; i < frames; i++) {
      const target = at + i
      if (target < 0 || target >= out.length) continue
      const pos = region.reverse ? from + span - 1 - i * stretch : from + i * stretch
      let env = gain
      const frac = i / Math.max(1, frames)
      if (fadeIn > 0 && frac < fadeIn) env *= frac / fadeIn
      if (fadeOut > 0 && frac > 1 - fadeOut) env *= (1 - frac) / fadeOut
      out[target] += sampleAt(take, pos) * env
    }
  }
  let peak = 0
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]))
  return { data: out, peak }
}

// Track-level wrapper: uses the track's own regions, region 0 included.
export function renderTrack(take, bpm, track, rate) {
  const regions = [track.clip, ...(Array.isArray(track.clips) ? track.clips : [])].filter(Boolean)
  const out = renderRegions(take, bpm, regions, rate)
  return { ...out, regions: regions.length }
}

// What the transport plays for a track: a frozen/bounced buffer when one
// exists, otherwise null so the caller stays on the live take.
export function trackSource(track) {
  if (!track?.bounced?.data?.length) return null
  return track.bounced
}
