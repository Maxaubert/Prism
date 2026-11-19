import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// One spinner and one way to write a loading hint (#524).
const src = (p: string): string => readFileSync(join(__dirname, '..', p), 'utf8')

describe('the one spinner', () => {
  const spinner = src('components/LoadingState.tsx')

  it('fades in late and slows down under reduced motion, wherever it shows', () => {
    expect(spinner).toMatch(/delayed-loader \$\{className\}/)
    expect(spinner).toMatch(/motion-reduce:\[animation-duration:2s\]/)
    expect(spinner).not.toMatch(/delayed-loader grid/)
  })

  it('the search popup uses it, with no spinner of its own', () => {
    expect(src('components/browse/BrowseSearchPopup.tsx')).toMatch(/<Spinner small className="browse-search-popup-spin" \/>/)
    const css = src('components/browse/search-popup.css')
    expect(css).not.toMatch(/keyframes|animation|border-top-color/)
  })
})

describe('loading hints', () => {
  const files = [
    'components/ArchiveView.tsx',
    'components/PhoneDialog.tsx',
    'phone/Browser.tsx',
    'phone/PhoneApp.tsx',
    'phone/PhoneViewer.tsx',
    'phone/Places.tsx'
  ]

  it('use the one ellipsis character, never three dots', () => {
    for (const f of files) expect(src(f), f).not.toMatch(/(Loading|Searching|Preparing|Reading|Connecting|Opening[^`\n]*)\.\.\./)
    expect(src('phone/Browser.tsx')).toContain('Searching…')
    expect(src('phone/PhoneViewer.tsx')).toContain('Preparing…')
  })

  it('a folder never shows loading text (#271): the phone, a zip and the icon picker stay quiet', () => {
    expect(src('phone/Browser.tsx')).not.toMatch(/>Loading/)
    expect(src('phone/Places.tsx')).not.toMatch(/Loading/)
    expect(src('components/ArchiveView.tsx')).not.toMatch(/>loading/i)
    expect(src('components/iconGrid/FolderIconPicker.tsx')).not.toMatch(/Loading icons/)
  })
})