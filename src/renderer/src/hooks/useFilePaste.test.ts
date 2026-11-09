import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFilePaths, fileCutPaths } from '../lib/fileClipboard'
import { resetHolds } from '../lib/holds'
import { resetJobs } from '../lib/jobs'
import { PASTE_MESSAGES, pasteMessage, pasteMoves, useFilePaste, type PasteResult } from './useFilePaste'

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

describe('a cut whose paste was stopped (the loading bar, review 2026-11-09)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetHolds()
    resetJobs()
  })
  async function paste(result: Partial<PasteResult>): Promise<void> {
    vi.stubGlobal('window', {
      prism: {
        copyFilesToClipboard: vi.fn(async () => true),
        pasteInto: vi.fn(async () => answer(result)),
        cancelFileJob: vi.fn(async () => true)
      }
    })
    await copyFilePaths(['C:/a/x', 'C:/a/y'], true)
    let run!: (directory: string) => Promise<void>
    function Probe(): null {
      run = useFilePaste(() => {}, () => {})
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    await run('C:/b')
  }

  it('keeps its marks: what did not move is still cut, and a second paste moves it', async () => {
    await paste({ moved: true, cancelled: true, pasted: 1, from: ['C:/a/x'], paths: ['C:/b/x'], total: 2 })
    expect(fileCutPaths()).toEqual(['C:/a/x', 'C:/a/y'])
  })

  it('a cut that finished is spent', async () => {
    await paste({ moved: true, pasted: 2, from: ['C:/a/x', 'C:/a/y'], paths: ['C:/b/x', 'C:/b/y'], total: 2 })
    expect(fileCutPaths()).toEqual([])
  })
})
