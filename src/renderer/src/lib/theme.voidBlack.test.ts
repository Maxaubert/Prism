import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STYLES, variablesFor, withoutOwn, type Style } from './theme'
import { CATALOGUE } from './themes/catalogue'

// VOID IS ALL BLACK (#313; owner, 2026-10-07, of Void's Background #000000
// and "Sidebar and tab bar colour" #070707: "make void fully black for both of
// these"). The other themes keep a panel a step off their ground (#302).

const VOID = STYLES.find((s) => s.id === 'new-void') as Style

describe('Void', () => {
  it('paints the sidebar, the title bar and the tab bar the black of its ground', () => {
    const v = variablesFor(VOID)
    expect(VOID.bg).toBe('#000000')
    for (const k of ['--p-bg', '--p-side', '--p-side-flat', '--p-title', '--p-tabs', '--p-tab-active']) expect(v[k], k).toBe('#000000')
  })

  it('still draws its edges, its menus and its selection off the black', () => {
    const v = variablesFor(VOID)
    expect(v['--p-edge']).not.toBe('#000000')
    expect(v['--p-raised']).toBe('#0f0f10')
    expect(v['--p-line']).toBe('#151516')
    expect(v['--p-sel-tint-seen']).not.toBe('#000000')
  })

  it('is the only theme whose panel is its ground', () => {
    expect(CATALOGUE.filter((t) => t.panel === t.ground).map((t) => t.id)).toEqual(['new-void'])
  })
})

describe('a saved edit the theme has caught up with', () => {
  it('is no edit: a hand-set black sidebar on Void is dropped, the rest kept', () => {
    const draft = { side: '#000000', title: '#000000', tabs: '#000000', accent: '#22aa66' }
    expect(withoutOwn(VOID, draft)).toEqual({ accent: '#22aa66' })
    expect(withoutOwn(VOID, { side: '#000000', title: '#000000', tabs: '#000000' })).toEqual({})
  })

  it('keeps a colour that differs, and hands the same draft back when nothing moved', () => {
    const draft = { side: '#070707', title: '#070707', tabs: '#070707' }
    expect(withoutOwn(VOID, draft)).toBe(draft)
    // A panel with an alpha of its own is not the theme's solid panel.
    const own = { side: '#00000080', title: '#00000080', tabs: '#00000080' }
    expect(withoutOwn(VOID, own)).toBe(own)
  })

  it("drops the other roles when they are the style's own", () => {
    expect(withoutOwn(VOID, { bg: '#000000', text: VOID.text, accent: VOID.accent })).toEqual({})
  })
})

describe('at the store', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    vi.stubGlobal('window', new EventTarget())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("the owner's hand-set black on Void opens as no edit: no Reset, Save changes not lit", async () => {
    localStorage.setItem('prism.style', 'new-void')
    localStorage.setItem('prism.style.v', '2')
    localStorage.setItem('prism.style.draft', JSON.stringify({ side: '#000000', title: '#000000', tabs: '#000000' }))
    const theme = await import('./theme')
    expect(theme.currentStyle().id).toBe('new-void')
    expect(theme.isEdited()).toBe(false)
    expect(JSON.parse(localStorage.getItem('prism.style.draft') ?? 'null')).toEqual({})
  })

  it('an edit that still differs stays an edit', async () => {
    localStorage.setItem('prism.style', 'new-void')
    localStorage.setItem('prism.style.v', '2')
    localStorage.setItem('prism.style.draft', JSON.stringify({ side: '#101010', title: '#101010', tabs: '#101010' }))
    const theme = await import('./theme')
    expect(theme.isEdited()).toBe(true)
  })
})
