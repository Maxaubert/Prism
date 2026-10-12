import { describe, expect, it } from 'vitest'
import { hiddenTitle, isClipped } from './hiddenTitle'

/** A stand-in element with the two widths the check reads. */
function box(scrollWidth: number, clientWidth: number): HTMLElement & { clientWidth: number } {
  const attrs = new Map<string, string>()
  return {
    scrollWidth,
    clientWidth,
    set title(v: string) {
      attrs.set('title', v)
    },
    get title() {
      return attrs.get('title') ?? ''
    },
    removeAttribute: (n: string) => attrs.delete(n),
    hasAttribute: (n: string) => attrs.has(n)
  } as unknown as HTMLElement & { clientWidth: number }
}

describe('hiddenTitle', () => {
  it('gives a name drawn whole no tooltip', () => {
    const el = box(120, 200)
    hiddenTitle('report.pdf').onMouseEnter({ currentTarget: el })
    expect(el.hasAttribute('title')).toBe(false)
  })

  it('gives a cut-off name its whole text', () => {
    const el = box(320, 200)
    hiddenTitle('a very long file name the column cut off.pdf').onMouseEnter({ currentTarget: el })
    expect(el.title).toBe('a very long file name the column cut off.pdf')
  })

  it('takes the tooltip away again once the name fits', () => {
    const el = box(320, 200)
    hiddenTitle('x').onMouseEnter({ currentTarget: el })
    el.clientWidth = 400
    hiddenTitle('x').onMouseEnter({ currentTarget: el })
    expect(el.hasAttribute('title')).toBe(false)
  })

  it('ignores sub-pixel rounding and an empty text', () => {
    expect(isClipped(box(200, 200))).toBe(false)
    const el = box(320, 200)
    hiddenTitle('').onMouseEnter({ currentTarget: el })
    expect(el.hasAttribute('title')).toBe(false)
  })
})
