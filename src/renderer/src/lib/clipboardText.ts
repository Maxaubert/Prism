/**
 * Putting TEXT on the clipboard, from either host (2026-09-07, #106).
 *
 * `navigator.clipboard` is a SECURE-CONTEXT api. The app window is one; the
 * phone page is plain http by design, so there it is simply absent, and
 * every "Copy path" row threw instead of copying. The old `execCommand`
 * route has no such rule and is what the phone gets; a host with neither is
 * told so, and the caller drops the row rather than offering one that does
 * nothing.
 */
export function clipboardText(text: string): boolean {
  const nav = typeof navigator === 'undefined' ? null : navigator
  if (nav?.clipboard?.writeText) {
    void nav.clipboard.writeText(text).catch(() => copyBySelection(text))
    return true
  }
  return copyBySelection(text)
}

/** True when this host can copy text at all, asked before a row is offered. */
export function canCopyText(): boolean {
  if (typeof navigator !== 'undefined' && !!navigator.clipboard?.writeText) return true
  // `document.execCommand` is typed as always present, and on the phone page
  // it genuinely is; what is missing on a bare test host is `document`.
  return typeof document !== 'undefined' && 'execCommand' in document
}

/**
 * The pre-clipboard-api way: a textarea off screen, selected, copied,
 * removed. `readOnly` and the fixed position are what stop iOS scrolling the
 * page and raising the keyboard on the way past.
 */
function copyBySelection(text: string): boolean {
  if (typeof document === 'undefined' || !('execCommand' in document)) return false
  const box = document.createElement('textarea')
  box.value = text
  box.readOnly = true
  box.setAttribute('aria-hidden', 'true')
  box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;'
  document.body.appendChild(box)
  try {
    box.focus()
    box.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    box.remove()
  }
}
