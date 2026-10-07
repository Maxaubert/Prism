import { ensureSyntaxTree, foldable } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { classHighlighter, highlightTree } from '@lezer/highlight'
import { describe, expect, it } from 'vitest'
import { langFor } from './codeLang'
import { blankJsonc, jsoncErrors, lintFor, jsoncLinter, syntaxLinter, jsonLinter } from './codeLint'

// #312 (owner, 2026-10-07: "comments in jsonc arent read as comments in
// prism"): every // line in a wrangler.jsonc was plain text under a squiggle.

/** The owner's file, near enough: comments of both kinds and a trailing comma. */
const WRANGLER = `/**
 * For more details on how to configure Wrangler, refer to:
 * https://developers.cloudflare.com/workers/wrangler/configuration/
 */
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-01",
  // "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true, /* on by default */
  },
  "assets": { "directory": "./public/" },
}
`

async function stateFor(name: string, doc: string, path?: string): Promise<EditorState> {
  const lang = langFor(name, path)
  return EditorState.create({ doc, extensions: lang ? [await lang.load()] : [] })
}

/** Each highlighted run as [text, classes]. */
function runs(state: EditorState): Array<[string, string]> {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)
  if (!tree) throw new Error('no tree')
  const out: Array<[string, string]> = []
  highlightTree(tree, classHighlighter, (from, to, cls) => out.push([state.doc.sliceString(from, to), cls]))
  return out
}

describe('which files are JSONC', () => {
  it('maps .jsonc and the well-known JSON-with-comments names', () => {
    for (const n of [
      'wrangler.jsonc', 'a.JSONC', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
      'jsconfig.json', 'jsconfig.base.json', '.eslintrc.json', '.eslintrc', '.babelrc', '.babelrc.json',
      'devcontainer.json', '.devcontainer.json', 'wrangler.json', 'turbo.json', 'biome.json', 'deno.json'
    ]) {
      expect(langFor(n)?.lint, n).toBe('jsonc')
    }
  })

  it('takes every .json in a .vscode folder, and only there', () => {
    for (const n of ['settings.json', 'launch.json', 'tasks.json', 'extensions.json']) {
      expect(langFor(n, `C:\\repo\\.vscode\\${n}`)?.lint, n).toBe('jsonc')
      expect(langFor(n, `/home/u/repo/.vscode/${n}`)?.lint, n).toBe('jsonc')
      expect(langFor(n, `C:\\repo\\config\\${n}`)?.lint, n).toBe('json')
    }
  })

  it('keeps plain JSON strict', () => {
    for (const n of ['package.json', 'a.json', 'tsconfigs.json', 'mytsconfig.json', 'composer.json']) {
      expect(langFor(n)?.lint, n).toBe('json')
    }
    expect(langFor('a.ipynb')?.lint).toBe('json')
  })

  it('colours JSON5 the same way and makes no claims about it', () => {
    expect(langFor('a.json5')?.name).toBe('JSON5')
    expect(langFor('a.json5')?.lint).toBeUndefined()
    expect(lintFor(langFor('a.json5'))).toEqual([])
  })

  it('gives each kind its checker', () => {
    expect(lintFor(langFor('a.jsonc'))).toBe(jsoncLinter)
    expect(lintFor(langFor('a.json'))).toEqual([syntaxLinter, jsonLinter])
    expect(lintFor(langFor('a.py'))).toBe(syntaxLinter)
    expect(lintFor(langFor('a.sh'))).toEqual([])
    expect(lintFor(null)).toEqual([])
  })
})

describe('JSONC colours', () => {
  it('tags both comment kinds as comments', async () => {
    const r = runs(await stateFor('wrangler.jsonc', WRANGLER))
    const line = r.find(([t]) => t.startsWith('// "compatibility_flags"'))
    expect(line?.[1]).toContain('tok-comment')
    expect(r.find(([t]) => t === '/* on by default */')?.[1]).toContain('tok-comment')
    // The block comment over four lines is comment on every line.
    expect(r.filter(([t]) => t.includes('wrangler/configuration')).every(([, c]) => c.includes('tok-comment'))).toBe(true)
  })

  it('a // inside a string is a string, not a comment', async () => {
    const r = runs(await stateFor('a.jsonc', '{ "url": "https://example.com" }'))
    expect(r.find(([t]) => t === '"https://example.com"')?.[1]).toBe('tok-string')
  })

  it('colours JSON exactly as the JSON grammar does', async () => {
    const doc = '{\n  "a": 1.5,\n  "b": [true, false, null, "s"],\n  "c": { "d": -2e3 }\n}\n'
    expect(runs(await stateFor('a.jsonc', doc))).toEqual(runs(await stateFor('a.json', doc)))
  })

  it('folds an object or array to its partner', async () => {
    const state = await stateFor('wrangler.jsonc', WRANGLER)
    ensureSyntaxTree(state, state.doc.length, 5000)
    const lineOf = (text: string): { from: number; to: number } => {
      for (let n = 1; n <= state.doc.lines; n++) {
        const l = state.doc.line(n)
        if (l.text.includes(text)) return l
      }
      throw new Error(text)
    }
    const obs = lineOf('"observability"')
    const range = foldable(state, obs.from, obs.to)
    expect(range).not.toBeNull()
    expect(state.doc.sliceString(range!.from, range!.to)).toContain('"enabled"')
    // A one-line object has nothing to fold.
    const assets = lineOf('"assets"')
    expect(foldable(state, assets.from, assets.to)).toBeNull()
  })
})

describe('jsoncErrors', () => {
  it('passes comments and trailing commas', () => {
    expect(jsoncErrors(WRANGLER)).toEqual([])
    expect(jsoncErrors('// only a comment\n')).toEqual([])
    expect(jsoncErrors('[1, 2, /* x */ ,\n]')).not.toEqual([]) // two commas is still wrong
    expect(jsoncErrors('[1, 2,\n// last\n]')).toEqual([])
  })

  it('keeps every offset, so an error lands where it is', () => {
    const { json } = blankJsonc(WRANGLER)
    expect(json.length).toBe(WRANGLER.length)
    expect(json.split('\n').length).toBe(WRANGLER.split('\n').length)
    expect(json).not.toContain('developers.cloudflare')
    expect(blankJsonc('{"u": "a//b", "v": "/*"}').json).toBe('{"u": "a//b", "v": "/*"}')
  })

  it('still reports a missing comma, at the member that lacks it', () => {
    const doc = '{\n  // a comment\n  "a": 1\n  "b": 2\n}\n'
    const [err] = jsoncErrors(doc)
    expect(err).toBeDefined()
    expect(doc.slice(err.from, err.to)).toBe('"')
    expect(err.from).toBe(doc.indexOf('"b"'))
  })

  it('still reports an unclosed brace and an unclosed comment', () => {
    expect(jsoncErrors('{\n  "a": 1, // x\n').length).toBe(1)
    const [c] = jsoncErrors('{ "a": 1 } /* never closed')
    expect(c.message).toMatch(/never closed/)
    expect(c.from).toBe(11)
  })
})
