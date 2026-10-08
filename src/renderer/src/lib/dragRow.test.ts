import { describe, expect, it } from 'vitest'
import {
  carriedName,
  dragCountText,
  dragRowStyle,
  findRowIcon,
  parseColour,
  selectedFill,
  type RowNode
} from './dragRow'

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
    radius: '4px',
    fill: 'rgb(36, 42, 50)'
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
  it('wears the fill it is handed, with the selection edge', () => {
    const s = dragRowStyle(metrics)
    expect(s.background).toBe('rgb(36, 42, 50)')
    expect(s.boxShadow).toContain('inset 0 0 0 1px var(--p-sel-line)')
  })
  it('never takes a tree row indent as its padding: the side padding is the given one', () => {
    expect(dragRowStyle({ ...metrics, padX: 6 }).padding).toBe('0px 6px')
  })
})

describe('parseColour', () => {
  it('reads what getComputedStyle answers', () => {
    expect(parseColour('rgb(18, 20, 24)')).toEqual([18, 20, 24, 1])
    expect(parseColour('rgba(106, 127, 153, 0.22)')).toEqual([106, 127, 153, 0.22])
    expect(parseColour('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0])
    expect(parseColour('color(srgb 1 0.5 0 / 0.5)')).toEqual([255, 127.5, 0, 0.5])
    expect(parseColour('#6a7f9938')).toEqual([106, 127, 153, 0x38 / 255])
  })
  it('answers null for a form it does not read', () => {
    expect(parseColour('oklch(0.5 0.1 200)')).toBeNull()
  })
})

describe('selectedFill', () => {
  const tint = 'rgba(100, 100, 200, 0.5)'
  it('composites the tint on the first OPAQUE ground, skipping see-through ones', () => {
    // The row's parent is clear, the list's ground is a grey: the tint lands on the grey.
    expect(selectedFill(tint, ['rgba(0, 0, 0, 0)', 'rgb(200, 200, 200)', 'rgb(255, 255, 255)'])).toBe(
      'rgb(150, 150, 200)'
    )
  })
  it('differs by ground, so a tree row and a list row each get their own', () => {
    expect(selectedFill(tint, ['rgb(0, 0, 0)'])).toBe('rgb(50, 50, 100)')
    expect(selectedFill(tint, ['rgb(40, 40, 40)'])).toBe('rgb(70, 70, 120)')
  })
  it('gives up (the caller keeps --p-sel-tint-seen) under acrylic or an unread form', () => {
    expect(selectedFill(tint, ['rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0)'])).toBeNull()
    expect(selectedFill(tint, ['oklch(0.5 0.1 200)'])).toBeNull()
    expect(selectedFill('oklch(0.5 0.1 200)', ['rgb(0, 0, 0)'])).toBeNull()
  })
})

describe('carriedName', () => {
  it('drops the star of an unsaved file, which is not part of its name', () => {
    expect(carriedName('notes.txt*', 'notes.txt')).toBe('notes.txt')
  })
  it('keeps a name that really ends in a star, and any name without a path', () => {
    expect(carriedName('odd*', 'odd*')).toBe('odd*')
    expect(carriedName('notes.txt*', null)).toBe('notes.txt*')
    expect(carriedName('Documents', 'Documents')).toBe('Documents')
  })
})
