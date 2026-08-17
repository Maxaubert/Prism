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
