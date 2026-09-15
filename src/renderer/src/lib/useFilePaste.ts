import { useCallback } from 'react'
import { clearFileCut, fileCutPaths, fileClipboardReady } from './fileClipboard'
import { endJob, startJob } from './jobs'

export function useFilePaste(onRefresh: () => void, onError: (message: string) => void) {
  return useCallback(
    async (directory: string): Promise<void> => {
      await fileClipboardReady()
      const cut = fileCutPaths()
      const job = startJob('paste', cut.length ? 'Moving' : 'Copying')
      try {
        const result = await window.prism.pasteInto(directory, cut.length ? cut : undefined, job)
        if (result.moved) clearFileCut(cut)
        if (result.empty) onError('There are no files on the clipboard.')
        else if (result.refused) onError('This folder is not available for pasting.')
        else if (!result.pasted) onError('Nothing could be pasted here.')
        else if (result.failed)
          onError(`Pasted ${result.pasted}, but ${result.failed} could not be copied.`)
        onRefresh()
      } catch {
        onError('The files could not be pasted. Try again.')
      } finally {
        endJob(job)
      }
    },
    [onRefresh, onError]
  )
}
