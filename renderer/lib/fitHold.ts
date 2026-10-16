/**
 * HOLD THE TERMINALS' SIZE FOR A MOMENT (owner, 2026-10-16: "the sidebar
 * animates but the main view just switches"). While a host animates the room
 * a terminal has (the tab sidebar pinned or unpinned, the terminal sliding
 * with it), every terminal keeps the columns it has: a fit on every frame
 * would resize the shell 15 times in a quarter second, each a ConPTY resize
 * and a redraw (regression rule 13). What arrives while held waits, and runs
 * once when the hold ends. Pure, so a test holds it.
 */

let held = false
let timer: ReturnType<typeof setTimeout> | undefined
const waiting = new Set<() => void>()

/** Hold every terminal's size for `ms`; a second hold extends the first. */
export function holdTermFit(ms: number): void {
  held = true
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(releaseTermFit, ms)
}

/** End the hold now, and run each fit that waited, once. */
export function releaseTermFit(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  held = false
  const fns = [...waiting]
  waiting.clear()
  for (const fn of fns) {
    try {
      fn()
    } catch {
      /* one terminal's fit never stops the next */
    }
  }
}

export function termFitHeld(): boolean {
  return held
}

/** Run `fn` when the hold ends; the same `fn` twice runs once. */
export function whenTermFitReleased(fn: () => void): void {
  waiting.add(fn)
}
