import { useEffect, useId, useRef, useState, type JSX } from 'react'
import type { DirListing, FileKind } from '@shared/types'
import type { TREE_SIZES } from '../lib/treePrefs'
import { sortFiles, useSort } from '../lib/sortPrefs'
import { useTree } from '../lib/treeContext'
import {
  ICON_COLOURS,
  COMIC_ART,
  COMIC_PAGE,
  COMIC_WORD,
  ICON_ALWAYS_COLOUR,
  ICON_FULL_COLOUR,
  ICON_GLINT,
  ICON_PATHS,
  IDENT_BY_EXT,
  LANG_BY_EXT,
  LANG_BY_NAME,
  LANG_PATHS,
  type IconIdentity
} from '../lib/iconPaths'
import { useIconScheme } from '../lib/theme'

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
 * Which COLOUR IDENTITY a file has, which is finer than which icon it draws.
 *
 * `.md` draws the code kind's stepped bars because it has no mark of its own,
 * and `.docx` draws the same page as `.pdf` because both are the document kind.
 * Colouring by kind therefore painted a README as source and a Word file as a
 * PDF. The shape is still the kind's; only the colour is resolved here.
 *
 * A language mark wins first - it is the most specific thing known about the
 * file - then the special extensions, then the kind. That order is what keeps a
 * `.csv` prose rather than a spreadsheet.
 */
function identityFor(
  key: keyof typeof ICON_PATHS,
  lang: keyof typeof LANG_PATHS | null,
  ext?: string
): IconIdentity {
  if (lang) return lang
  const e = (ext ?? '').replace(/^\./, '').toLowerCase()
  return IDENT_BY_EXT[e] ?? key
}

/**
 * THE LABEL IS DRAWN AT EVERY SIZE (owner instruction, 2026-09-01: "they should
 * be the same icons everywhere").
 *
 * It was briefly dropped below 30px on the arithmetic: the label is 4.08 units
 * in a 24-unit viewBox, so at the tree's 14px its cap height is 2.4px, and no
 * typeface is legible at 2.4px. That measurement still stands and the band is
 * still a smudge in a tree row - but the icon being ONE icon everywhere is
 * worth more than the two pixels, and it is the owner's call to make.
 *
 * What actually caused the complaint was not the label at all. `.log` was
 * getting the CODE mark, an indent guide, and a vertical spine with rungs
 * hanging off it is not a picture of structure at 14px - it is two letterforms,
 * read as "PT". Prose has no indentation to draw, so it draws lines now.
 */
export function KindIcon({
  kind,
  color,
  ext,
  name,
  size = 14,
  bg = 'var(--p-side-flat)',
  selected = false
}: {
  kind: FileKind
  color: string
  /** The file's own extension, with or without the dot. Drawn on the band. */
  ext?: string
  /** The file's whole name, for the marks Windows cannot register. */
  name?: string
  /** How big it is drawn. Everything scales with it, the label included. */
  size?: number
  bg?: string
  /** The row is filled with the accent. Forces MONOCHROME - see below. */
  selected?: boolean
}): JSX.Element {
  // body, then ko, then hi. Any other order and the detail vanishes: `hi` is
  // punched back OVER ko in the ink, which is what keeps the clapperboard's
  // stripes, the splat's core and a mark's own holes from filling in solid.
  const key = KIND_ICON[kind] ?? 'document'
  const g = ICON_PATHS[key]
  // COLOURED ignores `color` and `bg` entirely. Nothing is knocked out to the
  // row's background there - every layer is a colour of its own - which is also
  // why a coloured icon is unmoved by landing on a selected row, where the
  // monochrome one has to repaint its fold and band in the accent fill.
  const lang = langFor(kind, name, ext)
  const ident = identityFor(key, lang, ext)
  const c = ICON_COLOURS[ident]
  // A SELECTED ROW FALLS BACK TO MONOCHROME (owner instruction, 2026-09-01),
  // and it is the only thing that can work. The selection fill is the user's
  // ACCENT and the icon colour is the scheme's, so the two are picked by
  // different people and will eventually collide - a blue video icon on a blue
  // fill is an invisible icon, and no amount of choosing better colours fixes
  // it. Monochrome measures its ink against whatever is actually behind it, so
  // it is legible on every accent by construction.
  // THE COMIC WEARS ITS EXPLORER ARTWORK, always and in colour: a keylined
  // sunburst under a halftone under a splat. It never falls back on a selected
  // row the way a flat page does, because five colours cannot all collide with
  // one accent - there is nothing for it to disappear into.
  const artwork = ident === 'comic'
  // AND THE ZIP KEEPS ITS COLOUR even while the scheme is monochrome (owner,
  // 2026-09-01). It does fall back when selected, because it IS a flat page and
  // an indigo one on an indigo accent is the collision the fallback exists for.
  // Hoisted: a hook behind a `||` is a hook that does not always run, and the
  // order has to be identical on every render.
  const scheme = useIconScheme()
  const colour =
    !artwork &&
    !selected &&
    (ICON_ALWAYS_COLOUR.includes(ident) ||
      (scheme === 'colour' && ICON_FULL_COLOUR.includes(ident)))
  const body = colour ? c.page : color
  // One mask id per instance. A shared id works right up until the element
  // that defines it unmounts and takes every other icon's silhouette with it.
  const uid = useId()
  const maskId = `pi-m${uid}`
  const glintId = `pi-g${uid}`
  const mark = lang ? LANG_PATHS[lang] : null
  const markPath = mark ? mark.ko : g.mark
  const hiPath = mark ? mark.hi : g.hi
  const label = (ext ?? '').replace(/^\./, '').toUpperCase()
  const L = g.label
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden>
      {/* COLOURED DRAWS THROUGH A MASK OF ITS OWN SILHOUETTE, and that is not a
          flourish - it is the only arrangement measured to have no edge
          artefact at all. Painting the band OVER the page leaves a hairline of
          page colour around the outside, because the two share a curved outer
          edge and the page's own partial coverage survives underneath. Painting
          them as ABUTTING regions leaves a seam instead, because two
          antialiased edges meeting at 50% each composite to 75% rather than
          100% - measured at 239 pixels of seam per icon on a 256px render.
          `bleed` is the fold and band as plain rectangles overrunning the page
          on every side, so the silhouette is stated exactly once and everything
          inside it is opaque.
          A MASK, NOT A CLIP PATH, and the difference is measurable: Chromium
          applies clip-path to each child and then composites them, so two
          children that both reach the outline double-composite there and the
          edge comes out at 75% where the path itself gives 50%. A mask applies
          to the group's finished result. MEASURED against the bare silhouette:
          mask 0 pixels different, clip-path 79, clip-path inside an opacity
          layer 39.
          Monochrome needs none of this. Its knockouts are painted in the row's
          own background, so both artefacts are background-coloured and have
          never been visible. */}
      {artwork ? (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <path d={g.body} fill="#fff" />
          </mask>
          <g mask={`url(#${maskId})`}>
            <rect x="0" y="0" width="24" height="24" fill={COMIC_PAGE} />
            {COMIC_ART.map((l) => (
              <path key={l.d.slice(0, 24)} d={l.d} fill={l.fill} fillOpacity={l.opacity} />
            ))}
            <text
              x={COMIC_WORD.x}
              y={COMIC_WORD.y}
              fontSize={COMIC_WORD.size}
              fill={COMIC_WORD.fill}
              stroke={COMIC_WORD.stroke}
              strokeWidth={COMIC_WORD.width}
              paintOrder="stroke"
              fontWeight={800}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {COMIC_WORD.text}
            </text>
            <path d={g.bleed} fill={c.band} />
          </g>
        </>
      ) : colour ? (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <path d={g.body} fill="#fff" />
          </mask>
          {/* The GLINT: a highlight rolling off into a shaded corner, so the
              page reads as something with a surface rather than a flat fill.
              It sits over the page and UNDER the band, because a sheen across
              the extension is the one place it costs legibility. */}
          <defs>
            <linearGradient id={glintId} x1="0.08" y1="0" x2="0.82" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity={0.5 * ICON_GLINT} />
              <stop offset="0.3" stopColor="#ffffff" stopOpacity={0.13 * ICON_GLINT} />
              <stop offset="0.34" stopColor="#ffffff" stopOpacity={0.03 * ICON_GLINT} />
              <stop offset="0.66" stopColor="#000000" stopOpacity={0} />
              <stop offset="1" stopColor="#000000" stopOpacity={0.26 * ICON_GLINT} />
            </linearGradient>
          </defs>
          <g mask={`url(#${maskId})`}>
            <rect x="0" y="0" width="24" height="24" fill={c.page} />
            <rect x="0" y="0" width="24" height="24" fill={`url(#${glintId})`} />
            {/* THE BAND GOES ON LAST, which is the order the .ico composites in
                and not a detail. The ARCHIVE's mark is the zip seam and pull,
                and it runs the whole height of the container - straight through
                the band and the extension set in it. A page kind's glyph box
                stops at 10.46 where the band starts at 11.62, so nothing there
                ever reaches it and the wrong order looks perfectly fine on six
                of the seven. */}
            {markPath ? <path d={markPath} fill={c.mark} /> : null}
            {hiPath ? <path d={hiPath} fill={c.page} /> : null}
            <path d={g.bleed} fill={c.band} />
          </g>
        </>
      ) : (
        <>
          <path d={g.body} fill={body} />
          {/* A language mark REPLACES the kind's own, so the fold and band come
              from the KIND with the mark swapped in - not both marks on one
              page. `koBand` is ko without its mark, stated by the emitter. */}
          <path d={mark ? `${g.koBand} ${mark.ko}` : g.ko} fill={bg} />
        </>
      )}
      {/* `hi` is the knockout INSIDE the mark, painted back in the ink. The
          coloured branch draws its own inside the mask; the ARTWORK branch has
          no mark at all - its splat is part of the picture - and drawing the
          old comic mark's knockout over it put a white star through the middle
          of the splat. */}
      {!colour && !artwork && hiPath ? <path d={hiPath} fill={body} /> : null}
      {label ? (
        <text
          x={L.x}
          y={L.y}
          // Keyed by CHARACTER COUNT, not scaled: two and three characters keep
          // the full size and only WEBM-length ones step down, which is what
          // stops a long extension running out of the band.
          fontSize={L.sizes[Math.min(label.length, 6) as keyof typeof L.sizes]}
          // THE LABEL FLIPS WITH THE BAND. Monochrome sets it in the ink inside
          // a band painted in the row's background; coloured sets it in `text`
          // inside a coloured band. Leave it on the ink for both and the
          // coloured icons get ink on ink.
          fill={colour || artwork ? c.text : color}
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
            // A cut row is half gone already, and looks it (Explorer's cue).
            opacity: t.cut.has(path.toLowerCase()) ? 0.45 : undefined,
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

/** The folder a path sits in. A FILE row is a drop target for its own
 *  folder: dropping onto a file means dropping beside it, which is what
 *  every file manager does and what the tree did not do - the drop fell
 *  through to the window, which opens whatever it is handed, so dropping a
 *  FOLDER there re-rooted the tab instead of moving anything. */
const dirOf = (p: string): string =>
  p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')))

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
              data-dropdir={dirOf(f.path)}
              data-selected={onSel || undefined}
              draggable
              onDragStart={(e) => t.onRowDragStart(e, f.path)}
              onDragEnd={() => t.onDragDone()}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                // The FOLDER lights up, not the file: the file is where the
                // pointer is, its folder is where the thing will land.
                t.onDropHover(dirOf(f.path))
              }}
              onDragLeave={() => t.onDropHover(null)}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                t.onDropOn(e, dirOf(f.path))
              }}
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
                // A cut row is half gone already, and looks it (Explorer's cue).
                opacity: t.cut.has(f.path.toLowerCase()) ? 0.45 : undefined,
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
                selected={onSel}
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
