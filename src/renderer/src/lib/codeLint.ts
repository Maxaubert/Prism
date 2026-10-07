import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import type { EditorState, Extension } from '@codemirror/state'
import type { CodeLang } from './codeLang'

// The red underline. Prism does not run a language server, so this is honest
// about what it knows: where a Lezer grammar failed to parse, and nothing more.
// No "undefined variable", no type checking - a viewer has no tsconfig and no
// node_modules, and a semantic checker without them just paints every import
// red. Syntax is the part that is true from the file alone.

/** One error is enough; a cascade of them is noise. */
const MAX = 60
/** How long to spend parsing past the viewport before settling for what's there. */
const PARSE_BUDGET_MS = 150

/**
 * Merge error nodes that touch or overlap. A single missing brace makes the
 * parser emit a run of adjacent error nodes, and sixty squiggles for one typo
 * reads as a broken editor rather than a broken file.
 */
function merge(spans: Array<{ from: number; to: number }>): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  for (const s of spans) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to + 1) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

/** Every syntax error the grammar found, merged and capped. Exported for tests. */
export function parseErrors(state: EditorState): Diagnostic[] {
  // The whole document, not just the viewport: a squiggle that only appears
  // once you scroll to it is worse than none. The budget caps the wait on a
  // huge file, in which case we lint whatever has been parsed so far.
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state)
  const spans: Array<{ from: number; to: number }> = []
  tree.iterate({
    enter: (node) => {
      if (!node.type.isError) return undefined
      // A missing token is a zero-width error node. Widen it to one character
      // so there is something to draw the underline beneath; at the very end
      // of the document widen backwards, or an unclosed brace at EOF (the
      // most common syntax error there is) would draw nothing at all.
      let from = node.from
      let to = node.to
      if (to === from) {
        if (from < state.doc.length) to = from + 1
        else from = Math.max(from - 1, 0)
      }
      if (to > from) spans.push({ from, to })
      return spans.length > MAX * 4 ? false : undefined
    }
  })
  return merge(spans)
    .slice(0, MAX)
    .map(({ from, to }) => ({
      from,
      to,
      severity: 'error' as const,
      message: `Syntax error: ${JSON.stringify(state.doc.sliceString(from, Math.min(to, from + 24)))} doesn't belong here.`
    }))
}

/**
 * JSON gets a second opinion. Its Lezer grammar already flags the bad span, but
 * `JSON.parse` names the actual problem ("Expected ',' or '}'"), which is the
 * difference between spotting a typo and hunting for it. Exported for tests.
 */
export function jsonErrors(text: string): Diagnostic[] {
  if (!text.trim()) return []
  try {
    JSON.parse(text)
    return []
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Invalid JSON'
    const at = /at position (\d+)/.exec(raw)
    const pos = at ? Math.min(Number(at[1]), text.length) : 0
    return [
      {
        from: pos,
        to: Math.min(pos + 1, text.length),
        severity: 'error' as const,
        // The trailing "in JSON at position N" is noise once it is underlined.
        message: raw.replace(/\s*in JSON at position .*$/, '')
      }
    ]
  }
}

/**
 * JSONC as plain JSON with the same offsets (#312): every comment and every
 * trailing comma becomes spaces (line breaks kept), so `JSON.parse` judges
 * what is left and a position it names is a position in the file. Strings are
 * copied untouched, so a "//" inside a url stays. Exported for tests.
 */
export function blankJsonc(text: string): { json: string; unclosedComment: number | null } {
  const out = text.split('')
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' '
  }
  // The last comma seen, until something other than space shows whether a
  // closer follows it (comments are already gone by then).
  let comma = -1
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      comma = -1
      let j = i + 1
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      i = j + 1
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      let j = i
      while (j < text.length && text[j] !== '\n') j++
      blank(i, j)
      i = j
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) {
        blank(i, text.length)
        return { json: out.join(''), unclosedComment: i }
      }
      blank(i, end + 2)
      i = end + 2
      continue
    }
    if (c === ',') comma = i
    else if (c === '}' || c === ']') {
      if (comma >= 0) out[comma] = ' '
      comma = -1
    } else if (!/\s/.test(c)) comma = -1
    i++
  }
  return { json: out.join(''), unclosedComment: null }
}

/**
 * JSON's rules less the two JSONC relaxes: comments and trailing commas are
 * fine, a missing comma or an unclosed brace is still an error, said by
 * `JSON.parse` at its real place in the file. Exported for tests.
 */
export function jsoncErrors(text: string): Diagnostic[] {
  const { json, unclosedComment } = blankJsonc(text)
  if (unclosedComment !== null) {
    return [
      {
        from: unclosedComment,
        to: Math.min(unclosedComment + 2, text.length),
        severity: 'error' as const,
        message: 'This comment is never closed'
      }
    ]
  }
  return jsonErrors(json)
}

/**
 * Which squiggles a file gets. A grammar's own error nodes for a parsed
 * language, plus `JSON.parse` for JSON; JSONC gets its own check and NEVER the
 * grammar's (it has none that knows comments); a stream lexer gets nothing.
 */
export function lintFor(lang: CodeLang | null): Extension {
  if (lang?.lint === 'jsonc') return jsoncLinter
  if (lang?.lint === 'json') return [syntaxLinter, jsonLinter]
  return lang?.parsed ? syntaxLinter : []
}

/** Squiggles from the grammar. Only worth attaching to a parsed language. */
export const syntaxLinter = linter((view) => parseErrors(view.state), { delay: 300 })

/** Squiggles from JSON.parse, which explains itself better than the grammar can. */
export const jsonLinter = linter((view) => jsonErrors(view.state.doc.toString()), { delay: 300 })

/** Squiggles for JSON with comments: JSON's errors, never its comments. */
export const jsoncLinter = linter((view) => jsoncErrors(view.state.doc.toString()), { delay: 300 })
