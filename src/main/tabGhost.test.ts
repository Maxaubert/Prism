import { describe, expect, it } from 'vitest'
import { GHOST_HTML, GHOST_PAGE, ONE_FRAME, createTabGhost, paintScript, type GhostWin } from './tabGhost'
import { TEAR, type Bounds } from '@shared/tabTear'

// THE GHOST'S WINDOW (owner, 2026-10-30: "let it just be the tab you're
// carrying, that's how file explorer does it"): its page, what it is handed,
// and when it shows, with a fake window and a page that runs the paint by hand.

interface FakeGhost extends GhostWin {
  visible: boolean
  moves: Bounds[]
  scripts: string[]
  /** Settle the page's scripts pending now (true: it painted, or drew). */
  run(ok?: boolean): Promise<void>
  log: string[]
  gone: boolean
  /** What getBounds answers the next time (a jump across scales). */
  skew: Bounds | null
}
function fakeGhost(): FakeGhost {
  const waiting: Array<(v: unknown) => void> = []
  let bounds: Bounds = { x: 0, y: 0, width: 154, height: 72 }
  const g: FakeGhost = {
    visible: false,
    moves: [],
    scripts: [],
    log: [],
    gone: false,
    skew: null,
    isDestroyed: () => g.gone,
    isVisible: () => g.visible,
    getBounds: () => {
      const b = g.skew ?? bounds
      g.skew = null
      return { ...b }
    },
    setBounds: (b) => {
      bounds = { ...b }
      g.moves.push({ ...b })
      g.log.push('bounds')
    },
    setOpacity: (o) => g.log.push(`opacity ${o}`),
    showInactive: () => {
      g.visible = true
      g.log.push('show')
    },
    hide: () => {
      g.visible = false
      g.log.push('hide')
    },
    moveTop: () => g.log.push('top'),
    destroy: () => {
      g.gone = true
    },
    webContents: {
      executeJavaScript: (code) => {
        g.scripts.push(code)
        return new Promise((resolve) => waiting.push(resolve))
      }
    },
    run: async (ok = true) => {
      for (const r of waiting.splice(0)) r(ok)
      await Promise.resolve()
      await Promise.resolve()
    }
  }
  return g
}

function rig(e2e = false) {
  const made: FakeGhost[] = []
  let ready: (() => void) | null = null
  let gone: (() => void) | null = null
  /** One-shot timers, run by hand. */
  const timers: Array<{ fn: () => void; ms: number } | null> = []
  const ghost = createTabGhost<FakeGhost>({
    e2e,
    base: () => '#111318',
    make: (r, x) => {
      ready = r
      gone = x
      const g = fakeGhost()
      made.push(g)
      return g
    },
    after: (fn, ms) => timers.push({ fn, ms }) - 1,
    cancel: (h) => {
      timers[h as number] = null
    }
  })
  return {
    ghost,
    made,
    loaded: () => ready?.(),
    closed: () => gone?.(),
    /** Every timer due runs. */
    elapse: () => timers.splice(0).forEach((t) => t?.fn()),
    timers: () => timers.filter(Boolean)
  }
}

const face = { label: 'Photos', size: { width: 114, height: 32 } }
const at = { x: 400, y: 300, width: 154, height: 72 }

describe('the ghost page', () => {
  it('runs no script of its own and loads nothing', () => {
    expect(GHOST_HTML).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`)
    expect(GHOST_HTML).not.toMatch(/<script|\son\w+=|\ssrc=|\shref=/i)
    expect(GHOST_PAGE.startsWith('data:text/html;charset=utf-8,')).toBe(true)
  })

  it('hands the label over as data, never as markup', () => {
    const evil = `</script><img src=x onerror="alert(1)">'); alert(2); ('`
    const js = paintScript({ ...face, label: evil }, '#111318')
    // The one value it is called with is JSON: the label is a string in it.
    const arg = js.slice(js.lastIndexOf('})(') + 3, -1)
    expect(JSON.parse(arg).label).toBe(evil)
    // And the page reads it as text.
    expect(js).toContain('l.textContent = v.label')
    expect(js).not.toContain('innerHTML')
  })

  it('cuts a very long label, and takes its own colours for a look that fails the check', () => {
    const js = paintScript({ ...face, label: 'a'.repeat(500), look: { ground: 'url(x)', ink: '#fff', edge: '#fff', accent: '#fff', font: 'x' } }, '#111318')
    const v = JSON.parse(js.slice(js.lastIndexOf('})(') + 3, -1))
    expect(v.label.length).toBe(200)
    expect(v.ground).not.toContain('url')
    expect(v.base).toBe('#111318')
  })

  it('holds a huge tab from a page to a tab size (review 2026-10-30)', () => {
    const js = paintScript({ ...face, size: { width: 1e5, height: 1e5 } }, '#111318')
    const v = JSON.parse(js.slice(js.lastIndexOf('})(') + 3, -1))
    expect(v.w).toBe(TEAR.tabMaxWidth)
    expect(v.h).toBe(TEAR.tabMaxHeight)
  })
})

describe('the ghost window', () => {
  it('is made warm, shows only once its page has the face, placed first, and clear until it has drawn', async () => {
    const r = rig()
    r.ghost.warm()
    expect(r.made).toHaveLength(1)
    let shown = 0
    r.ghost.show(face, at, () => (shown += 1))
    // Not loaded yet: nothing painted, nothing shown.
    expect(r.made[0].scripts).toHaveLength(0)
    r.loaded()
    expect(r.made[0].scripts).toHaveLength(1)
    expect(r.made[0].visible).toBe(false)
    await r.made[0].run()
    // Placed, shown CLEAR, in front; and waiting for a frame on screen.
    expect(r.made[0].log).toEqual(['bounds', 'opacity 0', 'show', 'top'])
    expect(r.made[0].scripts.at(-1)).toBe(ONE_FRAME)
    expect(shown).toBe(0)
    await r.made[0].run()
    expect(r.made[0].log).toEqual(['bounds', 'opacity 0', 'show', 'top', 'opacity 0.85'])
    expect(r.made[0].moves).toEqual([at])
    expect(shown).toBe(1)
    expect(r.timers()).toHaveLength(0)
    expect(r.ghost.state()).toMatchObject({ made: true, ready: true, visible: true, bounds: at, label: 'Photos' })
  })

  it('a new face never shows the last one: painted hidden, opaque only after a frame of its own (review 2026-10-30)', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    r.ghost.show(face, at, () => {})
    await r.made[0].run()
    await r.made[0].run()
    r.ghost.hide()
    r.made[0].log.length = 0
    let music = false
    r.ghost.show({ ...face, label: 'Music' }, at, () => (music = true))
    expect(r.made[0].visible).toBe(false)
    await r.made[0].run()
    expect(r.made[0].log).toEqual(['bounds', 'opacity 0', 'show', 'top'])
    expect(music).toBe(false)
    await r.made[0].run()
    expect(r.made[0].log.at(-1)).toBe('opacity 0.85')
    expect(music).toBe(true)
  })

  it('a page that never says it drew still lights up, after a while', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    let shown = false
    r.ghost.show(face, at, () => (shown = true))
    await r.made[0].run()
    expect(r.timers()).toEqual([expect.objectContaining({ ms: TEAR.drawnMs })])
    r.elapse()
    expect(shown).toBe(true)
    expect(r.made[0].log.at(-1)).toBe('opacity 0.85')
    // The frame that comes late changes nothing.
    await r.made[0].run()
    expect(r.made[0].log.filter((x) => x === 'opacity 0.85')).toHaveLength(1)
  })

  it('placed again when a jump to a display of another scale got it wrong (review 2026-10-30)', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    r.ghost.show(face, at, () => {})
    r.made[0].skew = { x: 178, y: 133, width: 68, height: 32 }
    await r.made[0].run()
    expect(r.made[0].moves).toEqual([at, at])
  })

  it('follows the moves while shown, the size passed every time', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    r.ghost.move(at)
    expect(r.made[0].moves).toEqual([])
    r.ghost.show(face, at, () => {})
    await r.made[0].run()
    r.ghost.move({ x: 410, y: 300, width: 154, height: 72 })
    expect(r.made[0].moves.at(-1)).toEqual({ x: 410, y: 300, width: 154, height: 72 })
  })

  it('the same face again needs no repaint; a hide before the paint shows nothing', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    r.ghost.show(face, at, () => {})
    await r.made[0].run()
    await r.made[0].run()
    r.ghost.hide()
    expect(r.made[0].visible).toBe(false)
    let again = false
    r.ghost.show(face, at, () => (again = true))
    // Shown again with no paint, lit after a frame.
    expect(r.made[0].visible).toBe(true)
    await r.made[0].run()
    expect(again).toBe(true)
    expect(r.made[0].scripts.filter((s) => s !== ONE_FRAME)).toHaveLength(1)
    r.ghost.hide()
    let other = false
    r.ghost.show({ ...face, label: 'Music' }, at, () => (other = true))
    r.ghost.hide()
    await r.made[0].run()
    await r.made[0].run()
    expect(other).toBe(false)
    expect(r.made[0].visible).toBe(false)
    expect(r.ghost.state()).toMatchObject({ visible: false, bounds: null, label: null })
  })

  it('asked again while still up (the last drop waits to hide it): the same face answers at once, another goes first', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    r.ghost.show(face, at, () => {})
    await r.made[0].run()
    await r.made[0].run()
    let same = false
    r.ghost.show(face, at, () => (same = true))
    expect(same).toBe(true)
    r.made[0].log.length = 0
    let other = false
    r.ghost.show({ ...face, label: 'Music' }, at, () => (other = true))
    expect(r.made[0].log).toEqual(['hide'])
    await r.made[0].run()
    await r.made[0].run()
    expect(other).toBe(true)
    expect(r.made[0].visible).toBe(true)
  })

  it('a page that did not paint shows nothing', async () => {
    const r = rig()
    r.ghost.warm()
    r.loaded()
    let shown = false
    r.ghost.show(face, at, () => (shown = true))
    await r.made[0].run(false)
    expect(shown).toBe(false)
    expect(r.made[0].visible).toBe(false)
  })

  it('a window that went is made again when next wanted', () => {
    const r = rig()
    r.ghost.warm()
    r.made[0].gone = true
    r.closed()
    r.ghost.show(face, at, () => {})
    expect(r.made).toHaveLength(2)
  })

  it('under --e2e it shows and hides, parked and clear, and is never moved', async () => {
    const r = rig(true)
    r.ghost.warm()
    r.loaded()
    let shown = false
    r.ghost.show(face, at, () => (shown = true))
    await r.made[0].run()
    await r.made[0].run()
    expect(shown).toBe(true)
    r.ghost.move({ x: 1, y: 2, width: 154, height: 72 })
    expect(r.made[0].moves).toEqual([])
    expect(r.made[0].log).toEqual(['show'])
    expect(r.ghost.state()).toMatchObject({ visible: true, bounds: { x: 1, y: 2, width: 154, height: 72 } })
    r.ghost.destroy()
    expect(r.made[0].gone).toBe(true)
    expect(r.ghost.state().made).toBe(false)
  })
})
