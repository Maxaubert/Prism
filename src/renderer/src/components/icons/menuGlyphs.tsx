import type { JSX } from 'react'
import { Icon } from './Icon'

// The menus' own glyphs, at the rows' 13px and 1.7 stroke (FileMenuIcon's
// family). Built where a menu builder names its rows (`src/renderer/src/menus`).

/** Menu glyphs: outlined, so they read as actions rather than as file kinds. */
export const menuIcon = (d: string): JSX.Element => <Icon d={d} size={13} className="opacity-80" />

/** A tick, or the space one would take, so labels line up either way. Ticks
 *  are not icons: they say what is currently ON, which is state the row
 *  cannot express any other way. */
export const tickIf = (on: boolean): JSX.Element =>
  on ? (
    <Icon name="tick" size={13} className="opacity-80" />
  ) : (
    <span className="w-[13px] shrink-0" aria-hidden />
  )
