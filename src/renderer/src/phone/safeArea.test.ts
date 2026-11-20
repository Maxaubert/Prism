import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8')

describe('the phone page keeps clear of a landscape notch (audit #52)', () => {
  it('pads the page root on the left and right with the safe-area insets', () => {
    const css = read('phone.css')
    const root = /#root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(root).toContain('padding-left: env(safe-area-inset-left)')
    expect(root).toContain('padding-right: env(safe-area-inset-right)')
  })
  it('the fixed drawer pads itself, since it is outside the root padding', () => {
    expect(read('Browser.tsx')).toMatch(/fixed inset-0 z-20 flex pl-\[env\(safe-area-inset-left\)\]/)
  })
})