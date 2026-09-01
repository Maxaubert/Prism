import { useEffect, useRef, useState, type JSX } from 'react'
import type { DirListing, FileKind } from '@shared/types'
import type { TREE_SIZES } from '../lib/treePrefs'
import { sortFiles, useSort } from '../lib/sortPrefs'
import { useTree } from '../lib/treeContext'
import { ICON_PATHS, LANG_BY_EXT, LANG_BY_NAME, LANG_PATHS } from '../lib/iconPaths'

// The rows of the file tree: folders that expand, files that open, and the inline
// rename editor. The panel shell (width, scrolling, loading) lives in Sidebar.

/** Folders wear the folder token, files the file token - both pickers in
 *  Settings, both derived per style by theme.ts against its own ground, with a
 *  4.5:1 floor. That derivation is why the icons need no light/dark switch of
 *  their own: a light style resolves the same token to dark ink. */
export function iconColour(kind: FileKind | 'folder'): string {
  // FOLDERS keep their own colour: they are not one of the file kinds and the
  // tint is what lets you scan containers from contents at a glance.
  if (kind === 'folder') return 'var(--p-tree-folder)'
  // Every FILE kind is the same ink. The per-kind tints retired 2026-08-21 and
  // the archive's own colour went with the drawn icons (2026-08-31): the kind
  // lives in the SHAPE, and tinting it as well read as a colour chart.
  return 'var(--p-tree-file)'
}

type Size = (typeof TREE_SIZES)[number]

/* ---------- glyphs ---------- */

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-[var(--p-dim2)] transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

/**
 * Prism's own icon for a file kind, monochrome (2026-08-31).
 *
 * The nine FileKinds map onto the SEVEN icons the .ico set ships, and the map
 * is Explorer's own: `assoc.nsh` points Prism.Text at the code icon and
 * Prism.Document at the document one, so a .ts in the sidebar and the same .ts
 * on the desktop are the same picture. 'other' is not registered with Windows
 * at all and takes the plain page.
 *
 * `bg` IS THE BACKGROUND ACTUALLY BEHIND THE ROW, and the fold and the chip
 * are painted in it. Passing the panel token instead looks perfect in every
 * screenshot of an unselected tree and is wrong the moment somebody clicks a
 * row: the icon then carries a rectangle of panel colour across the accent
 * fill. Both surfaces that draw these rows sit on --p-side-flat, which is why
 * that is the default.
 *
 * Exported for the search results and the archive panel, which draw the same
 * rows outside the tree.
 */
const KIND_ICON: Record<FileKind, keyof typeof ICON_PATHS> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  comic: 'comic',
  archive: 'archive',
  pdf: 'document',
  doc: 'document',
  text: 'code',
  other: 'document'
}

/**
 * Which language mark a file gets, if any.
 *
 * By EXTENSION first, then by whole NAME - and the name half is the app doing
 * something Explorer cannot. Windows associates on extension, so `Dockerfile`
 * and `.gitignore` can never carry a mark on the desktop however well drawn;
 * here they can, and do. Expect that asymmetry rather than reading it as a bug.
 */
function langFor(kind: FileKind, name?: string, ext?: string): keyof typeof LANG_PATHS | null {
  if (kind !== 'text' || !name) return null
  const e = (ext ?? '').replace(/^\./, '').toLowerCase()
  if (e && e in LANG_BY_EXT) return LANG_BY_EXT[e]
  const n = name.toLowerCase()
  return n in LANG_BY_NAME ? LANG_BY_NAME[n] : null
}

/**
 * The size at which the extension on the band becomes letters rather than a
 * smudge, MEASURED rather than chosen.
 *
 * The label is 4.08 units tall in a 24-unit viewBox, so at N pixels its cap
 * height is 4.08 * N / 24. At the tree's 14px that is 2.4px, and no typeface is
 * legible at 2.4px - LOG, MD and TXT all come out as the same three grey dots,
 * which is exactly what they looked like. Five pixels is the floor for reading
 * three characters, and 5 * 24 / 4.08 is 29.4.
 *
 * So below this the band is drawn EMPTY and the mark carries the kind. Nothing
 * is lost: a tree row has the filename beside it, in a face chosen to be read,
 * and `cleanup.log` already ends in the three characters the band was
 * whispering. The .ico keeps its label at every size because its frames go up
 * to 256, where it reads properly.
 */
const LABEL_FLOOR = 30

export function KindIcon({
  kind,
  color,
  ext,
  name,
  size = 14,
  bg = 'var(--p-side-flat)'
}: {
  kind: FileKind
  color: string
  /** The file's own extension, with or without the dot. Drawn on the band. */
  ext?: string
  /** The file's whole name, for the marks Windows cannot register. */
  name?: string
  /** How big it is drawn. Only the label cares, and only at LABEL_FLOOR. */
  size?: number
  bg?: string
}): JSX.Element {
  // body, then ko, then hi. Any other order and the detail vanishes: `hi` is
  // punched back OVER ko in the ink, which is what keeps the clapperboard's
  // stripes, the splat's core and a mark's own holes from filling in solid.
  const g = ICON_PATHS[KIND_ICON[kind] ?? 'document']
  const lang = langFor(kind, name, ext)
  const mark = lang ? LANG_PATHS[lang] : null
  const label = size >= LABEL_FLOOR ? (ext ?? '').replace(/^\./, '').toUpperCase() : ''
  const L = g.label
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden>
      <path d={g.body} fill={color} />
      {/* A language mark REPLACES the kind's own, so `ko` is the kind's fold
          and band with the mark swapped in - not both marks on one page. */}
      <path d={mark ? `${foldAndBand(g.ko)} ${mark.ko}` : g.ko} fill={bg} />
      {mark ? (
        mark.hi ? <path d={mark.hi} fill={color} /> : null
      ) : g.hi ? (
        <path d={g.hi} fill={color} />
      ) : null}
      {label ? (
        <text
          x={L.x}
          y={L.y}
          // Keyed by CHARACTER COUNT, not scaled: two and three characters keep
          // the full size and only WEBM-length ones step down, which is what
          // stops a long extension running out of the band.
          fontSize={L.sizes[Math.min(label.length, 6) as keyof typeof L.sizes]}
          fill={color}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {label}
        </text>
      ) : null}
    </svg>
  )
}

/**
 * The fold and the band out of a kind's `ko`, without its mark.
 *
 * The emitter writes them FIRST and in that order, so the first two subpaths
 * are always exactly those two. Splitting on 'M' rather than re-deriving them
 * keeps one definition of the page's geometry in the generator, which is the
 * whole reason the paths are generated at all.
 */
function foldAndBand(ko: string): string {
  return ko.split(/(?=M)/).slice(0, 2).join('')
}

export function FolderIcon({ color }: { color: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill={color} className="shrink-0" aria-hidden>
      <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
    </svg>
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
function Note({ text, pad }: { text: string; pad: number }): JSX.Element {
  return (
    <div
      className="py-[5px] text-[11.5px] italic text-[var(--p-dim2)]"
      style={{ paddingLeft: pad + 20 }}
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
  const input = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(name)
  const done = useRef(false)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    const dot = name.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name])

  const finish = (commit: boolean): void => {
    if (done.current) return // blur fires after Enter; only the first one counts
    done.current = true
    if (commit && value.trim() && value !== name) onSubmit(value.trim())
    else onCancel()
  }

  return (
    <div className="flex items-center" style={{ height: size.row, paddingLeft: pad + 19 }}>
      <input
        ref={input}
        value={value}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation() // the app's arrow-key paging must not see this
          if (e.key === 'Enter') finish(true)
          else if (e.key === 'Escape') finish(false)
        }}
        className="w-full rounded border border-[var(--p-accent-hi)] bg-[var(--p-bg)] px-1.5 py-0.5 text-[var(--p-text)] outline-none"
        style={{ fontSize: size.font }}
      />
    </div>
  )
}

/* ---------- rows ---------- */

function Folder({ path, name, depth }: { path: string; name: string; depth: number }): JSX.Element {
  const t = useTree()
  const open = t.expanded.has(path)
  const listing = t.children[path]
  const pad = 4 + depth * t.size.indent
  // The cursor carries the accent wherever it goes, folders included.
  const onCursor = !!t.cursor && t.cursor.toLowerCase() === path.toLowerCase()
  // The right-clicked row keeps its hover look while its menu is up.
  const onMenuHl = !!t.menuPath && t.menuPath.toLowerCase() === path.toLowerCase()
  return (
    <li role="none">
      {t.editing === path ? (
        <RenameRow
          name={name}
          pad={pad - 19}
          size={t.size}
          onSubmit={(v) => t.onSubmitRename(path, v)}
          onCancel={t.onCancelRename}
        />
      ) : (
        <button
          role="treeitem"
          aria-expanded={open}
          // The cursor's row is the tree's one tab stop (roving tabindex), so
          // Tab reaches the tree once and Enter/Space then work natively on the
          // row the arrows are on - no key handling of our own for either.
          data-row={path}
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
            e.dataTransfer.dropEffect = 'move'
            t.onDropHover(path)
          }}
          onDragLeave={() => t.onDropHover(null)}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            t.onDropOn(e, path)
          }}
          // A plain click SELECTS a folder; a second one expands it. Shift and
          // ctrl build a selection without touching the chevron state either
          // way. The chevron itself still expands on the first click, since
          // that is the one control whose whole job is the folder's state.
          onClick={(e) => t.onRowClick(e, path, true)}
          onContextMenu={(e) => t.onMenu(e, path, name, true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              t.onToggle(path)
            } else if (e.key === 'F2') {
              e.preventDefault()
              t.onStartRename(path)
            } else if (e.key === 'Delete') {
              e.preventDefault()
              t.onDelete(path, name, true)
            }
          }}
          className={`flex w-full items-center gap-1.5 rounded-[var(--p-radius-sm)] pr-2 text-left outline-none focus-visible:outline-none ${
            t.dropTarget === path
              ? 'bg-[var(--p-hover-hi)] text-[var(--p-text)] ring-1 ring-inset ring-[var(--p-accent-hi)]'
              : onCursor || t.selected.has(path)
                ? 'bg-[var(--p-sel-bg)] font-medium text-[var(--p-on-accent)]'
                : onMenuHl
                  ? 'bg-[var(--p-hover-hi)] text-[var(--p-text)]'
                  : 'text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
          }`}
          style={{
            height: t.size.row,
            paddingLeft: pad,
            fontSize: t.size.font,
            // Contiguous selected rows fuse: shared edges drop their rounding.
            ...(t.selected.has(path)
              ? (() => {
                  const j = t.selJoin(path)
                  return {
                    borderTopLeftRadius: j.top ? 0 : undefined,
                    borderTopRightRadius: j.top ? 0 : undefined,
                    borderBottomLeftRadius: j.bottom ? 0 : undefined,
                    borderBottomRightRadius: j.bottom ? 0 : undefined
                  }
                })()
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
          <FolderIcon
            color={onCursor || t.selected.has(path) ? 'var(--p-on-accent)' : 'var(--p-tree-folder)'}
          />
          <Label name={name} />
        </button>
      )}
      {/* Children stay mounted once loaded and the row track collapses to 0fr, so
          opening and closing a folder slides instead of snapping. */}
      {listing ? (
        <div
          className="grid transition-[grid-template-rows] duration-[160ms] [transition-timing-function:cubic-bezier(.23,1,.32,1)]"
          style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <Rows listing={listing} depth={depth + 1} />
          </div>
        </div>
      ) : (
        open && <Note text="loading…" pad={4 + (depth + 1) * t.size.indent} />
      )}
    </li>
  )
}

export function Rows({ listing, depth }: { listing: DirListing; depth: number }): JSX.Element {
  const t = useTree()
  const sort = useSort()
  const pad = 4 + depth * t.size.indent
  if (listing.unreadable) return <Note text="can't read this folder" pad={pad} />
  // "empty" is a claim about the FOLDER; a folder of installers is not empty,
  // Prism just has nothing to show from it, and saying "empty" there reads as
  // a missing or broken folder (2026-08-30).
  if (!listing.folders.length && !listing.files.length)
    return (
      <Note
        text={
          listing.hidden
            ? `${listing.hidden} file${listing.hidden === 1 ? '' : 's'} Prism can't open`
            : 'empty'
        }
        pad={pad}
      />
    )
  // The sort orders the rows the same way it orders the paging.
  const files = sortFiles(listing.files, sort.field, sort.dir)
  // Folders sort by name (they have no size or kind worth ordering by) and
  // follow the direction only when the field is name, the way Explorer does.
  const folders =
    sort.field === 'name' && sort.dir === 'desc' ? [...listing.folders].reverse() : listing.folders
  // A hairline dropped from the parent's chevron, so deep nesting stays legible.
  const guide = depth > 0 ? 4 + (depth - 1) * t.size.indent + 6 : -1
  return (
    <ul role="group" className="relative list-none">
      {guide >= 0 && (
        <span
          className="absolute inset-y-0 w-px bg-[var(--p-divider)]"
          style={{ left: guide }}
          aria-hidden
        />
      )}
      {folders.map((f) => (
        <Folder key={f.path} path={f.path} name={f.name} depth={depth} />
      ))}
      {files.map((f) => {
        if (t.editing === f.path) {
          return (
            <li key={f.path} role="none">
              <RenameRow
                name={f.name}
                pad={pad}
                size={t.size}
                onSubmit={(v) => t.onSubmitRename(f.path, v)}
                onCancel={t.onCancelRename}
              />
            </li>
          )
        }
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
        const onSel = onCursor || t.selected.has(f.path)
        // The right-clicked row keeps its hover look while its menu is up.
        const onMenuHl = !!t.menuPath && f.path.toLowerCase() === t.menuPath.toLowerCase()
        return (
          <li key={f.path} role="none">
            <button
              role="treeitem"
              aria-selected={on}
              data-row={f.path}
              data-selected={onSel || undefined}
              draggable
              onDragStart={(e) => t.onRowDragStart(e, f.path)}
              onDragEnd={() => t.onDragDone()}
              // Roving tabindex: the cursor's row is the tree's single tab stop.
              tabIndex={!!t.cursor && t.cursor.toLowerCase() === f.path.toLowerCase() ? 0 : -1}
              // A plain click still OPENS, quick-look style (only archives
              // are double-click); shift ranges and ctrl toggles select
              // WITHOUT opening.
              onClick={(e) => t.onRowClick(e, f.path, false)}
              onContextMenu={(e) => t.onMenu(e, f.path, f.name, false, f.size)}
              onKeyDown={(e) => {
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
              className={`flex w-full items-center gap-1.5 rounded-md pr-2 text-left outline-none focus-visible:outline-none ${
                onSel
                  ? `bg-[var(--p-sel-bg)] text-[var(--p-on-accent)] ${unsaved ? 'font-bold' : 'font-medium'}`
                  : onMenuHl
                    ? `bg-[var(--p-hover-hi)] text-[var(--p-text)] ${unsaved ? 'font-bold' : ''}`
                    : `text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] ${
                        unsaved ? 'font-bold text-[var(--p-text)]' : ''
                      }`
              }`}
              style={{
                height: t.size.row,
                paddingLeft: pad + 19,
                fontSize: t.size.font,
                // Contiguous selected rows fuse: shared edges drop rounding.
                ...(onSel
                  ? (() => {
                      const j = t.selJoin(f.path)
                      return {
                        borderTopLeftRadius: j.top ? 0 : undefined,
                        borderTopRightRadius: j.top ? 0 : undefined,
                        borderBottomLeftRadius: j.bottom ? 0 : undefined,
                        borderBottomRightRadius: j.bottom ? 0 : undefined
                      }
                    })()
                  : {})
              }}
            >
              <KindIcon
                kind={f.kind}
                // The knockout only applies on the filled row, which is now the
                // selection's rather than the open file's.
                color={onSel ? 'var(--p-on-accent)' : iconColour(f.kind)}
                // The knockouts take what is BEHIND the row, which on a
                // selected one is the accent fill and not the panel.
                bg={onSel ? 'var(--p-accent)' : undefined}
                ext={f.ext}
                name={f.name}
              />
              <Label name={unsaved ? `${f.name}*` : f.name} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
