// SETTINGS DESCRIPTIONS ARE PLAIN WORDS (owner, 2026-09-22: "make them normal
// like typical subtexts, no symbols other than comma and dot. No mentioning of
// specific keys or tips. Just a simple text description of what it does").
//
// Pure and shared by both apps' tests: each app scans its own settings source
// with `settingsDescriptions` and asserts `copyProblems` finds nothing, so a
// description that names a key or reaches for a colon fails the unit run
// rather than waiting for somebody to notice it on the page.

const ALLOWED = /^[A-Za-z0-9 ,.]*$/
const KEYS = /\b(Ctrl|Control|Shift|Alt|Enter|Escape|Esc|Tab|Backspace|Win|F\d{1,2})\b/

/** What is wrong with one description, or null when it follows the rule. */
export function copyProblem(text: string): string | null {
  if (!ALLOWED.test(text)) {
    const bad = [...new Set([...text].filter((c) => !/[A-Za-z0-9 ,.]/.test(c)))].join(' ')
    return `uses symbols other than comma and full stop: ${bad}`
  }
  const key = KEYS.exec(text)
  if (key) return `names a key: ${key[1]}`
  return null
}

/**
 * Every description a settings source file declares: the string literals of
 * `hint=`, `sub=`, `what=` and `warn=` attributes (a ternary's variants each
 * count; `${...}` holes are dropped), and `note:` fields.
 */
export function settingsDescriptions(source: string): string[] {
  const out: string[] = []
  const attr = /\b(hint|sub|what|warn)=/g
  let m: RegExpExecArray | null
  while ((m = attr.exec(source))) {
    let i = m.index + m[0].length
    const first = source[i]
    if (first === '"') {
      const end = source.indexOf('"', i + 1)
      out.push(source.slice(i + 1, end))
      continue
    }
    if (first !== '{') continue
    let depth = 0
    const start = i
    for (; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}' && (depth -= 1) === 0) break
    }
    out.push(...literals(source.slice(start + 1, i)))
  }
  const note = /\bnote:\s*(['"`])((?:\\.|(?!\1).)*)\1/g
  while ((m = note.exec(source))) out.push(m[2])
  return out.filter((s) => s.trim().length > 0)
}

function literals(expr: string): string[] {
  const out: string[] = []
  const lit = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g
  let m: RegExpExecArray | null
  while ((m = lit.exec(expr))) {
    // A literal that is a key into something (null, a class name) is not
    // copy; copy has a space or ends a sentence.
    const text = m[2].replace(/\$\{[^}]*\}/g, '').trim()
    if (/\s/.test(text) || /\.$/.test(text)) out.push(text)
  }
  return out
}

// THE GROUPED CARDS REDESIGN (2026-10-05) adds rules BESIDE the ones above,
// never inside them: Prism's unit suite calls `copyProblem` and
// `settingsDescriptions` over its current pages, whose hints run longer, and
// the core's legacy rows are as long. So both keep today's behaviour exactly,
// and the new files (the option lists, `layout/`, `sections/`, each app's
// `appOptions.ts`) are held to these as well.

/** A subtext is ONE short line: at most this many words. */
export const SUB_MAX_WORDS = 8

/** Whether a subtext runs past the limit. */
export function subTooLong(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length > SUB_MAX_WORDS
}

/** What is wrong with a row LABEL, or null: the symbol rule only. "Tab
 *  width" names a tab, not the Tab key, so a label is not checked for key
 *  names. */
export function labelProblem(text: string): string | null {
  if (ALLOWED.test(text)) return null
  const bad = [...new Set([...text].filter((c) => !/[A-Za-z0-9 ,.]/.test(c)))].join(' ')
  return `uses symbols other than comma and full stop: ${bad}`
}

/**
 * The `label:` and `sub:` string fields of an option list or an app's
 * `appOptions.ts`. Separate from `settingsDescriptions`, which Prism points at
 * files full of `label:` fields that are not setting labels.
 */
export function settingsListCopy(source: string): { labels: string[]; subs: string[] } {
  const LABEL = /\blabel:\s*(['"`])((?:\\.|(?!\1).)*)\1/g
  const SUB = /\bsub:\s*(['"`])((?:\\.|(?!\1).)*)\1/g
  return {
    labels: [...source.matchAll(LABEL)].map((m) => m[2]),
    subs: [...source.matchAll(SUB)].map((m) => m[2])
  }
}
