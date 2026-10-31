import type { ComponentProps, JSX, ReactElement } from 'react'
import type { FolderIconChoice } from '../../lib/folderIcons'
import { useFolderIconSet, type FolderIconDef } from '../../lib/folderIconSetLoad'
import { Icon } from './Icon'

/** One built-in icon, drawn by the line-glyph primitive at Prism's stroke
 *  (1.7, D14), its filled dots over it. */
export function BuiltInIcon({
  icon,
  ...rest
}: { icon: FolderIconDef } & Omit<ComponentProps<typeof Icon>, 'd' | 'name' | 'children'>): JSX.Element {
  return (
    <Icon d={icon.d} {...rest}>
      {icon.fill ? <path d={icon.fill} fill="currentColor" /> : null}
    </Icon>
  )
}

/**
 * A FOLDER'S OWN ICON, OR ITS DEFAULT (folder icons, 2026-10-31). `icon` is the
 * path's stored choice (`lib/folderIcons.ts`); with none, or before the
 * built-in set has loaded, `fallback` is drawn, which is what the row drew
 * before. A built-in glyph wears `color` (the folder colour in the Explorer and
 * the search popup, the row's ink in the sidebar: D4) and says its name in
 * `data-folder-icon` for the e2e.
 *
 * Pictures from a file are PR 3; until then such an entry draws the default.
 */
export function FolderGlyph({
  icon,
  size,
  color,
  className,
  fallback
}: {
  icon: FolderIconChoice | undefined
  size: number
  /** Built-in glyphs only; undefined keeps the ink around it. */
  color?: string
  className?: string
  fallback: ReactElement
}): JSX.Element {
  const set = useFolderIconSet()
  const def = icon && 'set' in icon ? set?.byName.get(icon.set) : undefined
  if (!def) return fallback
  return (
    <BuiltInIcon
      icon={def}
      size={size}
      className={['shrink-0', className].filter(Boolean).join(' ')}
      data-folder-icon={def.name}
      {...(color ? { style: { color } } : {})}
    />
  )
}
