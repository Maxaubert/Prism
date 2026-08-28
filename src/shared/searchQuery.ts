/**
 * What people actually type into a search box (2026-08-28).
 *
 * The old search was one case-insensitive substring over the file name, so
 * "holiday 2024" found nothing at all in a folder full of "2024-06 holiday"
 * files - the words are there, in the other order - and there was no way to
 * ask for "every mp4".
 *
 * The language is small on purpose. Every term must match (AND), because that
 * is what typing more words means; nothing here is a search engine.
 *
 *   holiday 2024     both words, in any order, anywhere in the name
 *   "family dinner"  the phrase, spaces and all
 *   *.mp4            a glob over the whole name: * is any run, ? is one
 *   img_??.jpg       so this works too
 *   ext:mp4          the extension, with or without its dot
 *   -raw             exclude: no term below may match
 *
 * A bare `.mp4` stays a plain substring, deliberately: it is what someone
 * looking for "photo.mp4.bak" typed, and guessing otherwise is the kind of
 * cleverness that makes a search box unpredictable.
 */
export interface Term {
  kind: 'text' | 'glob' | 'ext'
  /** Lower-cased needle, or the pattern for a glob. */
  value: string
  /** A leading '-': this term must NOT match. */
  negated: boolean
}

interface Token {
  text: string
  /** It arrived in quotes, so nothing in it is an operator. */
  quoted: boolean
}

function scan(query: string): Token[] {
  const out: Token[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query)) !== null) {
    const quoted = m[1] !== undefined
    const raw = quoted ? m[1] : m[2]
    if (raw.trim()) out.push({ text: raw, quoted })
  }
  return out
}

/** Split on spaces, keeping "quoted phrases" whole. */
export function tokenize(query: string): string[] {
  return scan(query).map((t) => t.text)
}

export function parseQuery(query: string): Term[] {
  const terms: Term[] = []
  for (const token of scan(query)) {
    let t = token.text
    let negated = false
    if (t.startsWith('-') && t.length > 1) {
      negated = true
      t = t.slice(1)
    }
    // A quoted phrase is text even when it holds a star: "2 * 3.txt" is a name.
    const quoted = token.quoted
    const lower = t.toLowerCase()
    if (/^ext:/.test(lower)) {
      const ext = lower.slice(4).replace(/^\./, '')
      if (ext) terms.push({ kind: 'ext', value: ext, negated })
    } else if (!quoted && /[*?]/.test(lower)) {
      terms.push({ kind: 'glob', value: lower, negated })
    } else if (lower) {
      terms.push({ kind: 'text', value: lower, negated })
    }
  }
  return terms
}

/** A glob over the WHOLE name, so `*.mp4` needs its star and `report` does not
 *  accidentally become one. Only * and ? are special. */
export function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/[*?]/g, (c) => (c === '*' ? '.*' : '.'))
  return new RegExp(`^${body}$`, 'i')
}

const globCache = new Map<string, RegExp>()

function globFor(pattern: string): RegExp {
  let re = globCache.get(pattern)
  if (!re) {
    re = globToRegExp(pattern)
    if (globCache.size > 64) globCache.clear()
    globCache.set(pattern, re)
  }
  return re
}

function hits(term: Term, name: string): boolean {
  if (term.kind === 'text') return name.includes(term.value)
  if (term.kind === 'glob') return globFor(term.value).test(name)
  const dot = name.lastIndexOf('.')
  return dot > 0 && name.slice(dot + 1) === term.value
}

/** Does this file name satisfy every term? A query with no terms matches
 *  nothing, which is how an empty search box behaves. */
export function matchesQuery(name: string, terms: readonly Term[]): boolean {
  if (!terms.length) return false
  const lower = name.toLowerCase()
  for (const t of terms) {
    const hit = hits(t, lower)
    if (t.negated ? hit : !hit) return false
  }
  // A query of nothing but exclusions ("-raw") would match every file, which
  // is not a search - it is a folder listing with a hole in it.
  return terms.some((t) => !t.negated)
}
