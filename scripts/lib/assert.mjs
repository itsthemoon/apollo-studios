// Minimal assertion harness. No dependencies, deterministic exit codes.
const results = []
let current = 'unnamed'

export function test(name, fn) {
  current = name
  const before = results.length
  try {
    fn()
    if (results.length === before) results.push({ name, ok: true, note: '' })
  } catch (err) {
    results.push({ name, ok: false, note: err?.message || String(err) })
  }
}

export async function testAsync(name, fn) {
  current = name
  const before = results.length
  try {
    await fn()
    if (results.length === before) results.push({ name, ok: true, note: '' })
  } catch (err) {
    results.push({ name, ok: false, note: err?.message || String(err) })
  }
}

export function ok(value, msg = 'expected truthy') {
  if (!value) throw new Error(`${current}: ${msg}`)
  results.push({ name: current, ok: true, note: msg })
}

export function eq(actual, expected, msg = '') {
  if (actual !== expected) throw new Error(`${current}: expected ${fmt(expected)}, got ${fmt(actual)} ${msg}`)
  results.push({ name: current, ok: true, note: msg })
}

export function near(actual, expected, tol, msg = '') {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tol) {
    throw new Error(`${current}: expected ${expected} ±${tol}, got ${fmt(actual)} ${msg}`)
  }
  results.push({ name: current, ok: true, note: msg })
}

export function throws(fn, msg = 'expected throw') {
  try { fn() } catch { results.push({ name: current, ok: true, note: msg }); return }
  throw new Error(`${current}: ${msg}`)
}

function fmt(v) {
  if (typeof v === 'number') return String(Number(v.toFixed(6)))
  return JSON.stringify(v)?.slice(0, 120) ?? String(v)
}

export function report() {
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    if (!r.ok) console.log(`FAIL ${r.name} — ${r.note}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log(`FAILURES: ${failed.length}`)
    process.exitCode = 1
  } else {
    console.log('ALL CHECKS PASSED')
  }
  return { total: results.length, failed: failed.length }
}
