import { useSyncExternalStore, type JSX } from 'react'
import { PasswordDialog } from '../../dialogs/PasswordDialog'
import { answerArchiveQuestion, archiveQuestionUp, onArchiveQuestion } from '../../lib/archiveQuestion'

/**
 * The window's one password question (owner, 2026-11-09). Beside App and not
 * inside it, like the extraction window: it belongs to no tab and no viewer,
 * and whoever asked may be gone by the time it is answered.
 */
export function ArchiveQuestion(): JSX.Element | null {
  const question = useSyncExternalStore(onArchiveQuestion, archiveQuestionUp)
  if (!question) return null
  return (
    <PasswordDialog
      key={question.archive}
      name={question.name}
      wrong={question.wrong}
      onSubmit={(password) => answerArchiveQuestion(password)}
      onCancel={() => answerArchiveQuestion(null)}
    />
  )
}
