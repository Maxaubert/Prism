// THE COMMON FILE-LIST KEYS (#330; owner, 2026-10-07: "add common hotkeys to
// the explorer and project so that for example ctrl + A selects all"). One
// mapping for the Explorer's list and the project tree, so the two surfaces
// answer the same chord the same way. Pure: the surfaces own the effects, and
// each still decides whether the key is its to take (the typing guard, an
// archive, a search showing).
//
// What is NOT here, on purpose: Ctrl+Left and Ctrl+Right (Left and Right are
// not navigation keys, owner 2026-09-01: they reach the viewer), plain Delete
// and plain Enter (each surface had them before this and keeps its own), and
// Ctrl+C/X/V and Ctrl+Z (already the surfaces' and App's).

export type ListKey =
  /** Ctrl+A. */
  | 'select-all'
  /** Ctrl+Shift+A, or Escape when nothing nearer owns it. */
  | 'clear'
  /** Shift+Up/Down/Home/End: the marks run from the anchor to here. */
  | 'extend-up'
  | 'extend-down'
  | 'extend-home'
  | 'extend-end'
  /** Ctrl+Up/Down/Home/End: the keyboard's place moves, the marks do not. */
  | 'focus-up'
  | 'focus-down'
  | 'focus-home'
  | 'focus-end'
  /** Ctrl+Space: the focused row in or out of the marks. */
  | 'toggle-mark'
  /** Ctrl+Shift+N. */
  | 'new-folder'
  /** Ctrl+D and Shift+Delete: the Recycle Bin, as Delete (owner: Shift+Delete
   *  is NOT a permanent delete in Prism). */
  | 'bin'
  /** Alt+Up. */
  | 'parent'
  /** Alt+Left and Alt+Right: the Explorer's history; nothing in the tree. */
  | 'back'
  | 'forward'
  /** F3. Ctrl+F stays where each surface already had it. */
  | 'search'
  /** Alt+Enter: Prism's own Properties. */
  | 'properties'
  /** Ctrl+Shift+C: the full paths as text, one per line. */
  | 'copy-paths'
  /** Ctrl+Enter: a folder in a new Explorer tab. */
  | 'open-new-tab'

export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** A letter chord by its PHYSICAL key too: a Russian layout's A is 'ф'. */
const letter = (e: KeyLike, l: string): boolean =>
  e.key.toLowerCase() === l || e.code === `Key${l.toUpperCase()}`

const EDGE: Record<string, 'up' | 'down' | 'home' | 'end'> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end'
}

/** Which of the common keys this press is, or null for every other key. */
export function listKey(e: KeyLike): ListKey | null {
  if (e.metaKey) return null
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt } = e
  const edge = EDGE[e.key]
  if (alt) {
    if (ctrl || shift) return null
    if (e.key === 'ArrowUp') return 'parent'
    if (e.key === 'ArrowLeft') return 'back'
    if (e.key === 'ArrowRight') return 'forward'
    if (e.key === 'Enter') return 'properties'
    return null
  }
  if (ctrl && shift) {
    if (letter(e, 'a')) return 'clear'
    if (letter(e, 'n')) return 'new-folder'
    if (letter(e, 'c')) return 'copy-paths'
    return null
  }
  if (ctrl) {
    if (letter(e, 'a')) return 'select-all'
    if (letter(e, 'd')) return 'bin'
    if (edge) return `focus-${edge}`
    if (e.key === ' ' || e.code === 'Space') return 'toggle-mark'
    if (e.key === 'Enter') return 'open-new-tab'
    return null
  }
  if (shift) {
    if (edge) return `extend-${edge}`
    if (e.key === 'Delete') return 'bin'
    return null
  }
  if (e.key === 'Escape') return 'clear'
  if (e.key === 'F3') return 'search'
  return null
}

/** Where a step lands in a list of `count` rows, from `from` (-1: none yet). */
export function stepTo(
  count: number,
  from: number,
  to: 'up' | 'down' | 'home' | 'end'
): number | null {
  if (count <= 0) return null
  if (to === 'home') return 0
  if (to === 'end') return count - 1
  if (from < 0) return to === 'down' ? 0 : count - 1
  return to === 'down' ? Math.min(count - 1, from + 1) : Math.max(0, from - 1)
}

/**
 * TYPE TO JUMP, the tree's (#330; owner: "add it like the Explorer's"). The
 * row whose name starts with what was typed. A single letter looks from the
 * row AFTER the current one, so pressing it again walks every row with that
 * letter; a longer run looks from the current row itself, so typing on keeps
 * the row that already matches. Wraps round. -1 when nothing matches, and then
 * the key is not taken: it still reaches the viewer.
 */
export function typeJump(names: readonly string[], from: number, typed: string): number {
  const text = typed.toLowerCase()
  if (!text || !names.length) return -1
  const start = text.length === 1 ? from + 1 : Math.max(0, from)
  for (let i = 0; i < names.length; i++) {
    const at = (((start + i) % names.length) + names.length) % names.length
    if (names[at].toLowerCase().startsWith(text)) return at
  }
  return -1
}

/** The run a typed letter adds to: within 700 ms it extends, else it starts
 *  again (the Explorer's own window). */
export function typedRun(
  last: { text: string; at: number },
  key: string,
  now: number
): { text: string; at: number } {
  return { text: now - last.at < 700 ? last.text + key.toLowerCase() : key.toLowerCase(), at: now }
}
