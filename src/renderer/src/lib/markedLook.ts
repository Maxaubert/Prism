import type { CSSProperties } from 'react'

/** Where a marked row touches other marked rows, above and below. */
export interface Join {
  top: boolean
  bottom: boolean
}

/** A marked row with no marked neighbour (the tree's keyboard cursor, alone). */
export const ALONE: Join = { top: false, bottom: false }

/**
 * A marked row in the tree or the sidebar's search results (owner, 2026-10-03:
 * "more transparent like selecting files in file explorer"): the accent tint
 * (theme.ts `--p-sel-tint`), and its faint edge drawn round the BLOCK, so the
 * edge between two marked neighbours is left out and a run reads as one shape,
 * its shared corners squared. Inset shadows, not a border, so nothing in the
 * row moves. The Explorer's list draws the same in browse.css.
 */
export function markedLook(j: Join): CSSProperties {
  const line = 'var(--p-sel-line)'
  const edges = [`inset 1px 0 0 ${line}`, `inset -1px 0 0 ${line}`]
  if (!j.top) edges.push(`inset 0 1px 0 ${line}`)
  if (!j.bottom) edges.push(`inset 0 -1px 0 ${line}`)
  return {
    background: 'var(--p-sel-tint)',
    boxShadow: edges.join(', '),
    borderTopLeftRadius: j.top ? 0 : undefined,
    borderTopRightRadius: j.top ? 0 : undefined,
    borderBottomLeftRadius: j.bottom ? 0 : undefined,
    borderBottomRightRadius: j.bottom ? 0 : undefined
  }
}
