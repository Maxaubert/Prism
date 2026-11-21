import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The seek maps the pointer over the scrubber's whole box (audit #70), so the scrubber has no padding of its own.
describe('the scrubber has no padding of its own', () => {
  it('no Scrubber is given a px- class', () => {
    const src = readFileSync(join(__dirname, 'Transport.tsx'), 'utf8')
    const uses = src.match(/<Scrubber [^>]*>/g) ?? []
    expect(uses.length).toBeGreaterThan(5)
    for (const u of uses) expect(u).not.toMatch(/className="[^"]*\bp[xlr]-/)
  })
})