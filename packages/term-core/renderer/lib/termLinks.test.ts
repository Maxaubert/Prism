import { describe, expect, it } from 'vitest'
import { LINK_BLUE, findLinks, linkColor } from './termLinks'
import { contrastRatio } from './termAnsi'
import { TERM_PRESETS, resolveTermTheme } from './termTheme'

const found = (text: string): string[] => findLinks(text).map((l) => text.slice(l.start, l.end))

describe('findLinks', () => {
  it('finds a link and leaves the sentence\'s full stop out of it', () => {
    // PowerShell's own help text, the owner's screenshot.
    expect(found('  https://go.microsoft.com/fwlink/?LinkID=108518.')).toEqual([
      'https://go.microsoft.com/fwlink/?LinkID=108518'
    ])
  })
  it('finds several, and ignores text that only looks busy', () => {
    expect(found('see http://a.io/x and https://b.dev/y?z=1#top, then C:\\Users\\me')).toEqual([
      'http://a.io/x',
      'https://b.dev/y?z=1#top'
    ])
  })
  it('stops at brackets and quotes that wrap a link', () => {
    expect(found('(https://a.io/x) "https://b.io/y" <https://c.io/z>')).toEqual([
      'https://a.io/x',
      'https://b.io/y',
      'https://c.io/z'
    ])
  })
  it('keeps a bracket that belongs to the link', () => {
    expect(found('https://en.wikipedia.org/wiki/Prism_(optics) is one')).toEqual([
      'https://en.wikipedia.org/wiki/Prism_(optics)'
    ])
  })
  it('does not call a bare scheme a link', () => {
    expect(found('https:// and http://')).toEqual([])
  })
})

describe('linkColor', () => {
  it('is the link blue on a ground where that blue reads', () => {
    expect(linkColor('#000000', '#e6e6e6')).toBe(LINK_BLUE)
  })
  it('moves on a light ground, and stays a blue', () => {
    const c = linkColor('#f4f4f4', '#24292e')
    expect(c).not.toBe(LINK_BLUE)
    expect(contrastRatio(c, '#f4f4f4')).toBeGreaterThanOrEqual(4.5)
    const n = parseInt(c.slice(1), 16)
    expect(n & 255).toBeGreaterThan((n >> 16) & 255) // more blue than red
  })
  it('clears the floor on a ground that is itself blue', () => {
    for (const bg of ['#142033', '#1e3a8a', '#3b82f6', '#60a5fa']) {
      expect(contrastRatio(linkColor(bg, '#ffffff'), bg)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('survives a ground that is not a plain hex', () => {
    expect(contrastRatio(linkColor('rgba(0,0,0,0.5)', '#fff'), '#000000')).toBeGreaterThanOrEqual(4.5)
  })
  it.each(TERM_PRESETS.map((p) => p.id))('%s: a link reads on the theme\'s own ground', (id) => {
    const t = resolveTermTheme(id)
    expect(contrastRatio(linkColor(t.background, t.foreground), t.background)).toBeGreaterThanOrEqual(4.5)
  })
})
