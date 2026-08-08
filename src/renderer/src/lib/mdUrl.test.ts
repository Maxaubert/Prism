import { describe, expect, it } from 'vitest'
import { isAnchor, isExternal, resolveLocalPath, resolveMdUrl } from './mdUrl'

const BASE = 'C:\\Repo\\Prism'

describe('resolveMdUrl', () => {
  it('resolves a bare relative path against the base folder', () => {
    expect(resolveMdUrl('docs/media/prism.webp', BASE)).toBe(
      `fsmedia://local/${encodeURIComponent('C:\\Repo\\Prism\\docs\\media\\prism.webp')}`
    )
  })

  it('resolves ./ and ../ segments', () => {
    expect(resolveMdUrl('./build/icon.png', BASE)).toBe(
      `fsmedia://local/${encodeURIComponent('C:\\Repo\\Prism\\build\\icon.png')}`
    )
    expect(resolveMdUrl('../shared/logo.png', BASE)).toBe(
      `fsmedia://local/${encodeURIComponent('C:\\Repo\\shared\\logo.png')}`
    )
  })

  it('keeps spaces and other reserved characters safe inside the URL', () => {
    expect(resolveMdUrl('my picture.png', BASE)).toBe(
      `fsmedia://local/${encodeURIComponent('C:\\Repo\\Prism\\my picture.png')}`
    )
  })

  it('accepts a base with a trailing separator', () => {
    expect(resolveMdUrl('a.png', 'C:\\Repo\\Prism\\')).toBe(
      `fsmedia://local/${encodeURIComponent('C:\\Repo\\Prism\\a.png')}`
    )
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

  it('drops an empty url', () => {
    expect(resolveMdUrl('', BASE)).toBe('')
  })
})

describe('resolveLocalPath', () => {
  it('returns the decoded absolute path for a relative link', () => {
    expect(resolveLocalPath('ROADMAP.md', BASE)).toBe('C:\\Repo\\Prism\\ROADMAP.md')
    expect(resolveLocalPath('docs/notes.md', BASE)).toBe('C:\\Repo\\Prism\\docs\\notes.md')
  })

  it('strips a #fragment and ?query from a relative link', () => {
    expect(resolveLocalPath('ROADMAP.md#phases', BASE)).toBe('C:\\Repo\\Prism\\ROADMAP.md')
  })

  it('returns null for external, anchor and dropped urls', () => {
    expect(resolveLocalPath('https://example.com', BASE)).toBeNull()
    expect(resolveLocalPath('#top', BASE)).toBeNull()
    expect(resolveLocalPath('javascript:alert(1)', BASE)).toBeNull()
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
