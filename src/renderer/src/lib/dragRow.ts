/**
 * What hangs off the pointer while a file is carried (#327; owner, 2026-10-07:
 * "when i pick up an item i wanna pick up the row, essentially not just a
 * label, so i want the icon and so on"). It is the ROW you pressed on as it
 * looks SELECTED, but only its icon and its name: the same icon the list
 * draws, the row's height, side padding, gap and font, the selection's tint
 * and edge. Never the type, size or date. Several items: still that one row,
 * with a small count of all of them on its corner.
 *
 * Built from the source row's own DOM and computed style, so the Explorer
 * list, the project tree and the places panel each show their own icon at
 * their own size, with no per-source code. Still an in-page element placed by
 * `dragBadgePlace` (#310), never a native drag image (the Ctrl+Tab rule).
 */

/** The slice of an Element the icon finder reads; a stand-in in the tests. */
export interface RowNode {
  tagName: string
  textContent: string | null
  children: ArrayLike<RowNode>
  parentElement: RowNode | null
  nextElementSibling: RowNode | null
  firstElementChild: RowNode | null
}

const isIcon = (n: RowNode): boolean => /^(svg|img)$/i.test(n.tagName)
const hasText = (n: RowNode | null): n is RowNode => !!n && !!n.textContent?.trim()

/**
 * The row's icon and the name it shows. The icon is the first svg or img
 * whose NEXT element (its own, or its wrapper's) carries text: that skips
 * the tree's chevron, whose wrapper is followed by the folder icon, and the
 * row's other cells, which come after the name. The name is that element's
 * first line (a search row puts its location under it).
 */
export function findRowIcon<T extends RowNode>(row: T): { icon: T; name: string } | null {
  const icons: RowNode[] = []
  const walk = (n: RowNode): void => {
    for (const kid of Array.from(n.children)) {
      if (isIcon(kid)) icons.push(kid)
      else walk(kid)
    }
  }
  walk(row)
  for (const icon of icons) {
    for (let at: RowNode | null = icon; at && at !== row; at = at.parentElement) {
      const next = at.nextElementSibling
      if (!next) continue
      if (!hasText(next) || isIcon(next)) break
      const name = (next.firstElementChild ?? next).textContent?.trim() || next.textContent!.trim()
      return { icon: icon as T, name }
    }
  }
  return null
}

/** The count on the row's corner: none for one item, capped for a huge pick. */
export function dragCountText(count: number): string {
  if (count <= 1) return ''
  return count > 999 ? '999+' : String(count)
}

export interface RowMetrics {
  height: number
  /** The row's side padding: its RIGHT one, since a tree row's left is its indent. */
  padX: number
  gap: number
  fontSize: string
  fontFamily: string
  fontWeight: string
  color: string
  radius: string
}

/**
 * The carried row's box. The selection's tint as the eye gets it over the
 * window ground (`--p-sel-tint-seen`, opaque, so nothing under the pointer
 * shows through it) and its faint edge, plus a soft lift so it reads as held.
 */
export function dragRowStyle(m: RowMetrics): Record<string, string> {
  return {
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    boxSizing: 'border-box',
    height: `${m.height}px`,
    padding: `0px ${m.padX}px`,
    gap: `${m.gap}px`,
    fontSize: m.fontSize,
    fontFamily: m.fontFamily,
    fontWeight: m.fontWeight,
    color: m.color,
    borderRadius: m.radius,
    background: 'var(--p-sel-tint-seen)',
    boxShadow: 'inset 0 0 0 1px var(--p-sel-line), 0 4px 14px rgb(0 0 0 / 0.28)',
    maxWidth: 'min(360px, calc(100vw - 8px))',
    whiteSpace: 'nowrap'
  }
}

/** A copy of the row's icon that keeps its look away from the row's CSS. */
function cloneIcon(icon: Element): Element {
  const box = icon.getBoundingClientRect()
  const seen = getComputedStyle(icon)
  const copy = icon.cloneNode(true) as Element
  // Ids are per document: a clone's mask would point at the ROW's, which a
  // scrolled virtual list can take away mid-drag (KindIcon masks by id).
  const ids = new Map<string, string>()
  for (const n of [copy, ...Array.from(copy.querySelectorAll('[id]'))]) {
    if (!n.id) continue
    ids.set(n.id, `${n.id}-carried`)
    n.id = `${n.id}-carried`
  }
  if (ids.size)
    for (const n of [copy, ...Array.from(copy.querySelectorAll('*'))])
      for (const a of Array.from(n.attributes)) {
        let v = a.value
        for (const [from, to] of ids)
          v = v === `#${from}` ? `#${to}` : v.split(`#${from})`).join(`#${to})`)
        if (v !== a.value) n.setAttribute(a.name, v)
      }
  copy.setAttribute('data-drag-icon', '')
  const style = (copy as HTMLElement | SVGElement).style
  // The row's CSS sized and coloured it (`.browse-name > svg`, a place's dim
  // glyph); out here only what was measured holds.
  style.width = `${box.width}px`
  style.height = `${box.height}px`
  style.flex = 'none'
  style.color = seen.color
  style.opacity = '1'
  // An unmarked row's icon knocks out to the ground it sat on (the list's
  // `--p-bg`, the tree's `--p-side-flat`); carried, it sits on the tint.
  style.setProperty('--p-bg', 'var(--p-sel-tint-seen)')
  style.setProperty('--p-side-flat', 'var(--p-sel-tint-seen)')
  return copy
}

export interface DragRow {
  /** The whole carried element, what `dragBadgePlace` positions. */
  root: HTMLDivElement
  /** Says Move or Copy under the row while a target would take the drop. */
  effect: HTMLDivElement
}

/**
 * The carried row for a drag that started on `source`. `fallback` names it
 * when the source is not a row with an icon (an archive member list, say).
 */
export function buildDragRow(source: Element, fallback: string, count: number): DragRow {
  const row = source.closest('[draggable="true"]') ?? source
  const found = findRowIcon(row as unknown as RowNode & Element)
  const nameEl = found ? (found.icon as Element).nextElementSibling : null
  const rowSeen = getComputedStyle(row)
  const nameSeen = nameEl ? getComputedStyle(nameEl) : rowSeen
  const gapOf = found ? getComputedStyle((found.icon as Element).parentElement ?? row).columnGap : rowSeen.columnGap
  const metrics: RowMetrics = {
    height: Math.round(row.getBoundingClientRect().height) || 26,
    padX: parseFloat(rowSeen.paddingRight) || 8,
    gap: parseFloat(gapOf) || 6,
    fontSize: rowSeen.fontSize,
    fontFamily: rowSeen.fontFamily,
    fontWeight: nameSeen.fontWeight,
    color: nameSeen.color,
    radius: rowSeen.borderTopRightRadius || '4px'
  }

  const root = document.createElement('div')
  root.dataset.fileDragBadge = ''
  Object.assign(root.style, {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '4px'
  })
  // The icons' knockouts take what is behind them: inside the carried row
  // that is the opaque tint, whatever the source row was drawn on.
  root.style.setProperty('--p-sel-tint-side', 'var(--p-sel-tint-seen)')
  root.style.setProperty('--sel-seen', 'var(--p-sel-tint-seen)')

  const box = document.createElement('div')
  box.dataset.dragRow = ''
  Object.assign(box.style, dragRowStyle(metrics))
  if (found) box.append(cloneIcon(found.icon as Element))
  const name = document.createElement('span')
  name.dataset.dragName = ''
  name.textContent = found?.name || fallback
  Object.assign(name.style, { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: '0' })
  box.append(name)
  const counted = dragCountText(count)
  if (counted) {
    const badge = document.createElement('span')
    badge.dataset.dragCount = ''
    badge.textContent = counted
    Object.assign(badge.style, {
      position: 'absolute',
      top: '-7px',
      right: '-7px',
      minWidth: '18px',
      height: '18px',
      padding: '0 5px',
      boxSizing: 'border-box',
      borderRadius: '9px',
      display: 'grid',
      placeItems: 'center',
      fontSize: '11px',
      fontWeight: '600',
      fontFamily: metrics.fontFamily,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: '1',
      // The selection's fill, flattened on the ground (it may carry an
      // alpha), and the ink chosen to read on it.
      background: 'linear-gradient(var(--p-sel-bg), var(--p-sel-bg)), var(--p-bg)',
      color: 'var(--p-on-accent)',
      boxShadow: '0 0 0 1.5px var(--p-bg)'
    })
    box.append(badge)
    // Room for the badge's overhang, so the name never runs under it.
    box.style.paddingRight = `${metrics.padX + 10}px`
  }

  const effect = document.createElement('div')
  effect.dataset.dragEffect = ''
  effect.hidden = true
  Object.assign(effect.style, {
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: metrics.fontFamily,
    background: 'var(--p-bg)',
    color: 'var(--p-dim)',
    border: '1px solid var(--p-divider)'
  })
  root.append(box, effect)
  return { root, effect }
}
