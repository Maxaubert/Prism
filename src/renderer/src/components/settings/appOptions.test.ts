import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DICTATION_OPTIONS } from 'prism-term-core/renderer/settings/dictationOptions'
import { TERMINAL_OPTIONS } from 'prism-term-core/renderer/settings/options'
import { APP_OPTIONS, APP_SECTIONS } from './appOptions'
import { isIconName } from './icons'
import { ROW_ORDER, SETTINGS_PAGES, settingsIndex } from './settingsIndex'

// Prism's command help is Prism Terminal's alone (owner, 2026-09-22), so the
// core's help list is not Prism's to show.
const CORE = [...TERMINAL_OPTIONS, ...DICTATION_OPTIONS]

describe("Prism's own settings rows", () => {
  it('have unique ids, none of them a core row', () => {
    const ids = APP_OPTIONS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(CORE.some((c) => c.id === id), id).toBe(false)
  })

  it('name a known icon, page and section', () => {
    const pages = SETTINGS_PAGES.map((p) => p.id)
    for (const o of APP_OPTIONS) {
      expect(isIconName(o.icon), o.icon).toBe(true)
      expect(pages, o.id).toContain(o.page)
      expect(Object.keys(APP_SECTIONS), o.id).toContain(o.section)
      expect(!!o.view, `${o.id} has a Media view exactly when it is on Media`).toBe(o.page === 'media')
    }
  })

  it('carry a subtext, but for a wall or a grid', () => {
    for (const o of APP_OPTIONS) {
      const block = ['viz-style', 'viz-colour', 'transport-style', 'transport-colour'].includes(o.id)
      expect(o.sub === '', o.id).toBe(block)
    }
  })

  // NO STORAGE KEY CHANGES (2026-10-05, spec 1.1): a key is a saved setting.
  // #298 retired one ON PURPOSE: `prism.mode` is no setting now (Colour mode
  // is gone; the key mirrors the painted theme's mode for the boot screen).
  it('keep every storage key they have always had', () => {
    expect(APP_OPTIONS.map((o) => `${o.id}=${Array.isArray(o.store) ? o.store.join('+') : String(o.store)}`)).toMatchInlineSnapshot(`
      [
        "style-theme=prism.style+prism.style.presets",
        "see-through=prism.style.draft",
        "theme-edits=prism.style.draft+prism.style.presets",
        "c-bg=prism.style.draft",
        "c-chrome=prism.style.draft",
        "c-accent=prism.style.draft",
        "c-selection=prism.style.draft",
        "c-text=prism.style.draft",
        "c-folder-icon=prism.style.draft",
        "c-font=prism.style.draft",
        "tree-size=prism.tree.size",
        "title-bar=prism.window.titleBar",
        "tab-width=prism.window.tabWidth",
        "c-edges=prism.style.draft",
        "c-corners=prism.style.draft",
        "explorer-side=prism.explorer.side",
        "explorer-size=prism.explorer.size",
        "drive-style=prism.sidebar.driveStyle",
        "newtab-mode=prism.newtab.mode+prism.newtab.folder",
        "open-external=prism.open.external",
        "remember-tabs=prism.tabs.remember",
        "remember-folders=prism.explorer.rememberFolders",
        "win-e-shortcut=windows",
        "explorer-verb=windows",
        "default-apps=windows",
        "tree-side=prism.tree.side",
        "newtab-show=prism.newtab.show",
        "viz-style=prism.viz.style+prism.viz.presets",
        "viz-colour=prism.viz.theme",
        "viz-glow=prism.viz.glow",
        "viz-cycle=prism.viz.cycle",
        "viz-move=prism.viz.move",
        "transport-style=prism.transport.style",
        "transport-bg=prism.transport.bg",
        "transport-colour=prism.viz.barTheme",
        "transport-glow=prism.viz.barGlow",
        "transport-cycle=prism.viz.barCycle",
        "transport-move=prism.viz.barMove",
        "app-version=null",
        "show-setup=null",
      ]
    `)
  })

  it('are each drawn by a page, by a literal row id', () => {
    const pages = readdirSync(__dirname)
      .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
      .map((f) => readFileSync(join(__dirname, f), 'utf8'))
      .join('\n')
    const drawn = new Set(
      [...pages.matchAll(/<SettingRow\s+id="([a-z-]+)"|<StyleColour\s+id="([a-z-]+)"|data-pref="([a-z-]+)"|\b(?:block|glow|cycle|move): '([a-z-]+)'/g)].map(
        (m) => m[1] ?? m[2] ?? m[3] ?? m[4]
      )
    )
    expect([...drawn].filter((id) => APP_OPTIONS.some((o) => o.id === id)).sort()).toEqual(APP_OPTIONS.map((o) => o.id).sort())
  })
})

describe('Find a setting', () => {
  it('orders every row once, core and own', () => {
    expect([...ROW_ORDER].sort()).toEqual([...CORE, ...APP_OPTIONS].map((o) => o.id).sort())
  })

  it('indexes what is drawn on this PC: the GPU row only with an NVIDIA card, never command help', () => {
    expect(settingsIndex(true).map((e) => e.id)).toEqual([...ROW_ORDER])
    expect(settingsIndex(false).map((e) => e.id)).toEqual(ROW_ORDER.filter((id) => id !== 'dictation-gpu'))
    expect(settingsIndex(true).some((e) => e.id === 'help-enabled')).toBe(false)
  })

  it('says where each row lives, the style colours under a plain Colours (#302)', () => {
    const at = Object.fromEntries(settingsIndex(true).map((e) => [e.id, `${e.page}/${e.section}${e.view ? `/${e.view}` : ''}`]))
    expect(at['c-accent']).toBe('appearance/Colours')
    expect(at['term-theme']).toBe('terminal/Theme')
    expect(at['term-shell']).toBe('terminal/Shell')
    expect(at['agent-hooks']).toBe('agents/Claude Code')
    expect(at['agent-color']).toBe('agents/Mark colours')
    expect(at['win-e-shortcut']).toBe('explorer/Windows')
    expect(at['tree-side']).toBe('project/Project tabs')
    expect(at['newtab-show']).toBe('project/Project tabs')
    // Two Sidebar positions (#304; owner, 2026-10-07: "two settings, one on
    // the project tab and one on the explorer tab"), each on its own page.
    expect(at['explorer-side']).toBe('explorer/Layout')
    expect(at['explorer-size']).toBe('explorer/Layout')
    expect(at['newtab-mode']).toBe('explorer/Opening things')
    expect(at['transport-bg']).toBe('media/Behind the controls/progress')
    expect(at['viz-glow']).toBe('media/Visualizer colour/visualizer')
    expect(at['dictation-enabled']).toBe('dictation/')
    expect(at['app-version']).toBe('about/')
  })
})
