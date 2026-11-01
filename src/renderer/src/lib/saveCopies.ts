import { copyLabel, type CopyFormat } from '@shared/imageCopy'
import { copiesNote } from './copiesNote'
import { endJob, startJob } from './jobs'
import { markLanded } from './landMarks'

/**
 * SAVE COPIES AS, THE PAGE'S HALF (#474; owner, 2026-11-01). One job on the
 * chip ("Saving JPEG copies", a bar, Cancel); main makes each copy next to
 * its original. When it is over, what landed is marked in the list (#101,
 * the first under the cursor) and the chip says the done note.
 */
export async function saveCopiesJob(paths: string[], format: CopyFormat): Promise<void> {
  let id = ''
  id = startJob('copies', `Saving ${copyLabel(format)} copies`, () => void window.prism.cancelImageCopies(id))
  try {
    const r = await window.prism.saveImageCopies(paths, format, id)
    markLanded(r.saved)
    endJob(id, copiesNote(r))
  } catch {
    endJob(id, 'The copies could not be saved')
  }
}
