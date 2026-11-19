import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { BinStrip } from './BinStrip'
import { PlaceStrip } from './PlaceStrip'

// The zip strip and the bin strip are one shell (#524).
const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8')

describe('the place strip', () => {
  it('draws the name block, the facts and the verbs, with the place data hooks', () => {
    const html = renderToStaticMarkup(
      createElement(PlaceStrip, { icon: null, name: 'a.zip', nameTitle: 'a', facts: '5 files', data: { 'data-archive-strip': '' }, className: 'x', children: 'verbs' })
    )
    expect(html).toContain('class="browse-place-strip x"')
    expect(html).toContain('<strong title="a">a.zip</strong>')
    expect(html).toContain('browse-place-strip-facts">5 files')
    expect(html).toContain('browse-place-strip-verbs">verbs')
    expect(html).toContain('data-archive-strip')
  })

  it('the bin strip is the shell too, with its own hooks and no archive class names', () => {
    const html = renderToStaticMarkup(createElement(BinStrip, { marked: 1, count: 3, bytes: 2048 }))
    expect(html).toContain('browse-place-strip browse-bin-strip')
    expect(html).toContain('data-bin-count="3"')
    expect(html).toContain('data-bin-verb="restore"')
    expect(html).not.toMatch(/browse-archive-/)
  })

  it('no source or sheet keeps the old browse-archive-strip or browse-archive-button names', () => {
    for (const f of ['ArchiveStrip.tsx', 'BinStrip.tsx', 'ArchiveCard.tsx', 'archive.css', 'bin.css', '../MemberNote.tsx']) {
      expect(src(f), f).not.toMatch(/browse-archive-(strip(?!-drop)|button)/)
    }
    expect(src('ArchiveStrip.tsx')).toMatch(/<PlaceStrip/)
  })
})