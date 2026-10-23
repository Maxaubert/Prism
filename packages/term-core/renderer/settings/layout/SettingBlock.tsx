import type { JSX, ReactNode } from 'react'
import { RULE } from './SettingRow'

/** A full-width part of a panel for what is not a row: a wall of cards, a
 *  list of models, the About card. `full` rules it edge to edge. */
export function SettingBlock({
  full = true,
  pad = false,
  children,
  ...rest
}: {
  full?: boolean
  /** The wall's padding, 14px 16px 16px. */
  pad?: boolean
  children: ReactNode
} & Record<`data-${string}`, string | boolean | undefined>): JSX.Element {
  return (
    <div
      {...rest}
      data-full={full || undefined}
      className={`relative first:rounded-t-[inherit] last:rounded-b-[inherit] ${RULE} ${full ? 'before:left-0' : 'before:left-[60px]'} ${
        pad ? 'px-4 pb-4 pt-3.5' : ''
      }`}
    >
      {children}
    </div>
  )
}
