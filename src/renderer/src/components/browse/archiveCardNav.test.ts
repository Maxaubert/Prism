import { describe, expect, it } from 'vitest'
import {
  NO_PICK,
  cardCaption,
  cardCargo,
  cardDropKeys,
  cardGoesInto,
  cardUp,
  pickForMenu,
  landedRows,
  pickRow,
  stepPick
} from './archiveCardNav'
import { archiveTarget, dropVerb } from '../../lib/drag/dropVerb'

const zip = 'C:\\Users\\me\\Downloads\\W-13.zip'
const order = ['app', 'docs', 'scripts', 'AGENTS.md', 'README.md']
const plain = { ctrl: false, shift: false }
const ctrl = { ctrl: true, shift: false }
const shift = { ctrl: false, shift: true }

describe('where the card is inside the zip (#483)', () => {
  it('says Inside at the root and where it is below it', () => {
    expect(cardCaption(zip, zip)).toBe('Inside')
    expect(cardCaption(zip, `${zip}\\web`)).toBe('Inside, in web')
    expect(cardCaption(zip, `${zip}\\web\\app\\sub`)).toBe('Inside, in web\\app\\sub')
  })
  it('a zip inside the zip is one more segment', () => {
    expect(cardCaption(zip, `${zip}\\Wind\\nested.zip`)).toBe('Inside, in Wind\\nested.zip')
    expect(cardUp(zip, `${zip}\\Wind\\nested.zip\\docs`)).toBe(`${zip}\\Wind\\nested.zip`)
  })
  it('Up walks one level, to the root and no further', () => {
    expect(cardUp(zip, `${zip}\\web\\app`)).toBe(`${zip}\\web`)
    expect(cardUp(zip, `${zip}\\web`)).toBe(zip)
    expect(cardUp(zip, zip)).toBeNull()
  })
  it('a folder and a zip inside the zip are gone into; a file is opened', () => {
    expect(cardGoesInto({ name: 'app', dir: true })).toBe(true)
    expect(cardGoesInto({ name: 'nested.zip', dir: false })).toBe(true)
    expect(cardGoesInto({ name: 'README.md', dir: false })).toBe(false)
  })
})

describe('the card selection (#483)', () => {
  it('a click is the selection alone', () => {
    const one = pickRow(order, NO_PICK, 'docs', plain)
    expect(one).toEqual({ marked: ['docs'], anchor: 'docs', cursor: 'docs' })
    expect(pickRow(order, { marked: ['app', 'docs'], anchor: 'app', cursor: 'docs' }, 'README.md', plain).marked).toEqual([
      'README.md'
    ])
  })
  it('Ctrl toggles a row in and out, in the list order', () => {
    const a = pickRow(order, pickRow(order, NO_PICK, 'docs', plain), 'app', ctrl)
    expect(a.marked).toEqual(['app', 'docs'])
    expect(pickRow(order, a, 'app', ctrl).marked).toEqual(['docs'])
  })
  it('Shift selects the range from the last click, either way', () => {
    const at = pickRow(order, NO_PICK, 'docs', plain)
    expect(pickRow(order, at, 'README.md', shift).marked).toEqual(['docs', 'scripts', 'AGENTS.md', 'README.md'])
    expect(pickRow(order, at, 'app', shift).marked).toEqual(['app', 'docs'])
    // The anchor holds: a second Shift click re-ranges from it.
    const r = pickRow(order, at, 'README.md', shift)
    expect(pickRow(order, r, 'scripts', shift).marked).toEqual(['docs', 'scripts'])
  })
  it('Ctrl+Shift adds the range to what was picked', () => {
    const a = pickRow(order, pickRow(order, NO_PICK, 'app', plain), 'AGENTS.md', ctrl)
    expect(pickRow(order, a, 'README.md', { ctrl: true, shift: true }).marked).toEqual(['app', 'AGENTS.md', 'README.md'])
  })
  it('Shift with no anchor picks the row', () => {
    expect(pickRow(order, NO_PICK, 'scripts', shift).marked).toEqual(['scripts'])
  })
  it('a right-click keeps a selection it is inside, else picks its row', () => {
    const two = { marked: ['app', 'docs'], anchor: 'app', cursor: 'docs' }
    expect(pickForMenu(two, 'docs')).toBe(two)
    expect(pickForMenu(two, 'README.md').marked).toEqual(['README.md'])
  })
  it('the arrows walk the rows and Shift stretches the range', () => {
    const at = pickRow(order, NO_PICK, 'app', plain)
    expect(stepPick(order, at, 1, false).marked).toEqual(['docs'])
    expect(stepPick(order, at, -1, false).marked).toEqual(['app'])
    const s = stepPick(order, stepPick(order, at, 1, true), 1, true)
    expect(s.marked).toEqual(['app', 'docs', 'scripts'])
    expect(stepPick(order, NO_PICK, 1, false).marked).toEqual(['app'])
    expect(stepPick(order, NO_PICK, -1, false).marked).toEqual(['README.md'])
  })
  it('a press carries the selection it is in, else its own row', () => {
    const two = { marked: ['app', 'docs'], anchor: 'app', cursor: 'docs' }
    expect(cardCargo(two, 'docs')).toEqual(['app', 'docs'])
    expect(cardCargo(two, 'README.md')).toEqual(['README.md'])
  })
})

describe('a drop onto the card (#483)', () => {
  const here = `${zip}\\web`
  const target = (readOnly = false) => ({
    dir: here,
    archive: archiveTarget(here, { container: zip, base: zip, outer: zip, readOnly })
  })
  const files = { kind: 'files' as const, paths: ['C:\\Users\\me\\Downloads\\notes.txt'] }
  it('copies by default, Ctrl copies, Shift alone moves', () => {
    expect(cardDropKeys(plain)).toEqual(ctrl)
    expect(cardDropKeys(ctrl)).toEqual(ctrl)
    expect(cardDropKeys(shift)).toEqual(shift)
    expect(cardDropKeys({ ctrl: true, shift: true })).toEqual(ctrl)
  })
  it('a file beside the zip is added as a copy, on the same drive too', () => {
    expect(dropVerb({ payload: files, target: target(), keys: cardDropKeys(plain) })).toBe('add-copy')
    expect(dropVerb({ payload: files, target: target(), keys: cardDropKeys(shift) })).toBe('add-move')
  })
  it('a read-only archive takes nothing', () => {
    expect(dropVerb({ payload: files, target: target(true), keys: cardDropKeys(plain) })).toBe('none')
  })
  it("the card's own members back onto it are refused quietly", () => {
    const own = {
      kind: 'members' as const,
      archive: zip,
      entries: ['web/README.md'],
      places: [`${here}\\README.md`],
      card: true as const
    }
    expect(dropVerb({ payload: own, target: target(), keys: cardDropKeys(plain) })).toBe('none')
  })
  it('the zip itself never goes into itself', () => {
    const self = { kind: 'files' as const, paths: [zip] }
    expect(dropVerb({ payload: self, target: target(), keys: cardDropKeys(plain) })).toBe('none')
  })
})

describe('what landed in the card is marked (#483)', () => {
  const here = `${zip}\\web`
  it("names the rows the landed places are, in the rows' order", () => {
    expect(landedRows(order, here, [`${here}\\README.md`, `${here}\\app`])).toEqual(['app', 'README.md'])
  })
  it('matches without regard to case and ignores another folder', () => {
    expect(landedRows(order, here, [`${here.toUpperCase()}\\DOCS`, `${zip}\\README.md`])).toEqual(['docs'])
  })
})

