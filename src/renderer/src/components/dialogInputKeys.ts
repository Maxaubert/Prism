/**
 * The keys of a dialog's text field (#516), from the password field: every key
 * stops here (the app's arrow-key paging must not see the typing; Escape is
 * the Modal's, heard on the window first), and Enter answers when `ok` says
 * the value may be answered. Returns whether Enter was taken.
 */
export function dialogInputKey(
  e: { key: string; stopPropagation: () => void; preventDefault: () => void },
  ok: boolean,
  onEnter?: () => void
): boolean {
  e.stopPropagation()
  if (e.key !== 'Enter' || !onEnter) return false
  e.preventDefault()
  if (ok) onEnter()
  return true
}