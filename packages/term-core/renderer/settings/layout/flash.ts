/**
 * TAKE THE EYE TO A ROW (2026-10-05, Find a setting): scroll it to the middle
 * of the pane, flash it, and put the keyboard on its first control. The flash
 * is a MARK, not a button, so it may wear the accent: a 16% fill of
 * `--p-accent-hi` fading over 1.4s. Nothing moves under reduced motion.
 *
 * A row may be drawn LATE (Default shell renders nothing until main has listed
 * the shells), so the row is looked for until it exists, for up to 3 s, and
 * the section it belongs to stands in if it never comes.
 */
const WAIT_MS = 3000

/** The first control a keyboard can use in a row, else the row itself. */
function focusIn(row: HTMLElement): void {
  const ctl = row.querySelector<HTMLElement>(
    'button:not(:disabled):not([role="option"]), input:not(:disabled), [tabindex="0"]'
  )
  if (ctl) ctl.focus({ preventScroll: true })
  else {
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1')
    row.focus({ preventScroll: true })
  }
}

export function flashRow(row: HTMLElement): void {
  row.scrollIntoView({ block: 'center' })
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  // `data-flash` while it runs: the e2e reads it, a screen reader does not.
  row.setAttribute('data-flash', '')
  if (!still && typeof row.animate === 'function') {
    const lit = 'color-mix(in srgb, var(--p-accent-hi) 16%, transparent)'
    row.animate(
      [
        { backgroundColor: lit, offset: 0 },
        { backgroundColor: lit, offset: 0.3 },
        { backgroundColor: 'transparent', offset: 1 }
      ],
      { duration: 1400, easing: 'ease-out' }
    )
  }
  window.setTimeout(() => row.removeAttribute('data-flash'), 1400)
  focusIn(row)
}

/** Find `[data-pref=<id>]` inside `root` (waiting for a late row), then flash
 *  it; `section` names the fallback. Returns a cancel. */
export function flashPref(root: ParentNode, id: string, section?: string): () => void {
  const started = performance.now()
  let timer = 0
  let frame = 0
  const look = (): void => {
    const row = root.querySelector<HTMLElement>(`[data-pref="${CSS.escape(id)}"]`)
    if (row) return flashRow(row)
    if (performance.now() - started < WAIT_MS) {
      timer = window.setTimeout(() => (frame = requestAnimationFrame(look)), 60)
      return
    }
    const fallback = section ? root.querySelector<HTMLElement>(`[data-settings-section="${CSS.escape(section)}"]`) : null
    if (fallback) flashRow(fallback)
  }
  frame = requestAnimationFrame(look)
  return () => {
    clearTimeout(timer)
    cancelAnimationFrame(frame)
  }
}
