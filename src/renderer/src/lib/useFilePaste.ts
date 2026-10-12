import { useCallback } from 'react'
import { clearFileCut, fileCutPaths, fileClipboardReady } from './fileClipboard'
import { endJob, startJob } from './jobs'

/** What main answers a paste with. */
export type PasteResult = Awaited<ReturnType<Window['prism']['pasteInto']>>

/** Everything a paste can say, for the Explorer and the tree alike
 *  (structure cleanup, 2026-10-12; they were two copies saying different
 *  things). Only the refusal differs: the tree's root is the TAB's. */
export const PASTE_MESSAGES = {
  empty: 'There are no files on the clipboard.',
  refused: 'This folder is not available for pasting.',
  refusedTab: 'That folder is outside this tab.',
  nothing: 'Nothing could be pasted here.',
  partly: (pasted: number, failed: number): string =>
    `Pasted ${pasted}, but ${failed} could not be copied.`,
  threw: 'The files could not be pasted. Try again.'
} as const

/** What to say about a paste main ran, or null when it all landed. */
export function pasteMessage(r: PasteResult, refused: string = PASTE_MESSAGES.refused): string | null {
  if (r.empty) return PASTE_MESSAGES.empty
  if (r.refused) return refused
  if (!r.pasted) return PASTE_MESSAGES.nothing
  if (r.failed) return PASTE_MESSAGES.partly(r.pasted, r.failed)
  return null
}

/**
 * Paste the clipboard's files into a folder: a move when they were cut here
 * and the clipboard still holds them (main checks), a copy otherwise. The
 * job chip runs while it does and always ends, a rejected call included.
 * `onPasted` gets every answer main gave (a message, if any, was said
 * first); a call that threw only says so.
 */
export function useFilePaste(
  onPasted: (result: PasteResult, directory: string) => void,
  onError: (message: string) => void,
  refused: string = PASTE_MESSAGES.refused
): (directory: string) => Promise<void> {
  return useCallback(
    async (directory: string): Promise<void> => {
      await fileClipboardReady()
      const cut = fileCutPaths()
      const job = startJob('paste', cut.length ? 'Moving' : 'Copying')
      try {
        const result = await window.prism.pasteInto(directory, cut.length ? cut : undefined, job)
        if (result.moved) clearFileCut(cut)
        const said = pasteMessage(result, refused)
        if (said) onError(said)
        onPasted(result, directory)
      } catch {
        onError(PASTE_MESSAGES.threw)
      } finally {
        endJob(job)
      }
    },
    [onPasted, onError, refused]
  )
}
