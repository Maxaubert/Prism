import type { JSX } from 'react'

/** The sidebar's own folder silhouette (TreeRows.FolderIcon), inlined rather
 *  than imported so the phone bundle does not pull the tree in; shared by the
 *  explorer's rows and tiles and by the tab drawer (#145). */
export function FolderGlyph({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="var(--p-tree-folder)"
      className="shrink-0"
      aria-hidden
    >
      <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
    </svg>
  )
}
