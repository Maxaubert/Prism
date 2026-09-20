/**
 * COMMAND HELP IN PRISM (#175): the two decisions that are this app's own.
 * The popup, its catalogue, its search and its setting are prism-term-core's,
 * the same code Prism Terminal runs; its rules (it never types, it never runs,
 * copy is exact) are written once, in PrismTerminal's CLAUDE.md.
 *
 * Pure, so the key and the stand-down rule are tested without a window.
 */

/** The parts of a key event the help key is read from. */
export interface HelpKeyEvent {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * THE KEY IS A BARE F1, Prism Terminal's choice and the key every Windows
 * program answers help with. ONE test, read by both places that must agree:
 * `termHost.ts` (xterm yields the key) and App's key handler (which takes it).
 * Two copies of the test would drift, and a key that xterm yields and nobody
 * takes is a dead key, while one App takes and xterm keeps reaches the shell
 * as well. Shift+F1 and Ctrl+F1 stay the shell's.
 */
export const isHelpKey = (e: HelpKeyEvent): boolean =>
  e.key === 'F1' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey

/**
 * What the popup was opened OVER: the tab, its shell and whether the find bar
 * is up. The app's chords keep working over the popup, and several of them put
 * something else in front (Ctrl+T, Ctrl+Tab, Ctrl+Shift+F); a terminal takes
 * the focus as it attaches, so a popup left up would have its questions typed
 * into that shell. It leaves as soon as this string is no longer the one it
 * opened with.
 */
export const helpFront = (tabId: string | null, termId: string | null, find: boolean): string =>
  `${tabId ?? ''}|${termId ?? ''}|${find ? 'find' : ''}`

/**
 * Whether an OPEN popup has to be put away, now. Prism is a media viewer
 * first and the panel is about the terminal, so it exists only while a
 * terminal is SHOWING (the condition dictation is armed by). A question
 * dialog, the update window and the first-run setup are the same layer and
 * outrank it; the setting switched off means off.
 */
export function helpStandsDown(s: {
  enabled: boolean
  /** The id of the shell on screen, or null when there is none. */
  showing: string | null
  /** Something that outranks the popup is up. */
  blocked: boolean
  openedOver: string
  front: string
}): boolean {
  return !s.enabled || s.showing === null || s.blocked || s.openedOver !== s.front
}
