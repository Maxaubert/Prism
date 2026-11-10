import { describe, expect, it } from 'vitest'
import { thumbImageState } from './thumbImageState'

const base = { path: 'C:\\x\\a.jpg', source: 'main' as const, film: false }

// What the picture box draws (zoom grid, Stage 3, spec 4.6): the kind icon
// until a picture arrives, then the picture; a clear one over the checker; a
// film with a play glyph; no picture means the icon, forever, with no error mark.
describe('thumbImageState', () => {
  it('before: the icon only', () => {
    expect(thumbImageState({ ...base, value: undefined, loaded: false })).toEqual({
      url: null,
      icon: true,
      checker: false,
      play: false,
      visible: false
    })
  })

  it('arrived but not decoded yet: the picture is mounted and hidden, the icon stays', () => {
    const s = thumbImageState({ ...base, value: 'fsmedia://thumb/abc.jpg', loaded: false })
    expect(s.url).toBe('fsmedia://thumb/abc.jpg')
    expect(s.visible).toBe(false)
    expect(s.icon).toBe(true)
    expect(s.play).toBe(false)
  })

  it('decoded: the picture shows and the icon goes', () => {
    const s = thumbImageState({ ...base, value: 'fsmedia://thumb/abc.jpg', loaded: true })
    expect(s).toEqual({ url: 'fsmedia://thumb/abc.jpg', icon: false, checker: false, play: false, visible: true })
  })

  it('none: the icon, with no picture and no mark', () => {
    expect(thumbImageState({ ...base, value: null, loaded: false })).toEqual({
      url: null,
      icon: true,
      checker: false,
      play: false,
      visible: false
    })
  })

  it('a format that can be clear sits on the checker once it has arrived, not before', () => {
    const png = { ...base, path: 'C:\\x\\a.png' }
    expect(thumbImageState({ ...png, value: 'fsmedia://thumb/a.webp', loaded: false }).checker).toBe(false)
    expect(thumbImageState({ ...png, value: 'fsmedia://thumb/a.webp', loaded: true }).checker).toBe(true)
    expect(thumbImageState({ ...base, value: 'fsmedia://thumb/a.jpg', loaded: true }).checker).toBe(false)
  })

  it('a film wears the play glyph once its picture shows', () => {
    const mov = { ...base, path: 'C:\\x\\a.mov', film: true }
    expect(thumbImageState({ ...mov, value: undefined, loaded: false }).play).toBe(false)
    expect(thumbImageState({ ...mov, value: 'fsmedia://thumb/m.jpg', loaded: true }).play).toBe(true)
  })

  it('an SVG is drawn from the file itself, over the checker', () => {
    const svg = { path: 'C:\\x\\logo.svg', source: 'svg' as const, film: false }
    const s = thumbImageState({ ...svg, value: undefined, loaded: true })
    expect(s.url).toBe(`fsmedia://local/${encodeURIComponent('C:\\x\\logo.svg')}`)
    expect(s.visible).toBe(true)
    expect(s.checker).toBe(true)
  })

  it('an SVG that failed to draw is the icon', () => {
    const svg = { path: 'C:\\x\\logo.svg', source: 'svg' as const, film: false }
    expect(thumbImageState({ ...svg, value: null, loaded: false }).url).toBeNull()
  })
})
