/**
 * TEXT THAT MAY BE A PATH (#99; owner, 2026-09-29: "would it be possible to
 * show these as clickable links that would open the file or folder"). Pure:
 * this only says where a path COULD be in a line of text. Whether one is there
 * is main's to answer (`termPathKinds`), and only a path that exists is ever
 * painted or clickable, so this errs on the side of asking: "and/or" is asked
 * about once, answered no, and never lights up.
 *
 * A candidate is a run of text with no whitespace or quote in it, with the
 * punctuation of the sentence around it taken off: the brackets it sits in,
 * the full stop or comma after it, and a `:12` or `:12:3` line number. It must
 * have a letter in it and either a separator (`docs/a.pdf`, `src\`, `C:\x`) or
 * a file extension (`README.md`). A URL is not a path; `lib/termLinks` has it.
 */
export interface PathCandidate {
  /** Where it sits in the text, end exclusive. */
  start: number
  end: number
  /** As written: relative to the shell's folder, or absolute. */
  path: string
}

/** Broken on these: whitespace, quotes and the characters a Windows path
 *  can never hold. */
const BREAK = /[\s"'`<>|*?]/

const LEAD = /^[([{]+/
const TRAIL = /[.,;:!)\]}]+$/
const LINE_NO = /:\d+(?::\d+)?$/
const EXTENSION = /[A-Za-z0-9_-]\.[A-Za-z0-9]{1,8}$/

/** The longest text asked about: MAX_PATH, and a line is not a path past it. */
const MAX = 260

export function findPaths(text: string): PathCandidate[] {
  const out: PathCandidate[] = []
  let i = 0
  while (i < text.length) {
    if (BREAK.test(text[i])) {
      i += 1
      continue
    }
    let j = i
    while (j < text.length && !BREAK.test(text[j])) j += 1
    const word = text.slice(i, j)
    const hit = candidate(word)
    if (hit) out.push({ start: i + hit.from, end: i + hit.from + hit.path.length, path: hit.path })
    i = j
  }
  return out
}

function candidate(word: string): { from: number; path: string } | null {
  if (word.includes('://')) return null
  let from = 0
  let w = word
  const lead = LEAD.exec(w)
  if (lead) {
    from = lead[0].length
    w = w.slice(from)
  }
  // Sentence punctuation and a line number, in either order ("a.ts:12)." ).
  for (let k = 0; k < 3; k += 1) {
    const before = w
    w = w.replace(TRAIL, '')
    w = w.replace(LINE_NO, '')
    if (w === before) break
  }
  // A folder is often written with its closing separator: keep it.
  if (w.length < 2 || w.length > MAX) return null
  if (!/[A-Za-z]/.test(w)) return null
  if (w.startsWith('-')) return null // a command's flag, not a file
  const separated = /[\\/]/.test(w)
  if (!separated && !EXTENSION.test(w)) return null
  // A bare drive ("C:") or a separator alone says nothing.
  if (/^[A-Za-z]:[\\/]?$/.test(w) || /^[\\/.]+$/.test(w)) return null
  return { from, path: w }
}
