import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyProblem, labelProblem, settingsDescriptions, settingsListCopy, subTooLong } from './settingsCopy'

describe('copyProblem', () => {
  it('passes plain words with commas and full stops', () => {
    expect(copyProblem('The shell that new terminals start with.')).toBeNull()
    expect(copyProblem('The official CUDA 12.4 build, which runs in under a second.')).toBeNull()
  })
  it('refuses any other symbol, apostrophes and ellipses included', () => {
    for (const s of ['Needs Windows 11: yes', "The theme's colour", 'Asking Windows…', 'a - b', 'a (b)', '"quoted"', '50%', 'x/y'])
      expect(copyProblem(s), s).not.toBeNull()
  })
  it('refuses a key name, but not a word that merely contains one', () => {
    expect(copyProblem('Press F1 to open it.')).toMatch(/key/)
    expect(copyProblem('Hold Ctrl while you scroll.')).toMatch(/key/)
    expect(copyProblem('Needs Windows 11.')).toBeNull()
    expect(copyProblem('The tabs and the title bar.')).toBeNull()
  })
})

describe('settingsDescriptions', () => {
  it('finds literal, ternary and template descriptions', () => {
    const src = `<Pref hint="One." /> <Pref hint={on ? 'Two words.' : \`Three \${x} here.\`} /> note: 'Four five.'`
    expect(settingsDescriptions(src)).toEqual(['One.', 'Two words.', 'Three  here.', 'Four five.'])
  })
})

describe('the grouped cards rules (2026-10-05)', () => {
  it('holds a subtext to eight words', () => {
    expect(subTooLong('Lines between panels and around the window.')).toBe(false)
    expect(subTooLong('Speech to text on this PC, never sent.')).toBe(false)
    expect(subTooLong('The colour of the chosen page, buttons, progress bar and visualizer.')).toBe(true)
  })
  it('checks a label for symbols only, never for key names', () => {
    expect(labelProblem('Tab width')).toBeNull()
    expect(labelProblem('Exact status from Claude Code')).toBeNull()
    expect(labelProblem("The theme's colour")).not.toBeNull()
  })
  it('reads the label and sub fields of a list, and nothing else', () => {
    const src = `{ id: 'a', label: 'Tab width', sub: 'Sized to the name.', keywords: 'x y' }\n{ id: 'b', label: "Two", sub: \`Three.\` }`
    expect(settingsListCopy(src)).toEqual({ labels: ['Tab width', 'Two'], subs: ['Sized to the name.', 'Three.'] })
  })
})

/** Every file under a folder, subfolders included. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe("the core's own settings", () => {
  const dir = join(__dirname, '..', 'renderer', 'settings')
  const source = walk(dir).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))

  it('describe every setting in plain words', () => {
    const problems = source.flatMap((f) =>
      settingsDescriptions(readFileSync(f, 'utf8'))
        .map((text) => ({ f, text, problem: copyProblem(text) }))
        .filter((p) => p.problem)
    )
    expect(problems).toEqual([])
  })

  // THE WORD LIMIT: the lists, `layout/` and `sections/`.
  it('keep every new label plain and every new subtext to eight words', () => {
    const fresh = source.filter((f) => {
      const r = relative(dir, f).replace(/\\/g, '/')
      return /^(layout|sections)\//.test(r) || ['diagnosticsOptions.ts', 'coreIndex.ts'].includes(r)
    })
    expect(fresh.length).toBeGreaterThan(10)
    const long: string[] = []
    const bad: string[] = []
    for (const f of fresh) {
      const src = readFileSync(f, 'utf8')
      const { labels, subs } = settingsListCopy(src)
      for (const t of [...subs, ...settingsDescriptions(src)]) {
        if (subTooLong(t)) long.push(t)
        if (copyProblem(t)) bad.push(t)
      }
      for (const t of labels) if (labelProblem(t)) bad.push(t)
    }
    expect(long).toEqual([])
    expect(bad).toEqual([])
  })
})
