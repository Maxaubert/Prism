import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROW_BUTTON, SEGMENT_ON, SWITCH_KNOB_ON, SWITCH_ON } from './fields'

// Settings controls are neutral and only Save and an on switch (#138) wear the accent (owner,
// 2026-09-23). The e2e measures it on a real page; this holds the source, so
// an accent slipped back into a control fails before anything is built.
const ACCENT = /--p-(accent|accent-hi|on-accent|sel-bg|switch-knob)\b/

const code = (src: string): string[] => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))

describe('settings controls', () => {
  it('row button and pressed segment carry no accent token', () => {
    for (const cls of [ROW_BUTTON, SEGMENT_ON]) {
      // The focus ring may be the accent: it marks the keyboard, not the button.
      expect(cls.replace(/focus-visible:\S+/g, '')).not.toMatch(ACCENT)
    }
  })

  // #138 (owner, 2026-10-07: "yes option 1 but it should depend on the theme
  // so only teal on the teal theme"): an ON switch is the one control that
  // wears the accent, as the fill. Its knob (owner, 2026-10-10: "keep that to
  // being black on dark themes and white on light themes ... only when the
  // color is very close") is the host's --p-switch-knob, and a host that has
  // not defined it yet (Prism) keeps the ink on the accent.
  it('an on switch wears the accent fill with the theme-ink knob', () => {
    expect(SWITCH_ON).toMatch(/(^|\s)bg-\[var\(--p-sel-bg\)\]/)
    expect(SWITCH_KNOB_ON).toBe('bg-[var(--p-switch-knob,var(--p-on-accent))]')
    // Off stays the grey track and the white knob.
    const src = readFileSync(resolve(__dirname, 'fields.tsx'), 'utf8')
    const sw = src.slice(src.indexOf('export function Switch'), src.indexOf('export function parseHexInput'))
    expect(sw).toMatch(/on \? SWITCH_ON : 'bg-\[var\(--p-track\)\]'/)
    expect(sw).toMatch(/on \? SWITCH_KNOB_ON : 'bg-white'/)
  })

  it("dictation's buttons carry no accent", () => {
    const src = readFileSync(resolve(__dirname, 'dictation', 'parts.tsx'), 'utf8')
    for (const name of ['button', 'primary']) {
      const m = src.match(new RegExp(`const ${name} =\\s*'([^']*)'`))
      expect(m, name).not.toBeNull()
      expect(m![1]).not.toMatch(ACCENT)
    }
  })

  // #112: the colour picker's controls are settings controls too. Its buttons
  // are ROW_BUTTON, its thumbs ink on a ring of the ground, and the accent is
  // only ever a focus ring.
  it("the colour picker's controls carry no accent", () => {
    const src = readFileSync(resolve(__dirname, 'ColourPicker.tsx'), 'utf8')
    for (const l of code(src)) expect(l.replace(/focus-visible:\S+/g, '').replace(/const FOCUS =.*/, ''), l).not.toMatch(ACCENT)
    expect(src).toMatch(/\$\{ROW_BUTTON\}/)
  })

  it('the save button still does', () => {
    const src = readFileSync(resolve(__dirname, 'fields.tsx'), 'utf8')
    const save = src.slice(src.indexOf('export function SaveButton'), src.indexOf('export function ThemeHead'))
    expect(save).toMatch(/bg-\[var\(--p-accent\)\]/)
  })

  // THE GROUPED CARDS (2026-10-05). The frame, the section, the row and the
  // block wear no accent at all: the chosen rail page is a GREY fill (owner,
  // no accent bar), focus is a fill or a lighter edge (Q1). Only the flash,
  // a mark and not a button, may (flash.ts).
  it('the layout primitives carry no accent, the flash aside', () => {
    const dir = join(__dirname, 'layout')
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && f !== 'flash.ts')
    expect(files.length).toBeGreaterThanOrEqual(6)
    for (const f of files)
      for (const l of code(readFileSync(join(dir, f), 'utf8'))) expect(l, `${f}: ${l}`).not.toMatch(ACCENT)
    expect(readFileSync(join(dir, 'flash.ts'), 'utf8')).toMatch(/--p-accent-hi/)
  })

  // The sections' buttons are the core's neutral ones (ROW_BUTTON, Save,
  // Reset, the colour field). In Dictation the accent is only on what is not
  // a button: the Recommended and Active badges and the download's progress.
  it("the sections' controls carry no accent; dictation's badges and progress may", () => {
    const dir = join(__dirname, 'sections')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
      const lines = code(readFileSync(join(dir, f), 'utf8'))
      lines.forEach((l, i) => {
        if (!ACCENT.test(l)) return
        expect(f, l).toBe('DictationPage.tsx')
        // The element the class belongs to: the nearest tag opened above it.
        const tag = lines.slice(0, i + 1).reverse().find((x) => /<[a-zA-Z]/.test(x)) ?? ''
        expect(tag, l).toMatch(/<span\b/)
      })
    }
  })
})
