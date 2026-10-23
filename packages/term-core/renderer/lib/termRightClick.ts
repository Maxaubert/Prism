/**
 * A RIGHT-CLICK IS THE MENU'S, NOT THE PROGRAM'S (owner, 2026-10-22, in Flare
 * and the same in xterm.js here: "right click pastes in the terminal, it
 * shouldn't ... right click should just open the menu not paste in the
 * input"). With a program reading the mouse (Claude Code turns on 1000/1002/
 * 1006), xterm forwarded the right press and release as `CSI < 2 ; x ; y M/m`
 * while the host's menu opened on the same click, and Claude Code pastes on a
 * right press. Nothing here ever pasted; the program did. MEASURED in the e2e
 * `rightClick` before the fix: `ESC[<2;77;24M` and `ESC[<2;77;24m` reached
 * the program.
 *
 * So a right press, its release and any move made while the right button is
 * held stop before xterm sees them, unless the host's "Send right clicks to
 * programs" is on (`TermHostConfig.rightClickReports`, Flare #49 / DIFF-22).
 * Only while the program has the mouse: with no mouse mode xterm sends nothing
 * for a right press anyway, and its own handling of one (keeping a selection
 * for the menu) stays as it was. `contextmenu` is a separate event, so the menu
 * still opens.
 */
export interface RightClickGate {
  type: string
  /** MouseEvent.button: 2 is the right one. */
  button: number
  /** MouseEvent.buttons: bit 2 is the right one held. */
  buttons: number
  /** xterm's `modes.mouseTrackingMode`. */
  mouseTracking: string
  /** The host lets right clicks through. */
  sendRight: boolean
}

export function keepRightClick(g: RightClickGate): boolean {
  if (g.sendRight || g.mouseTracking === 'none') return false
  if (g.type === 'mousedown' || g.type === 'mouseup') return g.button === 2
  if (g.type === 'mousemove') return (g.buttons & 2) !== 0
  return false
}
