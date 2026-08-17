import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { linter, type Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'

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
      // so there is something to draw the underline beneath.
      const to = node.to > node.from ? node.to : Math.min(node.from + 1, state.doc.length)
      if (to > node.from) spans.push({ from: node.from, to })
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

/** Squiggles from the grammar. Only worth attaching to a parsed language. */
export const syntaxLinter = linter((view) => parseErrors(view.state), { delay: 300 })

/** Squiggles from JSON.parse, which explains itself better than the grammar can. */
export const jsonLinter = linter((view) => jsonErrors(view.state.doc.toString()), { delay: 300 })
