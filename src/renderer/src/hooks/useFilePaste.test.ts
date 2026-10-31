import { describe, expect, it } from 'vitest'
import { PASTE_MESSAGES, pasteMessage, pasteMoves, type PasteResult } from './useFilePaste'

const answer = (r: Partial<PasteResult>): PasteResult => ({ pasted: 0, failed: 0, paths: [], ...r })

describe('pasteMessage: one table for the Explorer and the tree', () => {
  it('says why nothing landed', () => {
    expect(pasteMessage(answer({ empty: true }))).toBe('There are no files on the clipboard.')
    expect(pasteMessage(answer({ refused: true }))).toBe('This folder is not available for pasting.')
    expect(pasteMessage(answer({ refused: true }), PASTE_MESSAGES.refusedTab)).toBe(
      'That folder is outside this tab.'
    )
    expect(pasteMessage(answer({}))).toBe('Nothing could be pasted here.')
  })

  it('counts a partial paste and is quiet about a whole one', () => {
    expect(pasteMessage(answer({ pasted: 2, failed: 1, paths: ['a', 'b'] }))).toBe(
      'Pasted 2, but 1 could not be copied.'
    )
    expect(pasteMessage(answer({ pasted: 2, paths: ['a', 'b'] }))).toBeNull()
  })
})

describe('pasteMoves: a cut and paste, for the folder icons to follow', () => {
  it('pairs what main moved with where it landed, as main says', () => {
    expect(
      pasteMoves(answer({ moved: true, pasted: 2, from: ['C:/a/x', 'C:/a/y'], paths: ['C:/b/x', 'C:/b/y (2)'] }))
    ).toEqual([
      { from: 'C:/a/x', to: 'C:/b/x' },
      { from: 'C:/a/y', to: 'C:/b/y (2)' }
    ])
  })
  it('a part that landed still carries its icon; a copy moves nothing', () => {
    expect(pasteMoves(answer({ pasted: 1, from: ['C:/a/x'], paths: ['C:/b/x'] }))).toEqual([])
    expect(
      pasteMoves(answer({ moved: true, pasted: 1, failed: 1, from: ['C:/a/y'], paths: ['C:/b/y'] }))
    ).toEqual([{ from: 'C:/a/y', to: 'C:/b/y' }])
  })
  it("never pairs by the renderer's own cut: another app's cut is not Prism's", () => {
    // Prism cut A, then File Explorer cut Z and Prism pasted: main moved Z.
    expect(pasteMoves(answer({ moved: true, pasted: 1, from: ['C:/elsewhere/Z'], paths: ['C:/dest/Z'] }))).toEqual([
      { from: 'C:/elsewhere/Z', to: 'C:/dest/Z' }
    ])
    // An answer without the pairs (an older main) moves nothing.
    expect(pasteMoves(answer({ moved: true, pasted: 1, paths: ['C:/dest/Z'] }))).toEqual([])
  })
})
