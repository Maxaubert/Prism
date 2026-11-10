import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Choice } from '../components/Dialog'
import type { DeleteChoice } from './DeleteQuestion'

// For the dialogs' own tests (the way menus/ tests read a builder's rows): a
// dialog here is a thin wrapper that returns one <Dialog> (or, for the delete
// questions, one <DeleteQuestion>), so calling it gives that element, whose
// props are the title, the body (or the line) and the choices.

export type SpecChoice = Choice & Partial<Pick<DeleteChoice, 'tone' | 'focus'>>

export interface DialogSpec {
  title: string
  /** The body as a reader sees it, tags stripped. */
  text: string
  choices: SpecChoice[]
  onCancel: () => void
}

export const plain = (node: ReactNode): string =>
  isValidElement(node)
    ? renderToStaticMarkup(node as ReactElement)
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
    : String(node ?? '')

export function specOf(el: ReactElement): DialogSpec {
  const p = el.props as {
    title: string
    body?: ReactNode
    line?: ReactNode
    choices: SpecChoice[]
    onCancel: () => void
  }
  return { title: p.title, text: plain(p.body ?? p.line), choices: p.choices, onCancel: p.onCancel }
}

export const labels = (s: DialogSpec): string[] => s.choices.map((c) => c.label)

/** The choice with this label (the test fails loudly if it is missing). */
export function pick(s: DialogSpec, label: string): SpecChoice {
  const c = s.choices.find((x) => x.label === label)
  if (!c) throw new Error(`no "${label}" in ${labels(s).join(', ')}`)
  return c
}
