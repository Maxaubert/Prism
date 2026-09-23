import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyProblem, settingsDescriptions } from 'prism-term-core/shared/settingsCopy'

// Settings descriptions are plain words (owner, 2026-09-22). The core holds the
// rule and checks its own rows; this holds Prism's own pages to the same one.
describe("Prism's settings", () => {
  it('describe every setting in plain words', () => {
    const files = ['Settings.tsx', 'WinEShortcutSetting.tsx'].map((f) => join(__dirname, f))
    const found = files.flatMap((f) => settingsDescriptions(readFileSync(f, 'utf8')).map((text) => ({ f, text })))
    expect(found.length).toBeGreaterThan(15)
    expect(found.map((d) => ({ ...d, problem: copyProblem(d.text) })).filter((d) => d.problem)).toEqual([])
  })
})
