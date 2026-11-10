import type { JSX, ReactNode } from 'react'
import { DIALOG_EMPHASIS } from './dialogLook'

/**
 * A file or folder name inside a question (#500, the review's DialogName
 * finding): one style everywhere, a step brighter than the line around it
 * through the theme's own text colour (so it reads on a light theme too), and
 * never wrapped in quotes. In a TITLE a name stays plain text, since a title
 * is also the dialog's accessible label.
 */
export function DialogName({ children }: { children: ReactNode }): JSX.Element {
  return <span className={DIALOG_EMPHASIS}>{children}</span>
}
