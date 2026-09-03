/**
 * Prism's search terms, said in Everything's language (2026-09-03).
 *
 * The sidebar's operators (`shared/searchQuery.ts`) and Everything's own
 * syntax overlap almost exactly: words are ANDed, "quoted phrases" stay
 * whole, `*.mp4` is a wildcard over the name, `ext:mp4` is the extension and
 * an exclusion is `!term` rather than `-term`. So a query is translated
 * term by term and handed to es.exe as SEPARATE ARGUMENTS - never joined
 * into a shell line - which is what keeps a `$` in a path or a name from
 * meaning anything.
 *
 * Pure, and tested, because a mistranslated exclusion would find the exact
 * files the user asked to leave out.
 */
import type { Term } from './searchQuery'

export function everythingArgs(terms: readonly Term[]): string[] {
  return terms.map((t) => {
    const not = t.negated ? '!' : ''
    if (t.kind === 'ext') return `${not}ext:${t.value}`
    if (t.kind === 'glob') return `${not}${t.value}`
    // A phrase with a space has to reach Everything IN quotes, or the space
    // splits it into two ANDed words.
    return /\s/.test(t.value) ? `${not}"${t.value}"` : `${not}${t.value}`
  })
}

/** Everything reports dates as Windows FILETIME: 100ns ticks since 1601. */
export function filetimeToMs(ft: number): number {
  return Math.round(ft / 10000 - 11644473600000)
}

/** FILE_ATTRIBUTE_DIRECTORY and FILE_ATTRIBUTE_HIDDEN, off the attributes column. */
export const isDirAttr = (a: number): boolean => (a & 16) !== 0
export const isHiddenAttr = (a: number): boolean => (a & 2) !== 0
