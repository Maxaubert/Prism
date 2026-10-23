import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { labelProblem, copyProblem, subTooLong } from '../../shared/settingsCopy'
import { DIAGNOSTICS_OPTIONS } from './diagnosticsOptions'
import { DICTATION_OPTIONS, dictationOptionIds } from './dictationOptions'
import { HELP_OPTIONS } from './helpOptions'
import { MARK_OPTIONS } from './markOptions'
import { isSettingIcon } from './layout/icons'
import { TERMINAL_OPTIONS, terminalOptionIds } from './options'
import { SETTINGS_SECTIONS } from './sectionIds'

// The list and the sections must say the same thing: the list is what each
// host's parity check compares its Settings page against, so a row added to a
// section and not to the list (or the other way round) would let the two apps
// drift while every test stayed green.

/** Every file under this folder, subfolders included (`sections/`, `theme/`,
 *  `dictation/`, `layout/`): a scan of the top level alone would leave the
 *  grouped cards' sections unchecked. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
const files = walk(__dirname).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
const sections = files
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

/** Every row id a shared section renders: `<Pref id="x"`, `<SettingRow id="x"`
 *  and `data-pref="x"`. */
const rendered = new Set(
  // AgentColourRow: the three mark colours' one row (MarkColoursSection).
  [...sections.matchAll(/<(?:Pref|SettingRow|AgentColourRow)\s+id="([a-z-]+)"|data-pref="([a-z-]+)"/g)].map(
    (m) => m[1] ?? m[2]
  )
)

// The marks' own rows (#143) are drawn right after the Finished switch.
const TERMINAL_AND_MARKS = TERMINAL_OPTIONS.flatMap((o) => (o.id === 'agent-done-on' ? [o, ...MARK_OPTIONS] : [o]))
const ALL = [...TERMINAL_AND_MARKS, ...DICTATION_OPTIONS, ...HELP_OPTIONS, ...DIAGNOSTICS_OPTIONS]
const LIST_FILES = ['options.ts', 'markOptions.ts', 'dictationOptions.ts', 'helpOptions.ts', 'diagnosticsOptions.ts']

describe('the terminal options list', () => {
  it('names every row the shared sections render, and nothing they do not', () => {
    expect([...rendered].sort()).toEqual(ALL.map((o) => o.id).sort())
  })

  it('has one storage key per option, all under prism.term', () => {
    const keys = TERMINAL_OPTIONS.map((o) => o.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k.startsWith('prism.term.')).toBe(true)
  })

  it('shows the same list in every host, with no Opacity row any more (#114)', () => {
    // The one row that differed was the Opacity slider, Prism Terminal only;
    // the theme Background's alpha took its place.
    expect(terminalOptionIds({ windowAcrylic: true })).toEqual(terminalOptionIds({ windowAcrylic: false }))
    expect(TERMINAL_OPTIONS.some((o) => o.id === 'term-opacity' || o.key === 'prism.term.opacity')).toBe(false)
  })

  it('gives dictation one key per option, under prism.dictation, and only the GPU row none', () => {
    const keys = DICTATION_OPTIONS.map((o) => o.key).filter((k): k is string => k !== null)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k.startsWith('prism.dictation.')).toBe(true)
    expect(DICTATION_OPTIONS.filter((o) => o.key === null).map((o) => o.id)).toEqual(['dictation-gpu'])
  })

  it('keeps command help in a list of its own, under prism.help', () => {
    // NOT in TERMINAL_OPTIONS: Prism's gate reads that file as text, and a row
    // there would fail Prism's parity check until Prism had wired the panel.
    expect(HELP_OPTIONS.map((o) => o.id)).toEqual(['help-enabled'])
    for (const o of HELP_OPTIONS) expect(o.key.startsWith('prism.help.')).toBe(true)
    expect(TERMINAL_OPTIONS.some((o) => o.id.startsWith('help'))).toBe(false)
  })

  it("keeps the tab marks' rows in a list of their own, under prism.term (#143)", () => {
    // NOT in TERMINAL_OPTIONS: Prism's gate reads that file as text and orders
    // every id in it, and Prism's strip does not draw the rainbow.
    expect(MARK_OPTIONS.map((o) => o.id)).toEqual(['agent-rainbow'])
    for (const o of MARK_OPTIONS) expect(o.key.startsWith('prism.term.')).toBe(true)
    expect(TERMINAL_OPTIONS.some((o) => MARK_OPTIONS.some((m) => m.id === o.id || m.key === o.key))).toBe(false)
  })

  it('offers the GPU row only where an NVIDIA adapter is present', () => {
    const all = dictationOptionIds({ nvidia: true })
    const without = dictationOptionIds({ nvidia: false })
    expect(all.filter((id) => !without.includes(id))).toEqual(['dictation-gpu'])
  })

  // NO STORAGE KEY CHANGES (2026-10-05, spec 1.1): a key is a saved setting.
  it('keeps every storage key it has always had', () => {
    expect(ALL.map((o) => `${o.id}=${o.key}`)).toMatchInlineSnapshot(`
      [
        "term-shell=prism.term.shell",
        "term-font-family=prism.term.font",
        "term-font=prism.term.fontPct",
        "agent-indicator=prism.term.agentIndicator",
        "agent-done-on=prism.term.agentDoneOn",
        "agent-rainbow=prism.term.agentRainbow",
        "agent-question-on=prism.term.agentQuestionOn",
        "agent-failed-on=prism.term.agentFailedOn",
        "agent-hooks=prism.term.agentHooks",
        "term-theme=prism.term.theme",
        "term-acrylic=prism.term.acrylic",
        "agent-color=prism.term.agentColor",
        "agent-done-color=prism.term.agentDoneColor",
        "agent-question-color=prism.term.agentQuestionColor",
        "dictation-enabled=prism.dictation.enabled",
        "dictation-mode=prism.dictation.mode",
        "dictation-hotkey=prism.dictation.hotkey",
        "dictation-mic=prism.dictation.mic",
        "dictation-language=prism.dictation.language",
        "dictation-pause-media=prism.dictation.pauseMedia",
        "dictation-sounds=prism.dictation.sounds",
        "dictation-model=prism.dictation.model",
        "dictation-gpu=null",
        "help-enabled=prism.help.enabled",
        "diag-verbose=null",
        "diag-folder=null",
        "diag-mark=null",
      ]
    `)
  })
})

describe('the grouped cards fields of the lists (2026-10-05)', () => {
  it('gives every entry a known section, a known icon and a subtext', () => {
    for (const o of ALL) {
      expect(Object.keys(SETTINGS_SECTIONS), o.id).toContain(o.section)
      expect(isSettingIcon(o.icon), `${o.id}: ${o.icon}`).toBe(true)
      expect(o.sub.length, o.id).toBeGreaterThan(0)
    }
  })

  it('keeps the list order inside every section, which is the order the sections draw', () => {
    // The order did not change with the redesign: within each section it is
    // already the display order, which keeps Prism's current gate green.
    const grouped = files
      .filter((f) => f.includes(`${join('settings', 'sections')}`) && f.endsWith('.tsx'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    const drawn = [...grouped.matchAll(/<(?:SettingRow|AgentColourRow)\s+id="([a-z-]+)"|data-pref="([a-z-]+)"/g)].map(
      (m) => m[1] ?? m[2]
    )
    for (const s of Object.keys(SETTINGS_SECTIONS)) {
      const ids = ALL.filter((o) => o.section === s).map((o) => o.id)
      expect(drawn.filter((id) => ids.includes(id)), s).toEqual(ids)
    }
  })

  it('words every label and subtext in plain words, each subtext at most eight', () => {
    for (const o of ALL) {
      expect(labelProblem(o.label), o.label).toBeNull()
      expect(copyProblem(o.sub), o.sub).toBeNull()
      expect(subTooLong(o.sub), o.sub).toBe(false)
    }
  })

  // PRISM'S GATE READS THESE FILES AS TEXT: an entry is `{ id: '...'` up to
  // its first closing brace, and the GPU row is skipped by finding the word
  // onlyWhere inside that text. So no entry may hold a brace of its own, and
  // the word appears only as the field's name.
  it('keeps every entry flat, on one line, with no brace inside it', () => {
    for (const f of LIST_FILES) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      const entries = [...src.matchAll(/\{\s*id: '([a-z-]+)'[^}]*\}/g)]
      const ids = entries.map((m) => m[1])
      const list =
        f === 'options.ts'
          ? TERMINAL_OPTIONS
          : f === 'markOptions.ts'
            ? MARK_OPTIONS
          : f === 'dictationOptions.ts'
            ? DICTATION_OPTIONS
            : f === 'diagnosticsOptions.ts'
              ? DIAGNOSTICS_OPTIONS
              : HELP_OPTIONS
      expect(ids, f).toEqual(list.map((o) => o.id))
      for (const m of entries) {
        expect(m[0].includes('\n'), m[1]).toBe(false)
        expect(m[0].split('{').length - 1, m[1]).toBe(1)
        expect((m[0].match(/onlyWhere/g) ?? []).length, m[1]).toBe(m[0].includes('onlyWhere:') ? 1 : 0)
      }
    }
  })
})
