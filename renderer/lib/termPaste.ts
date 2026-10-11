// The terminal's paste rule, pure so it can be tested without a clipboard.
//
// A pty carries text; an image can never travel through "paste" itself. A
// clipboard-aware TUI (Claude Code) reads the image off the OS clipboard when
// it sees the Ctrl+V KEYSTROKE - so when the clipboard holds an image, the
// terminal's whole job is to forward that keystroke instead of swallowing it.
// This is exactly where generic terminals break image paste.

import type { DetectedAgent } from '../../shared/types'

export interface ClipboardState {
  image: boolean
  text: string
  files: string[]
}

export type PasteDecision =
  | { kind: 'key' } // forward the agent's image-paste key (imagePasteKey); the TUI does the reading
  | { kind: 'text'; data: string } // bracketed paste
  | { kind: 'none' }

/** The quoting a shell reads a path in. Unknown is PowerShell, the default. */
export type PathShell = 'powershell' | 'cmd' | 'bash'

/**
 * PASTED TEXT CANNOT END THE PASTE (code review 2026-09-24, #1). xterm frames a
 * paste as ESC[200~ ... ESC[201~ and strips nothing inside, so clipboard text
 * holding its own ESC[201~ closed the paste early, and whatever followed, a
 * command and a CR, reached the shell as TYPED keys and ran without Enter
 * being pressed. A web page can put exactly that on the clipboard. So every
 * escape (ESC, and the C1 CSI 0x9b that means the same) and every other C0
 * control goes, except the three a paste legitimately carries: tab, newline
 * and carriage return. What Windows Terminal and others filter too.
 */
export function sanitizePaste(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x9b]/g, '')
}

/**
 * One path, quoted for the shell it is typed into (code review 2026-09-24,
 * #5). PowerShell EXPANDS inside double quotes: a dropped file named
 * `report$(Start-Process calc).pdf` ran calc once Enter was pressed, and a
 * folder with `$HOME` in its name became another path. Single quotes expand
 * nothing there; a quote inside is doubled, and PowerShell counts the curly
 * ones (‘ ’ ‚ ‛) as quotes too. bash reads single quotes the same way, with its
 * own escape for a quote inside. cmd has no non-expanding quote, so it keeps
 * the double quotes it always had, and so does a caller that names no shell
 * (a host that has not said which shell its session runs): nothing changes
 * for it until it does.
 */
export function quotePath(p: string, shell?: PathShell): string {
  if (!shell || shell === 'cmd') return `"${p}"`
  if (shell === 'bash') return `'${p.replace(/'/g, `'\\''`)}'`
  return `'${p.replace(/['‘’‚‛]/g, '$&$&')}'`
}

/** Quote each path and join with spaces: what a prompt (or claude) wants. */
export function quotePaths(paths: string[], shell?: PathShell): string {
  return paths.map((p) => quotePath(p, shell)).join(' ')
}

/**
 * THE AGENT'S OWN IMAGE-PASTE KEY (#170). Claude Code 2.1.296 binds image
 * paste to alt+v on Windows and ctrl+v only elsewhere (read in its binary:
 * `Me=Ie?"alt+v":"ctrl+v"`, `Ie` being windows or wsl), so the ^V this
 * terminal forwarded did nothing on a fresh install; the owner's own
 * keybindings.json binds both, which hid it. MEASURED 2026-10-11 through the
 * bundled ConPTY: ESC v reaches Claude as alt+v (it ran chat:imagePaste).
 * Codex reads the image on ^V. Claude under WSL wants alt+v too (`O()` is
 * "wsl" there, review 2026-10-11): the poll only sees wsl.exe, so a WSL tab
 * gets ESC v once Claude's own title has armed `claude` (`agentArm`), and ^V
 * before it. EXACTLY ONE key: with both bound, sending both pasted the image
 * twice.
 */
export function imagePasteKey(agent: DetectedAgent | null): string {
  return agent === 'claude' ? '\x1bv' : '\x16'
}

/**
 * SHIFT+ENTER'S NEWLINE (#175). MEASURED 2026-10-11 through the bundled ConPTY,
 * typing `ab` (and `a\`) into an empty prompt, then each candidate, then `c`:
 *
 *   bytes        Claude 2.1.296      Codex 0.153.2
 *   `\` + CR     newline, no `\`     newline, no `\`
 *   LF (Ctrl+J)  newline             DROPPED (`abc`)
 *   ESC CR       newline             newline
 *
 * Nothing submitted, and a typed trailing `\` survived in both. So Claude gets
 * Ctrl+J, its own `chat:newline` binding rather than the backslash heuristic,
 * and everything else keeps the `\` + CR every agent took before.
 */
export function newlineKey(agent: DetectedAgent | null): string {
  return agent === 'claude' ? '\n' : '\\\r'
}

export function decidePaste(clip: ClipboardState, shell?: PathShell): PasteDecision {
  // A copied image file also offers pixels to document apps. In a terminal,
  // its file representation remains the useful one.
  if (clip.files.length) return { kind: 'text', data: quotePaths(clip.files, shell) }
  // The image wins over any text riding along (Word copies both): a screenshot
  // is why the user pressed Ctrl+V, and Ctrl+Shift+V is the text escape hatch.
  if (clip.image) return { kind: 'key' }
  const text = sanitizePaste(clip.text)
  if (text) return { kind: 'text', data: text }
  return { kind: 'none' }
}
