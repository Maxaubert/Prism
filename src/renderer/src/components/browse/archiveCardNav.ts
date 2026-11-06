import { browsableArchive, innerOf, placeOf } from '@shared/archivePlace'
import { pathKey } from '@shared/path'

/**
 * THE ZIP CARD IS A SMALL BROWSER THAT STAYS IN THE PREVIEW (#483; owner,
 * 2026-11-06, of rows that walked the Explorer into the zip: "on clicking an
 * item in the zip preview opens it in main view dont do that i wanna use it
 * while its in the preview, select files drag them into the main view to
 * extract and so on"). The pure halves: where the card is inside the zip,
 * where Up goes, and what a click, Ctrl, Shift or an arrow does to the
 * selection. A place is the Explorer's own path inside the zip
 * (`C:\x.zip\a\b`), so a nested zip is one more segment.
 */

/** The caption over the rows: "Inside" at the zip's root, else where. */
export function cardCaption(zip: string, here: string): string {
  const inner = innerOf(zip, here)
  return inner ? `Inside, in ${inner.replace(/\//g, '\\')}` : 'Inside'
}

/** The place one level up inside the zip, null at its root. */
export function cardUp(zip: string, here: string): string | null {
  const inner = innerOf(zip, here)
  if (!inner) return null
  const cut = inner.lastIndexOf('/')
  return placeOf(zip, cut < 0 ? '' : inner.slice(0, cut))
}

/** A double-click goes INTO a folder, or a zip inside the zip, in the card;
 *  any other row is a file that opens in the viewer. */
export function cardGoesInto(row: { name: string; dir: boolean }): boolean {
  return row.dir || browsableArchive(row.name)
}

/** The selection, by row name (names are unique in one level). */
export interface CardPick {
  marked: string[]
  /** Where a Shift range starts: the last plain or Ctrl click. */
  anchor: string | null
  /** The row the arrows move from. */
  cursor: string | null
}

export const NO_PICK: CardPick = { marked: [], anchor: null, cursor: null }

const inOrder = (order: readonly string[], names: Iterable<string>): string[] => {
  const want = new Set(names)
  return order.filter((n) => want.has(n))
}

const rangeOf = (order: readonly string[], from: string, to: string): string[] => {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/** A click on `name`: alone, Ctrl toggles it, Shift selects the range from
 *  the anchor (Ctrl+Shift adds that range), as the Explorer list does. */
export function pickRow(
  order: readonly string[],
  was: CardPick,
  name: string,
  keys: { ctrl: boolean; shift: boolean }
): CardPick {
  if (keys.shift) {
    const anchor = was.anchor && order.includes(was.anchor) ? was.anchor : name
    const range = rangeOf(order, anchor, name)
    return {
      marked: inOrder(order, keys.ctrl ? [...was.marked, ...range] : range),
      anchor,
      cursor: name
    }
  }
  if (keys.ctrl) {
    const on = was.marked.includes(name)
    return {
      marked: inOrder(order, on ? was.marked.filter((n) => n !== name) : [...was.marked, name]),
      anchor: name,
      cursor: name
    }
  }
  return { marked: [name], anchor: name, cursor: name }
}

/** A right-click: inside the selection it stays, else the row is the
 *  selection alone (the Explorer's rule, #296). */
export function pickForMenu(was: CardPick, name: string): CardPick {
  return was.marked.includes(name) ? was : { marked: [name], anchor: name, cursor: name }
}

/** Up or Down by `delta`; Shift stretches the range from the anchor. With
 *  nothing picked, the first (or last) row. */
export function stepPick(order: readonly string[], was: CardPick, delta: number, shift: boolean): CardPick {
  if (!order.length) return was
  const from = was.cursor ? order.indexOf(was.cursor) : -1
  const at = from < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, from + delta))
  const name = order[at]
  if (shift && was.anchor && order.includes(was.anchor))
    return { marked: rangeOf(order, was.anchor, name), anchor: was.anchor, cursor: name }
  return { marked: [name], anchor: name, cursor: name }
}

/** What is carried or acted on when `name` is pressed: the selection when
 *  it holds that row, else that row alone. */
export function cardCargo(was: CardPick, name: string): string[] {
  return was.marked.includes(name) ? was.marked : [name]
}

/** The Ctrl chords the card's list keeps for itself: Ctrl+A picks every row,
 *  Ctrl+C copies the picked members, Ctrl+X and Ctrl+V are inert. Reaching
 *  the app they acted on the ZIP behind the card (a cut of the zip). */
export const CARD_CHORDS: ReadonlySet<string> = new Set(['a', 'c', 'x', 'v'])

/** A DROP ONTO THE CARD COPIES (#483; owner, 2026-11-06, of a file dragged
 *  back onto the card: "dragged it back in"): the keys handed to the one drop
 *  rule (#70) for a drop there. Shift alone moves, as everywhere; a plain
 *  drag, Ctrl, or Ctrl+Shift copies, so a drag onto the zip in the preview
 *  never takes the file away from the list beside it. */
export function cardDropKeys(keys: { ctrl: boolean; shift: boolean }): { ctrl: boolean; shift: boolean } {
  return keys.shift && !keys.ctrl ? { ctrl: false, shift: true } : { ctrl: true, shift: false }
}

/** Which of the card's rows `paths` name (#483): what landed there, marked
 *  as the list marks what lands in it. */
export function landedRows(order: readonly string[], here: string, paths: readonly string[]): string[] {
  const want = new Set(paths.map(pathKey))
  return order.filter((n) => want.has(pathKey(placeOf(here, n))))
}
