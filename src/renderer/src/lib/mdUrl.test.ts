import { describe, expect, it } from 'vitest'
import { isAnchor, isExternal, resolveMdUrl } from './mdUrl'

const BASE = 'C:\\Repo\\Prism'
const local = (p: string): string => `fsmedia://local/${encodeURIComponent(p)}`

describe('resolveMdUrl', () => {
  it('resolves a bare relative path against the base folder', () => {
    expect(resolveMdUrl('docs/media/prism.webp', BASE)).toBe(
      local('C:\\Repo\\Prism\\docs\\media\\prism.webp')
    )
  })

  it('resolves ./ and ../ segments', () => {
    expect(resolveMdUrl('./build/icon.png', BASE)).toBe(local('C:\\Repo\\Prism\\build\\icon.png'))
    expect(resolveMdUrl('../shared/logo.png', BASE)).toBe(local('C:\\Repo\\shared\\logo.png'))
  })

  it('decodes what the markdown pipeline already percent-encoded', () => {
    // remark/mdast normalize URLs before the transform runs: a space arrives as
    // %20 and must not end up double-encoded (the file on disk has a space).
    expect(resolveMdUrl('my%20picture.png', BASE)).toBe(local('C:\\Repo\\Prism\\my picture.png'))
    expect(resolveMdUrl('docs/caf%C3%A9.png', BASE)).toBe(local('C:\\Repo\\Prism\\docs\\café.png'))
  })

  it('takes malformed percent sequences literally', () => {
    expect(resolveMdUrl('100%.png', BASE)).toBe(local('C:\\Repo\\Prism\\100%.png'))
  })

  it('strips a #fragment and ?query from a relative link', () => {
    expect(resolveMdUrl('ROADMAP.md#phases', BASE)).toBe(local('C:\\Repo\\Prism\\ROADMAP.md'))
    expect(resolveMdUrl('notes.md?x=1', BASE)).toBe(local('C:\\Repo\\Prism\\notes.md'))
  })

  it('accepts a base with a trailing separator', () => {
    expect(resolveMdUrl('a.png', 'C:\\Repo\\Prism\\')).toBe(local('C:\\Repo\\Prism\\a.png'))
  })

  it('passes web, data-image and fsmedia URLs through untouched', () => {
    const badge = 'https://img.shields.io/badge/License-MIT-22b364?style=flat-square'
    expect(resolveMdUrl(badge, BASE)).toBe(badge)
    expect(resolveMdUrl('http://example.com/x.png', BASE)).toBe('http://example.com/x.png')
    expect(resolveMdUrl('data:image/png;base64,AAAA', BASE)).toBe('data:image/png;base64,AAAA')
    expect(resolveMdUrl('fsmedia://local/x', BASE)).toBe('fsmedia://local/x')
  })

  it('passes in-page anchors through', () => {
    expect(resolveMdUrl('#build-from-source', BASE)).toBe('#build-from-source')
  })

  it('drops scripting and unknown protocols', () => {
    expect(resolveMdUrl('javascript:alert(1)', BASE)).toBe('')
    expect(resolveMdUrl('vbscript:x', BASE)).toBe('')
    expect(resolveMdUrl('file:///C:/Windows', BASE)).toBe('')
    expect(resolveMdUrl('data:text/html,<script>', BASE)).toBe('')
  })

  it('drops protocol-relative URLs', () => {
    expect(resolveMdUrl('//evil.example/x.png', BASE)).toBe('')
  })

  it('drops an empty url, and a url that is only a query', () => {
    expect(resolveMdUrl('', BASE)).toBe('')
    expect(resolveMdUrl('?only=query', BASE)).toBe('')
  })

  it('builds a local url through the injected scheme, so the phone gets its own', () => {
    // The phone's bridge answers `/m/<path>?t=<token>` where the PC's answers
    // fsmedia://; the policy is the same, only the last step differs.
    const phone = (p: string): string => `/m/${encodeURIComponent(p)}?t=tok`
    expect(resolveMdUrl('docs/pic.png', BASE, phone)).toBe(phone('C:\\Repo\\Prism\\docs\\pic.png'))
    // What is not local never reaches it.
    const seen: string[] = []
    const spy = (p: string): string => {
      seen.push(p)
      return p
    }
    expect(resolveMdUrl('https://x.example/a.png', BASE, spy)).toBe('https://x.example/a.png')
    expect(resolveMdUrl('javascript:alert(1)', BASE, spy)).toBe('')
    expect(resolveMdUrl('#top', BASE, spy)).toBe('#top')
    expect(seen).toEqual([])
  })
})

describe('classifiers', () => {
  it('isExternal', () => {
    expect(isExternal('https://example.com')).toBe(true)
    expect(isExternal('http://example.com')).toBe(true)
    expect(isExternal('docs/x.md')).toBe(false)
    expect(isExternal('#top')).toBe(false)
  })
  it('isAnchor', () => {
    expect(isAnchor('#top')).toBe(true)
    expect(isAnchor('docs/x.md#top')).toBe(false)
  })
})
