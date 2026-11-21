import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// A zip member's viewer is the same Viewer on the unpacked copy. If its props
// leave out `preview` or `shut`, the film in a zip keeps playing behind the
// Explorer list and shows the cog and fullscreen button (audit #4).
describe('Viewer member props (audit #4)', () => {
  it('hand preview and shut on to the member viewer', () => {
    const src = readFileSync(join(__dirname, 'Viewer.tsx'), 'utf8')
    const block = /if \(file\.member\) \{\s*const props = \{([\s\S]*?)\}\s*const gate/.exec(src)
    expect(block).not.toBeNull()
    expect(block![1]).toMatch(/\bpreview\b/)
    expect(block![1]).toMatch(/\bshut\b/)
  })
})