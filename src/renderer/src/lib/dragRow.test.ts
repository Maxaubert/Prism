import { describe, expect, it } from 'vitest'
import { dragCountText, dragRowStyle, findRowIcon, type RowNode } from './dragRow'

/** A tiny stand-in for the DOM: enough of an Element for the finder. */
function el(tag: string, text = '', kids: RowNode[] = []): RowNode {
  const node: RowNode = {
    tagName: tag.toUpperCase(),
    textContent: text || kids.map((k) => k.textContent).join(''),
    children: kids,
    parentElement: null,
    nextElementSibling: null,
    firstElementChild: kids[0] ?? null
  }
  kids.forEach((k, i) => {
    k.parentElement = node
    k.nextElementSibling = kids[i + 1] ?? null
  })
  return node
}

describe('findRowIcon', () => {
  it('takes the Explorer list row icon and its name, not the columns', () => {
    const icon = el('svg', 'TXT')
    const nameText = el('span', '', [el('span', 'alpha.txt')])
    const row = el('button', '', [
      el('span', '', [icon, nameText]),
      el('span', 'Text Document'),
      el('span', '1 KB'),
      el('span', '07/10/2026 10:00')
    ])
    const found = findRowIcon(row)
    expect(found?.icon).toBe(icon)
    expect(found?.name).toBe('alpha.txt')
  })
  it('skips the tree chevron and takes the folder icon beside the name', () => {
    const chevron = el('svg')
    const folder = el('svg')
    const row = el('button', '', [el('span', '', [chevron]), folder, el('span', 'src')])
    const found = findRowIcon(row)
    expect(found?.icon).toBe(folder)
    expect(found?.name).toBe('src')
  })
  it('takes a place glyph and the label the place shows', () => {
    const glyph = el('svg')
    const row = el('button', '', [glyph, el('span', 'Documents')])
    expect(findRowIcon(row)).toEqual({ icon: glyph, name: 'Documents' })
  })
  it('takes an img icon too', () => {
    const img = el('img')
    const row = el('div', '', [img, el('span', 'photo.png')])
    expect(findRowIcon(row)?.icon).toBe(img)
  })
  it('answers null for a row with no icon, so the caller falls back to the name alone', () => {
    expect(findRowIcon(el('button', '', [el('span', 'plain')]))).toBeNull()
  })
})

describe('dragCountText', () => {
  it('shows no count for one item', () => {
    expect(dragCountText(1)).toBe('')
    expect(dragCountText(0)).toBe('')
  })
  it('shows the total for several', () => {
    expect(dragCountText(2)).toBe('2')
    expect(dragCountText(7)).toBe('7')
    expect(dragCountText(999)).toBe('999')
  })
  it('caps a huge selection so the badge stays small', () => {
    expect(dragCountText(1000)).toBe('999+')
  })
})

describe('dragRowStyle', () => {
  const metrics = {
    height: 26,
    padX: 8,
    gap: 6,
    fontSize: '12.5px',
    fontFamily: 'Segoe UI',
    fontWeight: '400',
    color: 'rgb(230, 230, 230)',
    radius: '4px'
  }
  it('is the row as it is drawn: its height, side padding, gap and font', () => {
    const s = dragRowStyle(metrics)
    expect(s.height).toBe('26px')
    expect(s.padding).toBe('0px 8px')
    expect(s.gap).toBe('6px')
    expect(s.fontSize).toBe('12.5px')
    expect(s.fontFamily).toBe('Segoe UI')
    expect(s.fontWeight).toBe('400')
    expect(s.color).toBe('rgb(230, 230, 230)')
    expect(s.borderRadius).toBe('4px')
  })
  it('wears the selected look over the window ground, opaque, with its edge', () => {
    const s = dragRowStyle(metrics)
    expect(s.background).toBe('var(--p-sel-tint-seen)')
    expect(s.boxShadow).toContain('inset 0 0 0 1px var(--p-sel-line)')
  })
  it('never takes a tree row indent as its padding: the side padding is the given one', () => {
    expect(dragRowStyle({ ...metrics, padX: 6 }).padding).toBe('0px 6px')
  })
})
