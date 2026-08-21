// The terminal's paste rule, pure so it can be tested without a clipboard.
//
// A pty carries text; an image can never travel through "paste" itself. A
// clipboard-aware TUI (Claude Code) reads the image off the OS clipboard when
// it sees the Ctrl+V KEYSTROKE - so when the clipboard holds an image, the
// terminal's whole job is to forward that keystroke instead of swallowing it.
// This is exactly where generic terminals break image paste.

export interface ClipboardState {
  image: boolean
  text: string
  files: string[]
}

export type PasteDecision =
  | { kind: 'key' } // forward the raw ^V byte; the TUI does the reading
  | { kind: 'text'; data: string } // bracketed paste
  | { kind: 'none' }

/** Quote each path and join with spaces: what a prompt (or claude) wants. */
export function quotePaths(paths: string[]): string {
  return paths.map((p) => `"${p}"`).join(' ')
}

export function decidePaste(clip: ClipboardState): PasteDecision {
  // The image wins over any text riding along (Word copies both): a screenshot
  // is why the user pressed Ctrl+V, and Ctrl+Shift+V is the text escape hatch.
  if (clip.image) return { kind: 'key' }
  // Copied files beat their own text form (Explorer sets both): the path is
  // the useful half, and it also covers images copied as files.
  if (clip.files.length) return { kind: 'text', data: quotePaths(clip.files) }
  if (clip.text) return { kind: 'text', data: clip.text }
  return { kind: 'none' }
}
