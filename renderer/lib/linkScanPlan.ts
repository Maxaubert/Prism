/**
 * How the link painter walks a buffer without freezing the page (#167).
 *
 * A full pass used to paint all 10,000 lines of scrollback cell by cell in ONE
 * task: MEASURED 2009 ms and 2046 ms page stacks in the painter (Stable's diag
 * log, 2026-10-10 16:58Z). Now a full pass paints the live screen at once (at
 * most `rows` lines, what the user is looking at) and the scrollback after
 * it, bottom up so the lines nearest the screen come first, in slices that
 * stop once a time budget is spent. The page gets the thread back between
 * slices.
 *
 * MEASURED (2026-10-11, @xterm/headless, 10,000 lines each holding a URL and a
 * path, the core's own findLinks and pathCandidates): the text work alone of
 * one full pass is 65 to 79 ms in one task, before any decoration, DOM or
 * second tab; the same walk through `sliceRows` with an 8 ms budget is 9
 * slices, the longest 8.0 ms. The budget must cover the painting, so the
 * painting happens inside the walk (`visit`).
 */

/** The live screen's lines: the first is `baseY`, the last no further than the buffer. */
export function liveRange(baseY: number, rows: number, length: number): { first: number; last: number } {
  return { first: baseY, last: Math.min(length - 1, baseY + rows - 1) }
}

export interface RowPlan {
  /**
   * The next slice: `visit` is called for each line, bottom up, until the
   * budget is spent, and the lines visited are returned; null when the walk is
   * done or cancelled. `resume` is the line the walk stands on NOW, when the
   * buffer has trimmed lines off its top since the last slice and every
   * number moved.
   */
  next(visit?: (line: number) => void, resume?: number): number[] | null
  cancel(): void
}

/**
 * Lines `from` to `to`, walked from `to` UP, `budgetMs` at a time by `now`.
 * The clock is read after each line's `visit`, so the budget covers the work
 * itself; a slice ends on the first line that finds it spent (a line is never
 * split, and a slice holds at least one line, so the walk always moves).
 */
export function sliceRows(from: number, to: number, budgetMs: number, now: () => number): RowPlan {
  let at = to
  let cancelled = false
  return {
    next(visit, resume) {
      if (resume !== undefined) at = resume
      if (cancelled || at < from) return null
      const out: number[] = []
      const start = now()
      while (at >= from) {
        const line = at
        at -= 1
        out.push(line)
        visit?.(line)
        if (cancelled || now() - start >= budgetMs) break
      }
      return out
    },
    cancel() {
      cancelled = true
    }
  }
}
