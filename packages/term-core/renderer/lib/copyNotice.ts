// "COPIED", SAID ONCE FOR THE WHOLE APP (owner, 2026-09-23: "when you copy
// something in the terminal including from the command help, i want to see a
// badge appear at the bottom center of the screen saying copied"). Every copy
// the app makes goes through `copyText`, and only a write that SUCCEEDED
// raises the badge: a copy that failed must never claim it worked. The badge
// itself is `components/CopiedBadge`, mounted once by each host.

import { termApi } from '../host'

type Listener = () => void
const listeners = new Set<Listener>()

/** Hear every successful copy. Returns the unsubscribe. */
export function onCopied(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Say that something was copied: the badge shows, or restarts its clock. */
export function announceCopied(): void {
  for (const fn of listeners) fn()
}

/**
 * Put `text` on the clipboard, exactly, and raise the badge if it landed.
 * The page's own clipboard first (no size cap, and a menu or key press has
 * the focus it needs); main's `writeClipboard` when the page is refused, as
 * the command help's popup can be when the document has no focus.
 */
export async function copyText(text: string): Promise<boolean> {
  const ok = await copyTextQuietly(text)
  if (ok) announceCopied()
  return ok
}

/**
 * The same write with no badge, for a copy that says so where it happened:
 * command help's row turns its copy icon into a check (owner, 2026-10-13), and
 * a badge as well would say one success twice.
 */
export async function copyTextQuietly(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => termApi().writeClipboard?.(text).catch(() => false) ?? false
  )
}
