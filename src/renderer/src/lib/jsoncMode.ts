import { foldService, matchBrackets, StreamLanguage, syntaxTree, type StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

// JSON with comments (#312; owner, 2026-10-07: "comments in jsonc arent read
// as comments in prism"). tsconfig.json, .vscode/settings.json, wrangler.jsonc
// and the like are JSONC: // and /* */ comments, and trailing commas, which
// VS Code and TypeScript accept. The Lezer JSON grammar has no comment token,
// so a // line came out as error nodes: plain-coloured text under a red
// squiggle on every comment.
//
// This is a tokenizer, not a grammar: it colours with the SAME tags the Lezer
// JSON grammar uses (so a JSONC file looks like a JSON file, plus comments in
// the theme's comment colour), and errors come from `jsoncErrors` in
// codeLint.ts, which knows the actual rules. It is lenient on purpose (single
// quotes, bare keys, hex), so JSON5 colours with it too.

type State = { depth: number; inBlock: boolean }

/** The rest of a block comment, or of the line when it does not close here. */
function blockRest(stream: { match: (p: RegExp) => unknown; skipToEnd: () => void }, state: State): string {
  if (stream.match(/^[\s\S]*?\*\//)) state.inBlock = false
  else stream.skipToEnd()
  return 'blockComment'
}

export const jsoncParser: StreamParser<State> = {
  name: 'jsonc',
  startState: () => ({ depth: 0, inBlock: false }),
  copyState: (s) => ({ ...s }),
  token(stream, state) {
    if (state.inBlock) return blockRest(stream, state)
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'lineComment'
    }
    if (stream.match('/*')) {
      state.inBlock = true
      return blockRest(stream, state)
    }
    const ch = stream.peek()
    if (ch === '"' || ch === "'") {
      stream.next()
      let escaped = false
      for (let c = stream.next(); c !== undefined; c = stream.next()) {
        if (c === ch && !escaped) break
        escaped = !escaped && c === '\\'
      }
      // A key is a string followed by a colon, which is how the grammar
      // tells PropertyName from String too.
      return stream.match(/^\s*:/, false) ? 'propertyName' : 'string'
    }
    if (stream.match(/^[+-]?(?:0x[0-9a-f]+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|Infinity|NaN)/i)) return 'number'
    if (stream.match(/^(?:true|false)\b/)) return 'bool'
    if (stream.match(/^null\b/)) return 'null'
    if (stream.match(/^[A-Za-z_$][\w$]*/)) return stream.match(/^\s*:/, false) ? 'propertyName' : null
    stream.next()
    if (ch === '{' || ch === '[') state.depth += 1
    if (ch === '}' || ch === ']') state.depth = Math.max(0, state.depth - 1)
    if (ch === '{' || ch === '}') return 'brace'
    if (ch === '[' || ch === ']') return 'squareBracket'
    if (ch === ',' || ch === ':') return 'separator'
    return null
  },
  indent(state, textAfter, cx) {
    const closes = /^\s*[}\]]/.test(textAfter) ? 1 : 0
    return Math.max(0, state.depth - closes) * cx.unit
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['[', '{', '"'] }
  }
}

const COMMENT = /Comment$/

/**
 * Folding, which a stream language does not get for free: a line whose last
 * token (comments aside) opens a brace or bracket folds to its partner.
 */
const jsoncFold = foldService.of((state, lineStart, lineEnd) => {
  let open = -1
  syntaxTree(state).iterate({
    from: lineStart,
    to: lineEnd,
    enter: (node) => {
      if (node.from < lineStart || node.to > lineEnd || node.type.isTop) return
      if (COMMENT.test(node.name)) return
      const text = state.doc.sliceString(node.from, node.to)
      open = text === '{' || text === '[' ? node.from : -1
    }
  })
  if (open < 0) return null
  const match = matchBrackets(state, open, 1)
  if (!match?.matched || !match.end || match.end.from <= lineEnd) return null
  return { from: open + 1, to: match.end.from }
})

export const jsoncLanguage = StreamLanguage.define(jsoncParser)

/** The language and its folding, as the editor attaches them. */
export function jsonc(): Extension {
  return [jsoncLanguage, jsoncFold]
}
