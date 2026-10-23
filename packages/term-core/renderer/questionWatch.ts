import { extractQuestion, sameQuestion, type ShownQuestion } from './questionWidget'

/**
 * WATCHES ONE TAB FOR CLAUDE CODE'S QUESTION WIDGET (Sonara #323) and says
 * when the question showing changes: after output settles (`delayMs`), the
 * live screen is read and the widget's question extracted. A change is
 * reported once; the widget gone resets, so the same question shown again
 * later is reported again. Cheap: one pass over a few screens of rows, only
 * after output, never on a timer of its own.
 *
 * The live screen is the buffer's bottom (`baseY`), not the viewport: a user
 * scrolled up still has the widget followed. A screen of scrollback above it
 * is read too, as a widget taller than the pane pushes its tab row up there.
 */

/** The slice of an xterm `Terminal` this reads. */
export interface WatchedTerm {
  rows: number
  buffer: { active: { baseY: number; getLine(y: number): { translateToString(trim?: boolean): string } | undefined } }
  onWriteParsed(cb: () => void): { dispose(): void }
}

export function watchQuestions(
  term: WatchedTerm,
  report: (shown: ShownQuestion) => void,
  delayMs = 150
): { dispose(): void } {
  let last: ShownQuestion | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const look = (): void => {
    timer = undefined
    const b = term.buffer.active
    const rows: string[] = []
    for (let y = Math.max(0, b.baseY - term.rows); y < b.baseY + term.rows; y++) {
      rows.push(b.getLine(y)?.translateToString(true) ?? '')
    }
    const now = extractQuestion(rows)
    if (sameQuestion(now, last)) return
    last = now
    if (now) report(now)
  }
  const sub = term.onWriteParsed(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(look, delayMs)
  })
  return {
    dispose: () => {
      if (timer) clearTimeout(timer)
      sub.dispose()
    }
  }
}
