import { describe, expect, it } from 'vitest'
import { fileKind, isMarkdown, isViewable } from './fileKind'

describe('fileKind', () => {
  it('keeps the kinds it already knew', () => {
    expect(fileKind('.png')).toBe('image')
    expect(fileKind('.mkv')).toBe('video')
    expect(fileKind('.flac')).toBe('audio')
    expect(fileKind('.pdf')).toBe('pdf')
    expect(fileKind('.md')).toBe('text')
    expect(fileKind('.exe')).toBe('other')
  })

  it('reads source files as text', () => {
    for (const ext of ['.py', '.rs', '.go', '.cs', '.ps1', '.sh', '.toml', '.scss', '.vue', '.sql'])
      expect(fileKind(ext), ext).toBe('text')
  })

  it('is case-insensitive about extensions', () => {
    expect(fileKind('.PY')).toBe('text')
    expect(fileKind('.Rs')).toBe('text')
  })

  // The name argument is optional, and Filesmith calls fileKind without it.
  it('still answers from the extension alone', () => {
    expect(fileKind('.ts')).toBe('text')
    expect(fileKind('')).toBe('other')
  })

  it('recognises files whose name carries the kind', () => {
    expect(fileKind('', 'Dockerfile')).toBe('text')
    expect(fileKind('', 'Makefile')).toBe('text')
    expect(fileKind('', 'LICENSE')).toBe('text')
    expect(fileKind('', 'jenkinsfile')).toBe('text')
  })

  it('recognises config dotfiles', () => {
    expect(fileKind('', '.gitignore')).toBe('text')
    expect(fileKind('', '.npmrc')).toBe('text')
  })

  it('does not claim an unknown bare name', () => {
    expect(fileKind('', 'setup')).toBe('other')
    expect(fileKind('', 'a.out')).toBe('other')
  })

  // A dotfile with a second dot has a real extension; that is what should decide.
  it('lets a dotfile with an extension answer on its extension', () => {
    expect(fileKind('.json', '.eslintrc.json')).toBe('text')
    expect(fileKind('.png', '.hidden.png')).toBe('image')
  })

  it('never lets the name overrule a known extension', () => {
    expect(fileKind('.mp4', 'readme.mp4')).toBe('video')
  })
})

describe('isViewable', () => {
  it('follows fileKind, name and all', () => {
    expect(isViewable('.rb')).toBe(true)
    expect(isViewable('.dll')).toBe(false)
    expect(isViewable('', 'Dockerfile')).toBe(true)
    expect(isViewable('', 'Dockerfile.bak')).toBe(false)
  })
})

describe('isMarkdown', () => {
  it('is the one list: md, markdown, mdown, mkd, mkdn', () => {
    for (const name of ['a.md', 'a.markdown', 'a.mdown', 'a.mkd', 'a.mkdn', 'C:\\docs\\README.MD']) {
      expect(isMarkdown(name), name).toBe(true)
      expect(fileKind(name.slice(name.lastIndexOf('.')).toLowerCase()), name).toBe('text')
    }
  })

  it('leaves a Makefile include and MDX as plain text', () => {
    expect(isMarkdown('rules.mk')).toBe(false)
    expect(isMarkdown('page.mdx')).toBe(false)
    expect(fileKind('.mk')).toBe('text')
    expect(fileKind('.mdx')).toBe('text')
  })

  it('reads the name, not a folder that looks like one', () => {
    expect(isMarkdown('C:\\notes.md\\photo.jpg')).toBe(false)
    expect(isMarkdown('notes')).toBe(false)
  })
})
