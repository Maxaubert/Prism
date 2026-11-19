import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ONE MODAL SHELL, ONE SCRIM (#513): Prism's own Modal had no Tab trap and its
// own tint (55% and no blur, against the core's 50% and 2px, against the
// search popup's 35% and 6px). The core's Modal is the shell now, and the
// tint is the one token `--p-scrim`.
const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8')

describe('the one modal shell', () => {
  it('Prism has no Modal of its own and no second scrim string', () => {
    expect(existsSync(join(__dirname, 'Modal.tsx'))).toBe(false)
    expect(readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'term-core', 'renderer', 'components', 'dialogLook.ts'), 'utf8')).not.toContain('DIALOG_SCRIM')
    expect(src('ExtractWindow.tsx')).not.toContain('z-[90]')
  })
  it('every dialog is the core Modal', () => {
    const core = "from 'prism-term-core/renderer/components/Modal'"
    for (const f of [
      'Dialog.tsx',
      'ExtractWindow.tsx',
      join('..', 'dialogs', 'DeleteQuestion.tsx')
    ]) {
      expect(src(f), f).toContain(core)
    }
  })
  it('the extraction window is the locked Modal', () => {
    expect(src('ExtractWindow.tsx')).toMatch(/<Modal\s+locked/)
  })
  it('the search popup and the dialogs take their tint from --p-scrim', () => {
    expect(src(join('browse', 'search-popup.css'))).toContain('var(--p-scrim)')
    expect(readFileSync(join(__dirname, '..', 'index.css'), 'utf8')).toMatch(
      /--p-scrim:\s*rgb\(0 0 0 \/ 0\.5\)/
    )
  })
})
