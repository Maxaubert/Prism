import { describe, expect, it } from 'vitest'
import { findRoute, hasOwnFind, type FindSelection } from './findRoute'

// The owner's rule, 2026-11-04 (findRoute.ts quotes it).
describe('findRoute', () => {
  const at = (selection: FindSelection, from: 'preview' | 'explorer', previewFind = true) =>
    findRoute({ selection, from, previewFind })

  it('a selected file with its own find opens that find, from the list too', () => {
    for (const kind of ['pdf', 'doc', 'text'] as const)
      expect(at(kind, 'explorer')).toBe('preview-find')
  })
  it("a folder, nothing selected, or a file with no find is the Explorer's search", () => {
    for (const s of [
      'folder',
      'none',
      'image',
      'video',
      'audio',
      'archive',
      'comic',
      'other'
    ] as const)
      expect(at(s, 'explorer')).toBe('explorer-search')
  })
  it('from the preview, its find, whatever row is selected (a PDF still previewed under a folder row)', () => {
    for (const s of ['folder', 'none', 'image', 'pdf'] as const)
      expect(at(s, 'preview')).toBe('preview-find')
  })
  it("no find on screen in the preview is always the Explorer's search", () => {
    expect(at('pdf', 'explorer', false)).toBe('explorer-search')
    expect(at('folder', 'preview', false)).toBe('explorer-search')
    expect(at('image', 'preview', false)).toBe('explorer-search')
  })
  it('hasOwnFind is the PDF, document and text kinds only', () => {
    expect(hasOwnFind('pdf')).toBe(true)
    expect(hasOwnFind('doc')).toBe(true)
    expect(hasOwnFind('text')).toBe(true)
    expect(hasOwnFind('folder')).toBe(false)
    expect(hasOwnFind('none')).toBe(false)
    expect(hasOwnFind('image')).toBe(false)
  })
})
