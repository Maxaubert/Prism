import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The callers of the one dialog look (#514); the look itself is pinned in the core.
const read = (...p: string[]): string => readFileSync(join(__dirname, '..', '..', '..', '..', ...p), 'utf8')

describe('the callers', () => {
  it('the update window wears dialogButton: no hand-written buttons, no focus ring', () => {
    const src = read('packages', 'term-core', 'renderer', 'components', 'UpdateDialog.tsx')
    expect(src).toContain("from './dialogLook'")
    expect(src).toContain('dialogButton({})')
    expect(src).toContain('dialogButton({ primary: true })')
    expect(src).not.toMatch(/focus-visible:ring/)
    expect(src).not.toContain('disabled:opacity-45')
  })
  it('nothing patches a dialog class string with .replace()', () => {
    for (const f of [
      ['Dialog.tsx'],
      ['ExtractWindow.tsx'],
      ['JobCard.tsx'],
      ['properties', 'PropertiesDialog.tsx']
    ]) {
      const src = read('src', 'renderer', 'src', 'components', ...f)
      expect(src, f.join('/')).not.toMatch(/(DIALOG_BOX|dialogButton\([^)]*\))\s*\.replace\(/)
      expect(src, f.join('/')).not.toContain("max-w-[420px]'")
    }
  })
  it('the stop controls say Cancel (owner, 2026-11-19)', () => {
    const row = read('src', 'renderer', 'src', 'components', 'properties', 'ChecksumRow.tsx')
    expect(row).toContain('dialogButton({ compact: true })')
    expect(row).not.toMatch(/>\s*Stop\s*</)
    expect(row).toMatch(/\n\s+Cancel\r?\n/)
    const search = read('src', 'renderer', 'src', 'components', 'browse', 'BrowseSearchStatus.tsx')
    expect(search).not.toContain('Cancel search')
    expect(search).toContain('>Cancel</button>')
  })
})
