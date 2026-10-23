import { describe, expect, it } from 'vitest'
import { findPaths } from './termPaths'

const paths = (text: string): string[] => findPaths(text).map((p) => p.path)

describe('findPaths', () => {
  it('finds the paths in the owner\'s screenshot, without the sentence round them', () => {
    const line = '- Rapport: docs/sign-off/rapport.pdf, 9 sider. PNG i docs/wireframes/png/. Kilde i docs/wireframes/kilde/, som'
    expect(paths(line)).toEqual(['docs/sign-off/rapport.pdf', 'docs/wireframes/png/', 'docs/wireframes/kilde/'])
  })
  it('says where each one sits in the text', () => {
    const text = 'see (src/app.ts:12:3).'
    const [p] = findPaths(text)
    expect(text.slice(p.start, p.end)).toBe('src/app.ts')
  })
  it('knows Windows paths, absolute and relative, and a bare file name', () => {
    expect(paths('C:\\Users\\me\\notes.txt and docs\\sign-off\\rapport.pdf')).toEqual([
      'C:\\Users\\me\\notes.txt',
      'docs\\sign-off\\rapport.pdf'
    ])
    expect(paths('AGENTS.md points there')).toEqual(['AGENTS.md'])
    expect(paths('../up/one.txt ./here.md ~/home.cfg')).toEqual(['../up/one.txt', './here.md', '~/home.cfg'])
  })
  it('leaves a URL to the link finder', () => {
    expect(paths('https://github.com/a/b/pull/11 and file:///C:/x')).toEqual([])
  })
  it('asks nothing about words, numbers, versions or flags', () => {
    expect(paths('hello world 1.5 0.16.1 --force -rf 12:30 C: / ...')).toEqual([])
  })
  it('reads a path in quotes as the path', () => {
    expect(paths('open "docs/a b.pdf" or \'x/y.md\'')).toEqual(['docs/a', 'b.pdf', 'x/y.md'])
  })
})
