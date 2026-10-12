import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { langFor } from './codeLang'
import { jsonErrors, parseErrors } from './codeLint'

/** A document as the editor would hold it, with its language attached. */
async function stateFor(name: string, doc: string): Promise<EditorState> {
  const lang = langFor(name)
  return EditorState.create({ doc, extensions: lang ? [await lang.load()] : [] })
}

describe('parseErrors', () => {
  it('says nothing about a file that parses', async () => {
    expect(parseErrors(await stateFor('a.py', 'def f(x):\n    return x + 1\n'))).toEqual([])
    expect(parseErrors(await stateFor('a.ts', 'const a: number = 1\nexport { a }\n'))).toEqual([])
    expect(parseErrors(await stateFor('a.json', '{"a": [1, 2]}'))).toEqual([])
  })

  it('underlines a syntax error', async () => {
    const errs = parseErrors(await stateFor('a.ts', 'function f( { return 1\n'))
    expect(errs.length).toBeGreaterThan(0)
    expect(errs[0].severity).toBe('error')
  })

  it('points at the offending text, not the whole file', async () => {
    const doc = 'const a = 1\nconst b = = 2\nconst c = 3\n'
    const [first] = parseErrors(await stateFor('a.js', doc))
    expect(first).toBeDefined()
    expect(first.to).toBeGreaterThan(first.from)
    // The problem is on line 2; nothing should be flagged before it.
    expect(first.from).toBeGreaterThanOrEqual(doc.indexOf('\n'))
  })

  it('merges the cascade one typo causes into few marks', async () => {
    // An unclosed brace makes the parser fail its way to the end of the file.
    const doc = 'function f() {\n' + '  const x = 1\n'.repeat(40)
    expect(parseErrors(await stateFor('a.js', doc)).length).toBeLessThanOrEqual(3)
  })

  // The promise the two tiers make: a stream lexer colours and claims nothing.
  it('never invents errors for a language with no grammar', async () => {
    expect(parseErrors(await stateFor('a.sh', 'if [ then ;; fi ) ) }\n'))).toEqual([])
    expect(parseErrors(await stateFor('notes.txt', 'a ) { unbalanced\n'))).toEqual([])
  })

  it('still squiggles when the only error sits at end-of-document', async () => {
    // An unclosed brace at EOF is a zero-width error node at exactly
    // doc.length. It must widen backwards, not be silently dropped.
    for (const doc of ['function f( {', 'function f( {\n']) {
      expect(parseErrors(await stateFor('a.ts', doc)).length).toBeGreaterThan(0)
    }
  })

  it('parses .sass as indented syntax, not SCSS', async () => {
    // Valid indented Sass must be clean; with the default (SCSS) grammar it
    // would underline nearly every line.
    expect(parseErrors(await stateFor('a.sass', '.a\n  color: red\n'))).toEqual([])
    expect(parseErrors(await stateFor('a.scss', '.a { color: red }\n'))).toEqual([])
  })
})

// Every language that claims `parsed: true` must actually produce a diagnostic
// on broken input, measured rather than assumed: a grammar can exist and still
// recover so well it never emits an error node, and then the squiggle promise
// the tier makes is a lie.
describe('squiggle coverage', () => {
  // Deliberately broken source per parsed language. null marks a grammar that
  // never errors by design: Markdown treats any text as valid markdown.
  const BROKEN: Record<string, string | null> = {
    JavaScript: 'function f( { return 1\n',
    JSX: 'const a = <div><span></div>\nfunction f( {\n',
    TypeScript: 'export function add(a: number, b: number {\n  return a + b\n}\n',
    TSX: 'const x: number = <div>\nfunction f( {\n',
    JSON: '{ "a": 1, }\n',
    CSS: '.a { color: red\n.b { display: flex }\n',
    SCSS: '.a { color: red\n.b { display: flex }\n',
    Sass: '.a\n  color: red\n    :::\n',
    Less: '.a { color: red\n.b { display: flex }\n',
    HTML: '<div><span></div>\n<p>\n',
    Vue: '<template><div></span></template>\n',
    XML: '<a x=></a>\n',
    Python: 'def f(x):\n    if x:\n        print("a"\n    else:\n        pass\n',
    Markdown: null,
    Rust: 'fn main( {\n    let x = 1;\n}\n',
    'C++': 'int main( {\n  return 0;\n}\n',
    Java: 'class A { void f( { } }\n',
    PHP: '<?php function f( { return 1; }\n',
    SQL: 'SELECT FROM WHERE ORDER manifestly not sql (((\n',
    YAML: 'a: 1\n  b: [1, 2\n   - broken\n',
    Go: 'package main\nfunc main( {\n}\n'
  }

  // The viewable text extensions, scraped from fileKind.ts the same way
  // fileAssoc.test.ts scrapes it.
  const EXTS = (() => {
    const src = readFileSync('src/shared/fileKind.ts', 'utf8')
    const body = /const TEXT = new Set\(\[([\s\S]*?)\]\)/.exec(src)?.[1] ?? ''
    return [...body.matchAll(/'(\.[a-z0-9]+)'/gi)].map((m) => m[1].toLowerCase())
  })()

  it('the scrape still finds the extension list', () => {
    // A reformat of fileKind.ts that breaks the regex must fail here, loudly,
    // not shrink the sweep below to zero extensions and pass vacuously.
    expect(EXTS.length).toBeGreaterThan(100)
  })

  it('every parsed language squiggles on broken input', async () => {
    const langs = new Map<string, string>() // language name -> one extension
    for (const ext of EXTS) {
      const lang = langFor('x' + ext)
      if (lang?.parsed && !langs.has(lang.name)) langs.set(lang.name, ext)
    }
    expect(langs.size).toBeGreaterThanOrEqual(20)

    const silent: string[] = []
    for (const [name, ext] of langs) {
      const sample = BROKEN[name]
      if (sample === undefined) {
        silent.push(`${name} (no broken sample in this test)`)
        continue
      }
      if (sample === null) continue
      if (parseErrors(await stateFor('x' + ext, sample)).length === 0) silent.push(name)
    }
    expect(silent).toEqual([])
  })
})

describe('jsonErrors', () => {
  it('passes valid JSON, including an empty file', () => {
    expect(jsonErrors('{"a": 1}')).toEqual([])
    expect(jsonErrors('   ')).toEqual([])
  })

  it('locates a trailing comma and explains it in words', () => {
    const [err] = jsonErrors('{\n  "a": 1,\n}\n')
    expect(err).toBeDefined()
    expect(err.from).toBeGreaterThan(0)
    // The position is already shown by the underline; the words shouldn't repeat it.
    expect(err.message).not.toMatch(/at position/)
    expect(err.message.length).toBeGreaterThan(0)
  })
})
