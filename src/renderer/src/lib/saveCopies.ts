import { copyLabel, type CopyFormat } from '@shared/imageCopy'
import { copiesNote } from './copiesNote'
import { withFileJob } from './fileJob'
import { markLanded } from './landMarks'
import { parentDir } from '@shared/path'

/**
 * SAVE COPIES AS, THE PAGE'S HALF (#474; owner, 2026-11-01). One job on the
 * chip ("Saving JPEG copies", a bar, Cancel); main makes each copy next to
 * its original. When it is over, what landed is marked in the list (#101,
 * the first under the cursor) and the chip says the done note.
 */
export function saveCopiesJob(paths: string[], format: CopyFormat): Promise<void> {
  return withFileJob(
    {
      kind: 'copies',
      verb: `Saving ${copyLabel(format)} copies`,
      early: true,
      total: paths.length,
      dirs: [...new Set(paths.map(parentDir))],
      cancelInMain: (id) => window.prism.cancelImageCopies(id)
    },
    async (job) => {
      try {
        const r = await window.prism.saveImageCopies(paths, format, job.id)
        markLanded(r.saved)
        job.note(copiesNote(r))
      } catch {
        job.note('The copies could not be saved')
      }
    }
  )
}
