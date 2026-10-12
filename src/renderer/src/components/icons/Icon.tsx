import type { JSX, ReactNode, SVGProps } from 'react'
import { PATHS, type PathName } from './paths'

type SvgProps = Omit<
  SVGProps<SVGSVGElement>,
  'name' | 'd' | 'width' | 'height' | 'strokeWidth' | 'children'
>

/**
 * THE ONE LINE-GLYPH PRIMITIVE (structure cleanup, 2026-10-12): a 24 unit
 * square in the ink around it (currentColor), stroked with round caps and,
 * unless `join` is off, round joins. `name` draws a path from `PATHS`, `d` any
 * other path, `children` anything more. Every other svg attribute (a class, a
 * fill, a `data-*` the e2e reads) passes straight through, so a glyph moved
 * onto it keeps its exact markup.
 */
export function Icon({
  name,
  d,
  size,
  weight = 1.7,
  join = true,
  children,
  ...rest
}: SvgProps & {
  name?: PathName
  d?: string
  size: number
  /** The stroke width, in the square's units. */
  weight?: number | string
  /** Round joins; off where a glyph had none. */
  join?: boolean
  children?: ReactNode
}): JSX.Element {
  const path = name ? PATHS[name] : d
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin={join ? 'round' : undefined}
      aria-hidden
      {...rest}
    >
      {path ? <path d={path} /> : null}
      {children}
    </svg>
  )
}

/** The tree's folder silhouette, filled: the tree and Explorer rows, the
 *  phone's rows and tab drawer, the + menu's places. Its colour defaults to
 *  the folder token. */
export function FolderFill({
  size,
  color = 'var(--p-tree-folder)'
}: {
  size: number
  color?: string
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={color}
      className="shrink-0"
      aria-hidden
    >
      <path d={PATHS.folderFill} />
    </svg>
  )
}

/**
 * The gear: a rim with a ring for its hub, or (`solid`) the rim filled with
 * the hub cut out (evenodd). The title bar's Settings toggle and the player's
 * settings button.
 */
export function Gear({
  size,
  solid = false,
  ...rest
}: SvgProps & { size: number; solid?: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
      {...rest}
    >
      {solid ? (
        <path fill="currentColor" fillRule="evenodd" d={`${PATHS.gearHub}${PATHS.gear}`} />
      ) : (
        <>
          <circle cx="12" cy="12" r="3.2" />
          <path d={PATHS.gear} />
        </>
      )}
    </svg>
  )
}
