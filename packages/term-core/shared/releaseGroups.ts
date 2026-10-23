import type { ReleaseNotes } from './releaseNotes'

// The patch notes, SORTED UNDER HEADINGS and worded for a reader (#32).
//
// Owner, 2026-09-20, looking at the update window: "make it look a bit better
// like having headers bug fixes, new features, so on. make it look proper and
// not like a git commit." What it showed was `parseReleaseNotes`' entries as
// one flat list, and those are pull request titles: "fix(terminal): a prompt
// survives the window getting narrower and wider again (#31)" is a line out of
// `git log`, written for whoever merges it.
//
// So this is the step between the parser and the window. It takes the parser's
// PLAIN STRINGS (the safety rule is the parser's and is untouched here: nothing
// below can turn text into markup, it only moves and trims strings) and:
//   - files each under one of four headings, by how its title begins;
//   - drops what only a developer reads: the `fix(scope):` prefix and the
//     trailing "(#31)";
//   - starts each line with a capital.
//
// It is a READING of titles, so it is deliberately modest: a title it does not
// recognise is a feature, which is what an unmarked pull request in these two
// repos nearly always is. Pure, no DOM, no imports beyond the type.

export type ReleaseKind = 'features' | 'improvements' | 'fixes' | 'internal'

export interface ReleaseSection {
  kind: ReleaseKind
  heading: string
  /** Plain text, never empty. */
  entries: string[]
}

/** The order they are shown in: what is new to use first, what nobody needs to
 *  read last. */
const SECTIONS: ReadonlyArray<{ kind: ReleaseKind; heading: string }> = [
  { kind: 'features', heading: 'New features' },
  { kind: 'improvements', heading: 'Improvements' },
  { kind: 'fixes', heading: 'Bug fixes' },
  { kind: 'internal', heading: 'Under the hood' }
]

// A conventional-commit prefix: `fix:`, `feat(terminal):`, `refactor(core)!:`.
const CONVENTIONAL = /^([a-z]{2,10})(?:\([^()]{0,40}\))?!?:\s+/i
const KIND_OF: Readonly<Record<string, ReleaseKind>> = {
  feat: 'features',
  feature: 'features',
  fix: 'fixes',
  bugfix: 'fixes',
  hotfix: 'fixes',
  perf: 'improvements',
  refactor: 'improvements',
  style: 'improvements',
  ui: 'improvements',
  docs: 'internal',
  doc: 'internal',
  chore: 'internal',
  build: 'internal',
  ci: 'internal',
  test: 'internal',
  tests: 'internal',
  deps: 'internal',
  revert: 'internal'
}
// One or more pull request numbers at the very end: "(#27) (#29)".
const TRAILING_REFS = /(?:\s*\(#\d{1,9}\))+\s*$/
// Titles with no prefix that still say what they are.
// Followed by a space or a colon: "Fixed-width font option" is not a fix.
const READS_AS_FIX = /^(?:fix(?:es|ed)?|bug ?fix|hotfix)(?=[\s:])/i
// The same word used as a LABEL ("Fix: the prompt", "Fixes - the prompt").
const FIX_LABEL = /^(?:fix(?:es|ed)?|bug ?fix|hotfix)(?::|\s+[-–]\s)\s*/i
// Dependabot, and this project's own bot bumping the shared core's pin.
const READS_AS_INTERNAL = /^(?:bump\s+\S+\s+from\s|update\s+dependenc|terminal core:\s*prism-term-core\b)/i

const capitalised = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** One parsed entry: where it goes, and how it reads there. Exported for its
 *  tests; the window uses `groupReleaseNotes`. */
export function classifyEntry(entry: string): { kind: ReleaseKind; text: string } {
  let text = entry.replace(TRAILING_REFS, '').trim()
  let kind: ReleaseKind = 'features'
  const prefix = CONVENTIONAL.exec(text)
  const known = prefix ? KIND_OF[prefix[1].toLowerCase()] : undefined
  if (prefix && known) {
    // Only a prefix that IS one is taken off: "Phone: a cleaner tab drawer"
    // names the part of the app, and that is worth reading.
    kind = known
    text = text.slice(prefix[0].length)
  } else if (READS_AS_INTERNAL.test(text)) {
    kind = 'internal'
  } else if (READS_AS_FIX.test(text)) {
    kind = 'fixes'
    // "Fix the prompt" keeps its verb; "Fix: the prompt" and "Fixes - x" lose
    // the label, which the heading now says.
    text = text.replace(FIX_LABEL, '')
  }
  text = capitalised(text.trim())
  // A title that was ONLY a prefix and a number has nothing left to show; the
  // entry as it came is better than an empty bullet.
  return { kind, text: text || entry }
}

/** The window's sections, in order, empty ones left out. A body with no notes
 *  has none: the window prints the parser's stand-in line instead. */
export function groupReleaseNotes(notes: ReleaseNotes): ReleaseSection[] {
  if (notes.empty) return []
  const by = new Map<ReleaseKind, string[]>()
  for (const entry of notes.entries) {
    const { kind, text } = classifyEntry(entry)
    by.set(kind, [...(by.get(kind) ?? []), text])
  }
  return SECTIONS.flatMap((s) => {
    const entries = by.get(s.kind)
    return entries?.length ? [{ ...s, entries }] : []
  })
}
