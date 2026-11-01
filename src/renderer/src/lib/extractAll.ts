import type { ExtractAllResult } from '@shared/extraction'
import { markLanded } from './landMarks'

/**
 * The whole archive out, from every surface that offers it (the Explorer's
 * row menu and strip, the archive card, the archive view). Extract here
 * marks the folder it made in the list, as a paste marks what it pasted
 * (#101). Extract to... lands in a folder the user picked, and marks nothing.
 */
export function extractAll(path: string, here: boolean): Promise<ExtractAllResult> {
  return window.prism.archiveExtractAll(path, here).then((r) => {
    if (r.ok && here) markLanded([r.dest])
    return r
  })
}
