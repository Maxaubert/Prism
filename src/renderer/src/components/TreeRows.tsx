import { useEffect, useRef, useState, type CSSProperties, type JSX, type RefObject } from 'react'
import type { ViewerFile } from '@shared/types'
import { parentDir } from '@shared/path'
import { RenameField } from './RenameField'
import { treeWindow, type PaintRow } from '../lib/treePaint'
import { ROW_GAP, ROW_PAD_X, type TREE_SIZES } from '../lib/treePrefs'
import { ALONE, markedLook } from '../lib/markedLook'
import { useTree } from '../lib/treeContext'
import { dragIncludesPath } from '../lib/dragDrop'
import { FolderIcon, KindIcon, iconColour } from './icons/FileIcons'
import { Icon } from './icons/Icon'

// The rows of the file tree: folders that expand, files that open, and the inline
// rename editor. The panel shell (width, scrolling, loading) lives in Sidebar.

type Size = (typeof TREE_SIZES)[number]

/* ---------- glyphs ---------- */

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <Icon
      name="chevronRight"
      size={13}
      weight="2.4"
      className={`shrink-0 text-[var(--p-dim2)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
    />
  )
}


/**
 * The row's name. A tooltip only appears when the name is actually clipped:
 * repeating a label you can already read in full is noise, and the tooltip is
 * here to recover what the panel width took away.
 */
function Label({ name }: { name: string }): JSX.Element {
  const [clipped, setClipped] = useState(false)
  return (
    <span
      className="truncate"
      title={clipped ? name : undefined}
      onPointerEnter={(e) => {
        const el = e.currentTarget
        setClipped(el.scrollWidth > el.clientWidth)
      }}
    >
      {name}
    </span>
  )
}

/** A muted, unclickable row: "empty", "can't read", "loading". */
function Note({ text, pad, height }: { text: string; pad: number; height?: number }): JSX.Element {
  return (
    <div
      className={`${height ? 'flex items-center' : 'py-[5px]'} text-[11.5px] italic text-[var(--p-dim2)]`}
      style={{ paddingLeft: pad + 20, height }}
    >
      {text}
    </div>
  )
}

/* ---------- rename ---------- */

/** The row turns into this while you rename. The stem is preselected, the way
 *  Explorer does it, so typing replaces the name but keeps the extension. */
function RenameRow({
  name,
  pad,
  size,
  onSubmit,
  onCancel
}: {
  name: string
  pad: number
  size: Size
  onSubmit: (v: string) => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="flex items-center" style={{ height: size.row, paddingLeft: pad + 19 }}>
      <RenameField
        name={name}
        onSubmit={onSubmit}
        onCancel={onCancel}
        className="w-full rounded border border-[var(--p-accent-hi)] bg-[var(--p-bg)] px-1.5 py-0.5 text-[var(--p-text)] outline-none"
        style={{ fontSize: size.font }}
      />
    </div>
  )
}

/* ---------- rows ---------- */

/** The folder a path sits in. A FILE row is a drop target for its own
 *  folder: dropping onto a file means dropping beside it, which is what
 *  every file manager does and what the tree did not do - the drop fell
 *  through to the window, which opens whatever it is handed, so dropping a
 *  FOLDER there re-rooted the tab instead of moving anything. */
const dirOf = parentDir

/** The hairlines dropped from each ancestor's chevron, so deep nesting stays
 *  legible. The nested tree drew one per group, the full height of the group;
 *  a flat row draws the ones it sits inside, which meet row to row into the
 *  same lines. */
function Guides({ depth, indent }: { depth: number; indent: number }): JSX.Element | null {
  if (depth < 1) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="absolute inset-y-0 w-px bg-[var(--p-divider)]"
          style={{ left: 4 + i * indent + 6 }}
          aria-hidden
        />
      ))}
    </>
  )
}


function FolderRow({
  path,
  name,
  depth,
  zip
}: {
  path: string
  name: string
  depth: number
  /** An archive drawn as a folder (#300): its icon, and the FILE's menu and
   *  keys (the archive's verbs), while it expands like a folder. */
  zip?: ViewerFile
}): JSX.Element {
  const t = useTree()
  const open = t.expanded.has(path)
  const pad = 4 + depth * t.size.indent
  // The cursor carries the accent wherever it goes, folders included.
  const onCursor = !!t.cursor && t.cursor.toLowerCase() === path.toLowerCase()
  // Lit by the cursor only while the cursor marks (#330): after Ctrl+Up/Down,
  // Escape or Ctrl+Space the marks alone light it, as on a file row.
  const lit = (onCursor && t.cursorMarks !== false) || t.selected.has(path)
  // The right-clicked row wears the selection's tint while its menu is up
  // (#296; owner, 2026-10-06), File Explorer's look; it is not selected.
  const onMenuHl = !!t.menuPath && t.menuPath.toLowerCase() === path.toLowerCase()
  if (t.editing === path)
    return (
      <RenameRow
        name={name}
        pad={pad - 19}
        size={t.size}
        onSubmit={(v) => t.onSubmitRename(path, v)}
        onCancel={t.onCancelRename}
      />
    )
  return (
    <button
      role="treeitem"
      aria-expanded={open}
      aria-level={depth + 1}
      // The cursor's row is the tree's one tab stop (roving tabindex), so
      // Tab reaches the tree once and Enter/Space then work natively on the
      // row the arrows are on - no key handling of our own for either.
      data-row={path}
      data-dropdir={path}
      data-selected={t.selected.has(path) || undefined}
      data-drop={t.dropTarget === path || undefined}
      tabIndex={onCursor ? 0 : -1}
      // A folder is both cargo and destination (#70): drag it elsewhere,
      // or drop files, folders and archive members into it.
      draggable
      onDragStart={(e) => t.onRowDragStart(e, path)}
      onDragEnd={() => t.onDragDone()}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (dragIncludesPath(e.dataTransfer, path)) {
          e.dataTransfer.dropEffect = 'none'
          t.onDropHover(null)
          return
        }
        e.dataTransfer.dropEffect = 'move'
        t.onDropHover(path)
      }}
      onDragLeave={() => t.onDropHover(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (dragIncludesPath(e.dataTransfer, path)) {
          t.onDragDone()
          return
        }
        t.onDropOn(e, path)
      }}
      // A plain click SELECTS a folder; a second one expands it. Shift and
      // ctrl build a selection without touching the chevron state either
      // way. The chevron itself still expands on the first click, since
      // that is the one control whose whole job is the folder's state.
      onClick={(e) => t.onRowClick(e, path, true)}
      onContextMenu={(e) => t.onMenu(e, path, name, !zip)}
      data-zip-node={zip ? true : undefined}
      onKeyDown={(e) => {
        // A chord is the panel's (#330): Ctrl+Enter a new tab, Alt+Enter
        // Properties, Shift+Delete the bin (Sidebar's listKey).
        if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return
        if (e.key === 'Enter') {
          e.preventDefault()
          t.onToggle(path)
        } else if (e.key === 'F2') {
          e.preventDefault()
          t.onStartRename(path)
        } else if (e.key === 'Delete') {
          e.preventDefault()
          t.onDelete(path, name, !zip)
        }
      }}
      className={`relative flex w-full items-center rounded-[var(--p-radius-sm)] text-left outline-none focus-visible:outline-none ${
        // The folder a drag hovers is MARKED in grey, not ringed in the
        // accent (2026-09-14, #140):
        // the accent means selected, and a drop destination is not.
        t.dropTarget === path
          ? 'bg-[var(--p-hover-hi)] text-[var(--p-text)]'
          : lit
            ? // The tint is in `style` (markedLook); the text keeps its colour.
              'text-[var(--p-text-soft)]'
            : onMenuHl
              ? 'text-[var(--p-text)]'
              : 'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
      }`}
      style={{
        height: t.size.row,
        paddingLeft: pad,
        paddingRight: ROW_PAD_X,
        gap: ROW_GAP,
        fontSize: t.size.font,
        // A cut row is half gone already, and looks it (Explorer's cue).
        opacity: t.cut.has(path.toLowerCase()) ? 0.45 : undefined,
        // Contiguous selected rows fuse: shared edges drop their rounding.
        // A drop target's grey wins over the tint, as its class does.
        ...(t.dropTarget !== path && lit
          ? markedLook(t.selected.has(path) ? t.selJoin(path) : ALONE)
          : t.dropTarget !== path && onMenuHl
            ? markedLook(ALONE)
            : {})
      }}
    >
      {/* The chevron keeps its single-click expand; it opts out of the
          row's select-click. */}
      <span
        className="grid place-items-center"
        onClick={(e) => {
          e.stopPropagation()
          t.onToggle(path)
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Chevron open={open} />
      </span>
      {zip ? (
        <KindIcon
          kind="archive"
          ext={zip.ext}
          name={zip.name}
          color={iconColour('archive')}
          bg={lit ? 'var(--p-sel-tint-side)' : undefined}
        />
      ) : (
        <FolderIcon color="var(--p-tree-folder)" />
      )}
      <Label name={name} />
    </button>
  )
}

function FileRow({ f, depth }: { f: ViewerFile; depth: number }): JSX.Element {
  const t = useTree()
  const pad = 4 + depth * t.size.indent
  if (t.editing === f.path)
    return (
      <RenameRow
        name={f.name}
        pad={pad}
        size={t.size}
        onSubmit={(v) => t.onSubmitRename(f.path, v)}
        onCancel={t.onCancelRename}
      />
    )
  const on = !!t.currentPath && f.path.toLowerCase() === t.currentPath.toLowerCase()
  // Unsaved work, said the way every editor says it: bold, and a star.
  // Any file can carry it now, not just the open one - unsaved text
  // survives you wandering off to look at something else.
  const unsaved = t.dirtyPaths.has(f.path.toLowerCase())
  // One mark, not two: the accent is the cursor, and it follows the arrows
  // onto folders. Which file is on screen goes deliberately unmarked while
  // the cursor is elsewhere - the viewer is already showing it, and a
  // second highlight competing with the first was more noise than help.
  // `aria-selected` still says so for anything reading the tree.
  const onCursor = !!t.cursor && f.path.toLowerCase() === t.cursor.toLowerCase()
  const onSel = (onCursor && t.cursorMarks !== false) || t.selected.has(f.path)
  // The right-clicked row wears the selection's tint while its menu is up
  // (#296; owner, 2026-10-06), File Explorer's look; it is not selected.
  const onMenuHl = !!t.menuPath && f.path.toLowerCase() === t.menuPath.toLowerCase()
  // The drop line (#126): a drag over this row lands in its folder, and
  // when that folder is the root there is no row to light, so the line
  // under the hovered row is the only cue. Drawn for every folder
  // whose row is not on screen, which is the root and nothing else.
  const dropLine = t.dropRow === f.path && t.dropTarget === dirOf(f.path)
  return (
    <>
      {dropLine && (
        <span
          data-drop-line
          aria-hidden
          className="pointer-events-none absolute inset-x-1 bottom-0 z-10 h-[2px] rounded-full bg-[var(--p-accent-hi)]"
        />
      )}
      <button
        role="treeitem"
        aria-selected={on}
        aria-level={depth + 1}
        data-row={f.path}
        data-dropdir={dirOf(f.path)}
        data-selected={onSel || undefined}
        draggable
        onDragStart={(e) => t.onRowDragStart(e, f.path)}
        onDragEnd={() => t.onDragDone()}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (dragIncludesPath(e.dataTransfer, f.path)) {
            e.dataTransfer.dropEffect = 'none'
            t.onDropHover(null)
            return
          }
          e.dataTransfer.dropEffect = 'move'
          // The FOLDER lights up, not the file: the file is where the
          // pointer is, its folder is where the thing will land - and
          // when that folder has no row to light (the root), a line
          // under THIS row says so (#126).
          t.onDropHover(dirOf(f.path), f.path)
        }}
        onDragLeave={() => t.onDropHover(null)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (dragIncludesPath(e.dataTransfer, f.path)) {
            t.onDragDone()
            return
          }
          t.onDropOn(e, dirOf(f.path))
        }}
        // Roving tabindex: the cursor's row is the tree's single tab stop.
        tabIndex={onCursor ? 0 : -1}
        // A plain click still OPENS, quick-look style (only archives
        // are double-click); shift ranges and ctrl toggles select
        // WITHOUT opening.
        onClick={(e) => t.onRowClick(e, f.path, false)}
        onContextMenu={(e) => t.onMenu(e, f.path, f.name, false, f.size)}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return // the panel's (#330)
          if (e.key === 'Enter') {
            e.preventDefault()
            t.onOpenFile(f.path)
          } else if (e.key === 'F2') {
            e.preventDefault()
            t.onStartRename(f.path)
          } else if (e.key === 'Delete') {
            e.preventDefault()
            t.onDelete(f.path, f.name, false)
          }
        }}
        className={`relative flex w-full items-center rounded-md text-left outline-none focus-visible:outline-none ${
          onSel
            ? // The tint is in `style` (markedLook); the text keeps its colour.
              `text-[var(--p-text-soft)] ${unsaved ? 'font-bold text-[var(--p-text)]' : ''}`
            : onMenuHl
              ? `text-[var(--p-text)] ${unsaved ? 'font-bold' : ''}`
              : `text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] ${
                  unsaved ? 'font-bold text-[var(--p-text)]' : ''
                }`
        }`}
        style={{
          height: t.size.row,
          paddingLeft: pad + 19,
          paddingRight: ROW_PAD_X,
          gap: ROW_GAP,
          fontSize: t.size.font,
          // A cut row is half gone already, and looks it (Explorer's cue).
          opacity: t.cut.has(f.path.toLowerCase()) ? 0.45 : undefined,
          // Contiguous selected rows fuse: shared edges drop rounding.
          ...(onSel
            ? markedLook(t.selected.has(f.path) ? t.selJoin(f.path) : ALONE)
            : onMenuHl
              ? markedLook(ALONE)
              : {})
        }}
      >
        <KindIcon
          kind={f.kind}
          // A marked row is a tint now, so the icon keeps its own colours:
          // the monochrome fallback was for an accent SLAB a coloured icon
          // could vanish into, and a fifth of the accent is not one.
          color={iconColour(f.kind)}
          // The knockouts take what is BEHIND the row: the tint as seen.
          bg={onSel || onMenuHl ? 'var(--p-sel-tint-side)' : undefined}
          ext={f.ext}
          name={f.name}
        />
        <Label name={unsaved ? `${f.name}*` : f.name} />
      </button>
    </>
  )
}

/**
 * The sweep rectangle (#257): the Selection colour (the accent while none is
 * picked) at a low strength with a thin light edge, Explorer's look in this
 * app's colours; Windows draws its drag box in the selection colour too.
 * `color-mix` against transparent keeps an accent that is itself see-through
 * see-through. Never animated: it is where the pointer is, and nothing else.
 * Its place is not a prop (#332): `useSweep` writes it straight onto the
 * element from the pointer handler, and it stays hidden until it has one.
 * On Windows 11 a mouse sweep's box is drawn natively by main (#338) in this
 * element's own computed colours, and this element stays mounted and placed
 * but hidden, ready to show the moment main says it cannot draw. The native
 * box's corners are square (Explorer's are too).
 */
export function SweepBand({
  bandRef,
  as = 'li'
}: {
  bandRef: (el: HTMLElement | null) => void
  as?: 'li' | 'div'
}): JSX.Element {
  const style: CSSProperties = {
    display: 'none',
    background: 'color-mix(in srgb, var(--p-sel-hue) 16%, transparent)',
    // The edge is the hue pulled toward the text colour: a pure accent edge
    // vanished into the rows it crossed when a mark was a solid accent fill
    // (MEASURED in the first screenshot, #257), and it still has to stand
    // apart from the marked rows' own edges, which are the same hue.
    border: '1px solid color-mix(in srgb, var(--p-sel-hue-hi) 45%, var(--p-text))',
    borderRadius: 2
  }
  const Tag = as
  return (
    <Tag
      ref={bandRef}
      role={as === 'li' ? 'none' : undefined}
      aria-hidden
      data-sweep-band
      className="pointer-events-none absolute z-20"
      style={style}
    />
  )
}

/**
 * THE TREE, DRAWN A WINDOW AT A TIME (2026-09-28; owner: "it takes like 3
 * seconds for it to react ... it should never load folders, they should always
 * be there"). MEASURED before: 47,816 rows in the page with Temp open, and a
 * 1.2 s block of the renderer on every folder switch. Now the list is a spacer
 * of the full height, and only the rows in view (and `OVERSCAN` either side)
 * exist, so any folder, of any size, costs the same few dozen rows. The rows
 * are the nested tree's own, flattened by `paintRows`; every row is exactly
 * `size.row` tall, which is what lets the window be worked out by arithmetic.
 *
 * A folder that opens fades its rows in (`tree-row-in`). The old slide needed
 * every child mounted, and every child mounted is what this removes.
 */
export function TreeWindow({
  rows,
  scroller,
  band = null
}: {
  rows: readonly PaintRow[]
  scroller: RefObject<HTMLDivElement | null>
  /** While a sweep (#257) draws: where its rectangle is mounted. `useSweep`
   *  places it, in this list's own coordinates (#332). */
  band?: ((el: HTMLElement | null) => void) | null
}): JSX.Element {
  const t = useTree()
  const list = useRef<HTMLUListElement>(null)
  const rowH = t.size.row
  const [view, setView] = useState({ top: 0, height: 0 })
  useEffect(() => {
    const box = scroller.current
    if (!box) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const listTop = list.current ? list.current.offsetTop : 0
      const top = Math.max(0, box.scrollTop - listTop)
      const height = box.clientHeight
      setView((v) => (v.top === top && v.height === height ? v : { top, height }))
    }
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    box.addEventListener('scroll', schedule, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(box)
    return () => {
      box.removeEventListener('scroll', schedule)
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [scroller])

  // Which folders opened just now, so their rows fade in rather than appear.
  // Adjusted during render (React's own pattern for state that follows a
  // prop), and forgotten a moment later so a later scroll does not fade.
  const [seen, setSeen] = useState(t.expanded)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  if (seen !== t.expanded) {
    const next = new Set<string>()
    for (const p of t.expanded) if (!seen.has(p)) next.add(p)
    setSeen(t.expanded)
    setFresh(next)
  }
  useEffect(() => {
    if (!fresh.size) return
    const id = setTimeout(() => setFresh(new Set()), 400)
    return () => clearTimeout(id)
  }, [fresh])
  const inFresh = (path: string): boolean => {
    if (!fresh.size) return false
    for (let d = dirOf(path), up = dirOf(d); d; d = up, up = dirOf(d)) {
      if (fresh.has(d)) return true
      if (up === d) break
    }
    return false
  }

  const { first, end } = treeWindow(rows.length, rowH, view.top, view.height)
  const shown = rows.slice(first, end)
  return (
    <ul
      ref={list}
      role="tree"
      aria-label="Folder contents"
      className="relative list-none"
      style={{ height: rows.length * rowH }}
    >
      {shown.map((r, i) => {
        const path = r.kind === 'note' ? r.key.slice(0, r.key.indexOf('\0')) : r.path
        return (
          <li
            key={r.key}
            role="none"
            className={`absolute inset-x-0 ${inFresh(r.kind === 'note' ? path + '\\x' : path) ? 'tree-row-in' : ''}`}
            style={{ top: (first + i) * rowH, height: rowH }}
          >
            <Guides depth={r.depth} indent={t.size.indent} />
            {r.kind === 'folder' ? (
              <FolderRow path={r.path} name={r.name} depth={r.depth} zip={r.zip} />
            ) : r.kind === 'file' ? (
              <FileRow f={r.file} depth={r.depth} />
            ) : (
              <Note text={r.text} pad={4 + r.depth * t.size.indent} height={rowH} />
            )}
          </li>
        )
      })}
      {band && <SweepBand bandRef={band} />}
      {/* The space beneath the list means the root (#126): the line goes
          under the last row, since the root has no row of its own. */}
      {t.dropRow === 'end' && rows.length > 0 && (
        <li role="none" className="absolute inset-x-0 h-0" style={{ top: rows.length * rowH }}>
          <span
            data-drop-line
            aria-hidden
            className="pointer-events-none absolute inset-x-1 -top-[1px] z-10 h-[2px] rounded-full bg-[var(--p-accent-hi)]"
          />
        </li>
      )}
    </ul>
  )
}
