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
  it('pairs the cut with what landed, in order', () => {
    expect(pasteMoves(['C:/a/x', 'C:/a/y'], answer({ moved: true, pasted: 2, paths: ['C:/b/x', 'C:/b/y (2)'] }))).toEqual([
      { from: 'C:/a/x', to: 'C:/b/x' },
      { from: 'C:/a/y', to: 'C:/b/y (2)' }
    ])
  })
  it('a copy, or a move that did not all land, moves nothing', () => {
    expect(pasteMoves(['C:/a/x'], answer({ pasted: 1, paths: ['C:/b/x'] }))).toEqual([])
    expect(pasteMoves(['C:/a/x', 'C:/a/y'], answer({ moved: true, pasted: 1, failed: 1, paths: ['C:/b/x'] }))).toEqual([])
  })
})
