import { describe, expect, it } from 'vitest'
import { listKey, stepTo, typeJump, typedRun, type KeyLike } from './listKeys'
import { rangeSelect } from './selection'

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...mods
})
const ctrl = { ctrlKey: true }
const shift = { shiftKey: true }
const alt = { altKey: true }

describe('listKey', () => {
  it('maps the chosen chords (#330)', () => {
    expect(listKey(press('a', ctrl))).toBe('select-all')
    expect(listKey(press('A', { ...ctrl, ...shift }))).toBe('clear')
    expect(listKey(press('Escape'))).toBe('clear')
    expect(listKey(press('ArrowDown', shift))).toBe('extend-down')
    expect(listKey(press('ArrowUp', shift))).toBe('extend-up')
    expect(listKey(press('Home', shift))).toBe('extend-home')
    expect(listKey(press('End', shift))).toBe('extend-end')
    expect(listKey(press('ArrowDown', ctrl))).toBe('focus-down')
    expect(listKey(press('ArrowUp', ctrl))).toBe('focus-up')
    expect(listKey(press('Home', ctrl))).toBe('focus-home')
    expect(listKey(press('End', ctrl))).toBe('focus-end')
    expect(listKey(press(' ', ctrl))).toBe('toggle-mark')
    expect(listKey(press('N', { ...ctrl, ...shift }))).toBe('new-folder')
    expect(listKey(press('d', ctrl))).toBe('bin')
    expect(listKey(press('Delete', shift))).toBe('bin')
    expect(listKey(press('ArrowUp', alt))).toBe('parent')
    expect(listKey(press('ArrowLeft', alt))).toBe('back')
    expect(listKey(press('ArrowRight', alt))).toBe('forward')
    expect(listKey(press('F3'))).toBe('search')
    expect(listKey(press('Enter', alt))).toBe('properties')
    expect(listKey(press('C', { ...ctrl, ...shift }))).toBe('copy-paths')
    expect(listKey(press('Enter', ctrl))).toBe('open-new-tab')
  })

  it('reads a letter chord by its physical key too', () => {
    expect(listKey(press('ф', { ...ctrl, code: 'KeyA' }))).toBe('select-all')
    expect(listKey(press('т', { ...ctrl, ...shift, code: 'KeyN' }))).toBe('new-folder')
  })

  it('leaves Ctrl+Left and Ctrl+Right alone: they are not navigation keys (2026-09-01)', () => {
    expect(listKey(press('ArrowLeft', ctrl))).toBeNull()
    expect(listKey(press('ArrowRight', ctrl))).toBeNull()
    expect(listKey(press('ArrowLeft', shift))).toBeNull()
  })

  it('leaves what the surfaces already own, and anything with Win', () => {
    for (const k of ['Delete', 'Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'F2', 'Backspace', 'a', ' '])
      expect(listKey(press(k))).toBeNull()
    for (const k of ['c', 'x', 'v', 'z', 'y', 'f'])
      expect(listKey(press(k, ctrl))).toBeNull()
    expect(listKey(press('a', { ...ctrl, metaKey: true }))).toBeNull()
    expect(listKey(press('ArrowDown', { ...ctrl, ...shift }))).toBeNull()
    expect(listKey(press('ArrowUp', { ...alt, ...ctrl }))).toBeNull()
    expect(listKey(press('F3', shift))).toBeNull()
    expect(listKey(press('Delete', ctrl))).toBeNull()
  })
})

describe('stepTo', () => {
  it('steps, stops at the ends, and jumps to them', () => {
    expect(stepTo(5, 2, 'down')).toBe(3)
    expect(stepTo(5, 4, 'down')).toBe(4)
    expect(stepTo(5, 0, 'up')).toBe(0)
    expect(stepTo(5, 3, 'home')).toBe(0)
    expect(stepTo(5, 1, 'end')).toBe(4)
  })
  it('starts at an end with no row yet, and answers null for no rows', () => {
    expect(stepTo(5, -1, 'down')).toBe(0)
    expect(stepTo(5, -1, 'up')).toBe(4)
    expect(stepTo(0, 2, 'down')).toBeNull()
  })
})

describe('typeJump', () => {
  const names = ['alpha', 'Beta', 'apple', 'zeta', 'apricot']
  it('a single letter walks every row with it, wrapping round', () => {
    expect(typeJump(names, -1, 'a')).toBe(0)
    expect(typeJump(names, 0, 'a')).toBe(2)
    expect(typeJump(names, 2, 'a')).toBe(4)
    expect(typeJump(names, 4, 'a')).toBe(0)
  })
  it('a longer run keeps a row that already matches, and ignores case', () => {
    expect(typeJump(names, 2, 'ap')).toBe(2)
    expect(typeJump(names, 2, 'apr')).toBe(4)
    expect(typeJump(names, 0, 'B')).toBe(1)
  })
  it('answers -1 when nothing matches, so the key is not taken', () => {
    expect(typeJump(names, 0, 'q')).toBe(-1)
    expect(typeJump([], 0, 'a')).toBe(-1)
    expect(typeJump(names, 0, '')).toBe(-1)
  })
})

describe('typedRun', () => {
  it('extends inside 700 ms and starts again after', () => {
    const first = typedRun({ text: '', at: 0 }, 'A', 1000)
    expect(first).toEqual({ text: 'a', at: 1000 })
    expect(typedRun(first, 'p', 1500).text).toBe('ap')
    expect(typedRun(first, 'p', 1800).text).toBe('p')
  })
})

describe('rangeSelect', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  it('marks the run from the anchor, growing and shrinking', () => {
    const sel = { anchor: 'b', items: new Set(['b']) }
    const down2 = rangeSelect(order, sel, 'd')
    expect([...down2.items]).toEqual(['b', 'c', 'd'])
    expect(down2.anchor).toBe('b')
    expect([...rangeSelect(order, down2, 'c').items]).toEqual(['b', 'c'])
    expect([...rangeSelect(order, down2, 'a').items]).toEqual(['a', 'b'])
  })
  it('replaces earlier marks, as Explorer does', () => {
    const sel = { anchor: 'c', items: new Set(['a', 'c']) }
    expect([...rangeSelect(order, sel, 'd').items]).toEqual(['c', 'd'])
  })
  it('starts the run at the row when the anchor has gone', () => {
    const sel = { anchor: 'gone', items: new Set<string>() }
    expect(rangeSelect(order, sel, 'c')).toEqual({ anchor: 'c', items: new Set(['c']) })
    expect(rangeSelect(order, { anchor: null, items: new Set() }, 'e').anchor).toBe('e')
  })
})
