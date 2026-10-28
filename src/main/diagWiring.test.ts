import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// What Prism hands the core's diagnostics, read from the source: main's
// startup cannot run in a unit test, and a missing dep fails silently.
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const call = source.slice(source.indexOf('diag = startDiagnostics({'))
const args = call.slice(0, call.indexOf('\n  })'))

describe("Prism's diagnostics wiring (perf review, 2026-10-28)", () => {
  it('passes the process metrics, so the memory crumbs and mem-high are written', () => {
    expect(args).toMatch(/appMetrics: \(\) => app\.getAppMetrics\(\)/)
  })
})
