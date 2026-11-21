import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SLOTS } from './highlightSlots'

// Each PDF viewer paints under its own numbered names (audit #55); the
// stylesheet has to know every number, or a highlight is drawn unstyled.
describe('the PDF find highlight names', () => {
  it('are styled for every slot', () => {
    const css = readFileSync(new URL('../assets/pdf.css', import.meta.url), 'utf8')
    for (let n = 1; n <= SLOTS; n += 1) {
      expect(css).toContain(`::highlight(p-find-${n})`)
      expect(css).toContain(`::highlight(p-find-here-${n})`)
    }
  })
})