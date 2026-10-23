import { beforeEach, describe, expect, it } from 'vitest'
import { TERM_PRESETS, resolveTermTheme } from './termTheme'
import { onGround } from './termGround'
import { saveCustomTermTheme } from './termLook'

// ALPHA EXACTLY 1 CHANGES NOTHING (#112). Taken BEFORE alpha reached the
// resolver: every preset, and an opaque Custom whose cursor fails its floor
// (a Custom foreground and cursor have never been floored), resolve byte for
// byte as they did, alone and on a picked ground.

const OPAQUE_CUSTOM = {
  bg: '#1a1b26',
  fg: '#c0caf5',
  // 1.1:1 on its ground: fails the 3:1 floor, and must stay as picked.
  cursor: '#20212c',
  ansi: { black: '#15161e', red: '#f7768e', green: '#2a2b36', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6' }
}

beforeEach(() => localStorage.clear())

describe('resolveTermTheme, opaque, as it was', () => {
  it('every preset', () => {
    expect(Object.fromEntries(TERM_PRESETS.map((p) => [p.id, resolveTermTheme(p.id)]))).toMatchSnapshot()
  })
  it('an opaque Custom with a failing cursor', () => {
    saveCustomTermTheme(OPAQUE_CUSTOM)
    expect(resolveTermTheme('custom')).toMatchSnapshot()
  })
  it('every preset and the Custom on a picked ground', () => {
    saveCustomTermTheme(OPAQUE_CUSTOM)
    const out: Record<string, unknown> = {}
    for (const ground of ['#f4f1ea', '#203040'])
      for (const id of [...TERM_PRESETS.map((p) => p.id), 'custom']) out[`${id}@${ground}`] = onGround(resolveTermTheme(id), ground)
    expect(out).toMatchSnapshot()
  })
})
