import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DialogName } from '../components/DialogName'
import { DIALOG_EMPHASIS } from 'prism-term-core/renderer/components/dialogLook'
import { nameOrCount } from './dialogName'

describe('DialogName (#512)', () => {
  it('draws the name in the theme text colour, without quotes', () => {
    expect(DIALOG_EMPHASIS).toBe('text-[var(--p-text)]')
    expect(renderToStaticMarkup(createElement(DialogName, null, 'a.txt'))).toBe(
      '<span class="text-[var(--p-text)]">a.txt</span>'
    )
  })

  it('titles say the name for one item and a count for more', () => {
    expect(nameOrCount(['a.txt'], 1, 'item')).toBe('a.txt')
    expect(nameOrCount(['a', 'b'], 12, 'item')).toBe('12 items')
    expect(nameOrCount([], 1, 'item')).toBe('1 item')
  })

  it('no dialog wraps a name in quotes', () => {
    const dir = __dirname
    const files = [
      ...readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && f !== 'testing.ts').map((f) => join(dir, f)),
      join(dir, '../components/archive/archiveOps.ts')
    ]
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/"\$\{|\\"\$\{/)
    }
  })
})