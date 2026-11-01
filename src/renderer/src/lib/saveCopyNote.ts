import type { SaveCopyResult } from '@shared/ipcTypes'

/**
 * The note Save a copy leaves on the picture (#78; owner, 2026-11-01, the
 * image pack spec "approved as recommended"): the name that was saved, or
 * that it could not be. A cancel says nothing, as before. A target that is
 * the photo itself is refused by main and said so here.
 */
export function saveCopyNote(r: SaveCopyResult): string | null {
  if ('saved' in r) return `Saved ${r.saved.split(/[\\/]/).pop() ?? r.saved}`
  if ('failed' in r) return r.reason === 'source' ? 'A copy cannot replace the original' : 'Could not save the copy'
  return null
}
