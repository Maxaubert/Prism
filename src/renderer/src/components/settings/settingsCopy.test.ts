import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  copyProblem,
  labelProblem,
  settingsDescriptions,
  settingsListCopy,
  subTooLong
} from 'prism-term-core/shared/settingsCopy'

// Settings descriptions are plain words (owner, 2026-09-22). The core holds the
// rule and checks its own rows; this holds Prism's own pages to the same one.
// Every file of this folder is the grouped cards page (2026-10-05, #292), so
// the eight word limit holds for all of it.
const files = readdirSync(__dirname)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ f, src: readFileSync(join(__dirname, f), 'utf8') }))

describe("Prism's settings", () => {
  it('describe every setting in plain words', () => {
    const found = files.flatMap(({ f, src }) => settingsDescriptions(src).map((text) => ({ f, text })))
    expect(found.length).toBeGreaterThan(3)
    expect(found.map((d) => ({ ...d, problem: copyProblem(d.text) })).filter((d) => d.problem)).toEqual([])
  })

  it('keep each subtext to one short line, and each label plain', () => {
    const subs = files.flatMap(({ src }) => [...settingsDescriptions(src), ...settingsListCopy(src).subs]).filter(Boolean)
    const labels = files.flatMap(({ src }) => settingsListCopy(src).labels)
    expect(subs.length).toBeGreaterThan(30)
    expect(labels.length).toBeGreaterThan(30)
    expect(subs.filter(subTooLong)).toEqual([])
    expect(subs.filter((t) => copyProblem(t))).toEqual([])
    expect(labels.filter((t) => labelProblem(t))).toEqual([])
  })
})
