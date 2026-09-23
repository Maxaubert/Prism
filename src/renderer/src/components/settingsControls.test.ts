import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Settings controls are neutral and only Save wears the accent (owner,
// 2026-09-23). Read as source: the Switch, the Segmented and the Default apps
// button must carry no accent token, and the save button still does.
const src = readFileSync(resolve(__dirname, 'Settings.tsx'), 'utf8').replace(/\r\n/g, '\n')
const ACCENT = /--p-(accent|accent-hi|on-accent|sel-bg)\b/
const between = (from: string, to: string): string => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)))

describe('settings controls', () => {
  it('the neutral classes carry no accent outside the focus ring', () => {
    for (const name of ['ROW_BUTTON', 'SEGMENT_ON', 'SWITCH_ON', 'SWITCH_KNOB_ON']) {
      const m = src.match(new RegExp(`const ${name} =\\s*'([^']*)'`))
      expect(m, name).not.toBeNull()
      expect(m![1].replace(/focus-visible:\S+/g, '')).not.toMatch(ACCENT)
    }
  })

  it('Switch, Segmented and Default apps use them', () => {
    expect(between('function Switch(', 'function SwitchItem(')).not.toMatch(ACCENT)
    expect(between('function Segmented<', '\n}\n')).not.toMatch(ACCENT)
    expect(between('id="default-apps"\n', 'Choose in Windows')).toContain('ROW_BUTTON')
  })

  it('the save button still wears the accent', () => {
    expect(between('Nothing to save yet', 'Save changes')).toMatch(/bg-\[var\(--p-accent\)\]/)
  })
})
