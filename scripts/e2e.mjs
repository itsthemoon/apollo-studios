#!/usr/bin/env node
// scripts/e2e.mjs — run the full suite with a guaranteed server on :4173.
// Reuses a server already listening; otherwise starts one and tears it down.
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PORT = 4173
const BASE = `http://127.0.0.1:${PORT}`
const servePath = fileURLToPath(new URL('./serve.mjs', import.meta.url))

async function up() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) })
    return res.ok || res.status < 500
  } catch {
    return false
  }
}

async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await up()) return true
    await new Promise(r => setTimeout(r, 150))
  }
  return false
}

let child = null

if (await up()) {
  console.log(`e2e: reusing server already on ${BASE}`)
} else {
  child = spawn(process.execPath, [servePath], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT: String(PORT) } })
  child.on('exit', code => { if (code && code !== 0) console.error(`e2e: server exited ${code}`) })
  if (!(await waitForServer())) {
    console.error(`e2e: server never came up on ${BASE}`)
    if (child) child.kill()
    process.exit(1)
  }
  console.log(`e2e: started server on ${BASE}`)
}

const run = spawnSync(process.execPath, ['scripts/test.mjs'], { encoding: 'utf8' })
process.stdout.write(run.stdout || '')
process.stderr.write(run.stderr || '')

if (child) child.kill()

if (run.status !== 0) {
  console.error(`e2e: FAIL (exit ${run.status})`)
  process.exit(run.status ?? 1)
}
if (!(run.stdout || '').includes('ALL CHECKS PASSED')) {
  console.error('e2e: FAIL (no pass marker in output)')
  process.exit(1)
}
console.log('e2e: PASS')
