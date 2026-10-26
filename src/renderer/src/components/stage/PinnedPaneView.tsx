import { useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import type { SplitDir } from '../../lib/panes'
import { fileKind } from '@shared/fileKind'
import { baseName, extOf } from '@shared/path'
import { ContextMenu } from '../ContextMenu'
import { splitPaneMenu } from '../../menus/splitPane'
import { Icon } from '../icons/Icon'
import { Viewer } from './Viewer'

/** One pinned split pane: a fixed file, independent of paging, with its X. */
export function PinnedPaneView({
  paneId,
  path,
  area,
  dir,
  onMove,
  onClose,
  viewerProps
}: {
  paneId: string
  path: string
  area: string
  dir: SplitDir
  onMove: (dir: SplitDir) => void
  onClose: () => void
  /** What the pane's viewer needs. */
  viewerProps?: Omit<Parameters<typeof Viewer>[0], 'file'>
}): JSX.Element {
  const name = baseName(path)
  const ext = extOf(name)
  const file: ViewerFile = { path, name, ext, kind: fileKind(ext, name), size: 0, mtimeMs: 0 }
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <div
      data-pane="pinned"
      data-pane-id={paneId}
      className="group/pane relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[var(--p-bg)]"
      style={{ gridArea: area }}
      // A right-click along the pane's TOP BAND (owner, 2026-09-03) is about
      // the pane - where it sits, and taking it out of the split. Lower down
      // the file's own menu answers, so this is decided by height in the
      // capture phase rather than by a strip that would eat the picture's
      // clicks.
      onContextMenuCapture={(e) => {
        const top = e.currentTarget.getBoundingClientRect().top
        if (e.clientY - top > 28) return
        e.preventDefault()
        e.stopPropagation()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={splitPaneMenu({ dir, onMove, onClose })}
        />
      )}
      {viewerProps ? <Viewer key={`${file.kind}:${path}`} file={file} {...viewerProps} /> : null}
      <button
        className="no-drag absolute right-2 top-2 z-20 grid h-6 w-6 place-items-center rounded bg-black/30 text-[var(--p-icon)] opacity-0 transition-opacity hover:bg-black/50 hover:text-[var(--p-text)] focus-visible:opacity-100 group-hover/pane:opacity-100"
        onClick={onClose}
        title="Remove from split view"
        aria-label={`Remove ${name} from split view`}
      >
        <Icon name="close" size={11} weight="2.2" join={false} />
      </button>
    </div>
  )
}
