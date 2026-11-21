import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The setup pages in a short window (audit #40): Shell clips, so the step column has to scroll, or the footer
// buttons sit below the window edge where a mouse cannot reach them.
const src = readFileSync(join(__dirname, 'Onboarding.tsx'), 'utf8')

describe('the setup pages in a short window', () => {
  it('the step column scrolls', () => {
    expect(src).toMatch(/ob-deal absolute inset-0 z-20 flex flex-col overflow-y-auto/)
  })
  it('the welcome page scrolls too', () => {
    expect(src).toMatch(/grid h-full place-items-center overflow-y-auto/)
  })
})