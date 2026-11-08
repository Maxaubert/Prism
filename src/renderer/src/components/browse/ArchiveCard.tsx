import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { memberOf, placeOf, type ArchiveSummary } from '@shared/archivePlace'
import { formatBytes, formatWhen } from '../../lib/format'
import { FolderIcon, KindIcon, iconColour } from '../icons/FileIcons'
import { FileMenuIcon } from '../icons/FileMenuIcon'
import { BrowseIcon } from '../icons/BrowseIcon'
import { fileKind } from '@shared/fileKind'
import { extOf, pathKey } from '@shared/path'
import { DRAG_MIME, ownDrop, setDrag, windowsDrag, type DragPayload } from '../../lib/drag/dragDrop'
import { noteReady } from '../../lib/drag/dragOut'
import { archiveTarget, dropVerb, effectOf, type DropKeys } from '../../lib/drag/dropVerb'
import { clearLanded, useLandRequest } from '../../lib/landMarks'
import { keysOf, seenOf } from './useFolderDrop'
import { isElement, isNode, listenOn, useViewerWindows } from '../../lib/ownWindow'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import type { ArchiveCardCopy, ArchiveCardMenu } from './useArchiveActions'
import {
  CARD_CHORDS,
  NO_PICK,
  cardCaption,
  cardCargo,
  cardDropKeys,
  cardGoesInto,
  cardUp,
  landedRows,
  pickForMenu,
  pickRow,
  stepPick,
  type CardPick
} from './archiveCardNav'
import './archive.css'

type Row = { name: string; dir: boolean; size: number }

/** Where each zip's card was last, for the session: a file opened from the
 *  card comes back to the card where it was (#483). */
const lastPlace = new Map<string, string>()

/**
 * THE ARCHIVE CARD (#300, mockup 01): what the preview pane shows for an
 * archive's row outside it, in place of the old panel. Its name and totals,
 * the neutral Open / Extract here / Extract to..., what is inside ("Inside,
 * in <the one top folder>" when that is all there is), with Unpacked and
 * Modified at the foot. Drawn from one `archive:summary`, which main answers
 * from the parse it keeps, so selecting a zip is instant.
 *
 * THE ROWS ARE A SMALL BROWSER THAT STAYS IN THE PREVIEW (#483; owner,
 * 2026-11-06: "i wanna use it while its in the preview, select files drag
 * them into the main view to extract and so on"). The Explorer never moves for
 * a click here. A click selects (Ctrl toggles, Shift ranges, the arrows walk);
 * a double-click or Enter goes into a folder, or a zip inside the zip, IN the
 * card (Up and Backspace come back), and opens a file in the viewer with the
 * Explorer left where it was. Selected rows carry as the zip's MEMBERS: onto
 * the list or a folder row they are extracted there (#70's drop, its landing
 * marks), never moved inside their own zip (`payload.card`). A right-click
 * has the zip's member verbs (`menus/archiveCardMenu.ts`).
 *
 * A DROP ONTO THE CARD ADDS TO THE ZIP (#483; owner, 2026-11-06: "i then
 * dragged it back in then it opened the zip in full view"): files from the
 * list or from Windows dropped on its rows go into the zip where the card is,
 * onto a folder row into that folder, by #70's rule with a COPY for a plain
 * drag (`cardDropKeys`); what landed is marked in the card. The card takes
 * every drop over it, so nothing falls through to the window, which opens
 * what is dropped on the viewer. Its own members, a read-only archive or the
 * zip itself: no-drop, quietly.
 *
 * THE CARD IS IN USE OR NOT (#483; owner, same day: "it should dim, still
 * highlighted but dimmed"): a press or the focus anywhere else dims its
 * picked rows to the list's inactive selection and hands the keyboard back
 * (the focus leaves the card's list), so Ctrl+A, C and V are the list's
 * again; a press in the card brings the full look back.
 */
export function ArchiveCard({
  path,
  name,
  mtimeMs,
  onOpen,
  onExtractHere,
  onExtractTo,
  onOpenMember,
  menu,
  onCopyMembers,
  onDropInto,
  refreshKey
}: {
  path: string
  name: string
  mtimeMs?: number
  onOpen: () => void
  onExtractHere: () => void
  onExtractTo: () => void
  /** A double-clicked file (#483): the member opens in the viewer, the
   *  Explorer staying where it is. */
  onOpenMember?: (place: string) => void
  /** The right-click's rows for the picked rows (#483). */
  menu?: ArchiveCardMenu
  /** Ctrl+C on the picked rows (#483): the zip's own member Copy. */
  onCopyMembers?: ArchiveCardCopy
  /** A drop onto the card (#483): the Explorer's own drop into a place,
   *  here a place inside the zip. */
  onDropInto?: (directory: string, payload: DragPayload, keys: DropKeys) => void
  /** Prism wrote somewhere: the card reads the zip again. */
  refreshKey?: number
}): JSX.Element {
  const [summary, setSummary] = useState<{ path: string; got: ArchiveSummary } | null>(null)
  useEffect(() => {
    let live = true
    void window.prism
      .archiveSummary(path)
      .then((got) => live && setSummary({ path, got }))
      .catch(() => live && setSummary({ path, got: { ok: false, reason: 'failed' } }))
    return () => {
      live = false
    }
  }, [path, refreshKey])
  const got = summary?.path === path ? summary.got : null
  const meta = got?.ok ? got.meta : null
  const facts = meta
    ? [
        `${meta.files} ${meta.files === 1 ? 'file' : 'files'}`,
        meta.folders ? `${meta.folders} ${meta.folders === 1 ? 'folder' : 'folders'}` : '',
        `${formatBytes(meta.packed)} compressed`
      ]
        .filter(Boolean)
        .join(', ')
    : got && !got.ok
      ? got.reason === 'password' || got.reason === 'aes'
        ? 'Password protected'
        : "This archive can't be read. It may be damaged or incomplete."
      : ''

  // WHERE THE CARD IS: the summary's own place (inside a lone top folder)
  // until the user goes somewhere, then that place, remembered per zip.
  const [moved, setMoved] = useState<{ zip: string; here: string } | null>(() => {
    const was = lastPlace.get(pathKey(path))
    return was ? { zip: path, here: was } : null
  })
  const start = got?.ok ? (got.top ? placeOf(path, got.top) : path) : path
  const here = moved && moved.zip === path ? moved.here : (lastPlace.get(pathKey(path)) ?? start)
  const atStart = pathKey(here) === pathKey(start)
  const [level, setLevel] = useState<{ here: string; got: ArchiveSummary } | null>(null)
  const wantLevel = !!got?.ok && !atStart
  useEffect(() => {
    if (!wantLevel) return
    let live = true
    void window.prism
      .archiveSummary(here, true)
      .then((answer) => {
        if (!live) return
        // The folder is gone from the zip (or unreadable): back to the start.
        if (!answer.ok) {
          lastPlace.delete(pathKey(path))
          setMoved({ zip: path, here: start })
        } else setLevel({ here, got: answer })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [wantLevel, here, path, start, refreshKey])
  const view = !got?.ok ? null : atStart ? got : level?.here === here && level.got.ok ? level.got : null
  const rows: Row[] = view?.ok ? view.rows : []
  const order = rows.map((r) => r.name)
  const placeMeta = view?.ok ? view.meta : null

  const [picked, setPicked] = useState<{ here: string; pick: CardPick }>({ here, pick: NO_PICK })
  const pick = picked.here === here ? picked.pick : NO_PICK
  const marks = new Set(pick.marked)
  const setPick = (next: CardPick): void => setPicked({ here, pick: next })
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; at: EventTarget; items: MenuItem[] } | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)

  // IN USE OR NOT: the card is in use while the keyboard is in its rows, so
  // the look and the keys always agree (a press on the card's bare parts
  // hands the keyboard to its rows, below; its verbs act on the whole zip and
  // leave it dimmed). Anywhere else (a menu aside) dims it, and a press
  // elsewhere takes the keyboard out of the card, so the list's keys are the
  // list's again.
  const [inUse, setInUse] = useState(false)
  // The card's own window as well as the Explorer's: the preview window draws
  // it in another, whose presses and focus never reach this page's document
  // (`lib/ownWindow.ts`, 2026-11-08). Element tests that work across windows.
  const wins = useViewerWindows(root)
  useEffect(() => {
    const heard = (event: Event): void => {
      const target = event.target
      if (!isElement(target) || target.closest('[role="menu"]')) return
      if (event.type === 'focusin') {
        setInUse(!!list.current?.contains(target))
        return
      }
      if (root.current?.contains(target)) return
      setInUse(false)
      const focused = root.current?.ownerDocument.activeElement
      if (isElement(focused) && root.current?.contains(focused)) (focused as HTMLElement).blur()
    }
    const docs = wins.map((w) => w.document)
    for (const d of docs) {
      d.addEventListener('pointerdown', heard, true)
      d.addEventListener('focusin', heard, true)
    }
    return () => {
      for (const d of docs) {
        d.removeEventListener('pointerdown', heard, true)
        d.removeEventListener('focusin', heard, true)
      }
    }
  }, [wins])

  // WHAT LANDED IN THE CARD'S PLACE is marked there, as the list marks it.
  // (FolderBrowser's shape: the work is mirrored after render and run by the
  // effect, once the rows the request names have arrived.)
  const land = useLandRequest()
  const orderKey = order.join('\n')
  const landApply = useRef<() => void>(() => {})
  useLayoutEffect(() => {
    landApply.current = () => {
      if (!land || pathKey(land.dir) !== pathKey(here)) return
      const names = landedRows(order, here, land.paths)
      if (!names.length || names.length < land.paths.length) return
      clearLanded(land.seq)
      setPicked({ here, pick: { marked: names, anchor: names[0], cursor: names[0] } })
      list.current
        ?.querySelector<HTMLElement>(`[data-archive-row="${CSS.escape(names[0])}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }
  })
  useEffect(() => landApply.current(), [land, here, orderKey])

  // THE DROP: onto the card's place, or a folder row's. `row` is the row
  // under the pointer, so a row refuses itself.
  const [dropOn, setDropOn] = useState<string | null>(null)
  const dropAt = (dest: string, row?: string) => {
    const target = { dir: dest, archive: placeMeta ? archiveTarget(dest, placeMeta) : null, row }
    const verbOf = (payload: DragPayload | null, keys: DropKeys) =>
      onDropInto && placeMeta && target.archive ? dropVerb({ payload, target, keys: cardDropKeys(keys) }) : 'none'
    return {
      onDragOver: (e: DragEvent<HTMLElement>): void => {
        // Taken here whatever it is: a refusal must not reach the window.
        e.stopPropagation()
        const verb = verbOf(seenOf(e.dataTransfer), keysOf(e))
        e.dataTransfer.dropEffect = effectOf(verb, windowsDrag(e.dataTransfer))
        setDropOn(verb === 'none' ? null : dest)
        if (verb !== 'none') e.preventDefault()
      },
      onDragLeave: (e: DragEvent<HTMLElement>): void => {
        if (!isNode(e.relatedTarget) || !e.currentTarget.contains(e.relatedTarget)) setDropOn(null)
      },
      onDrop: (e: DragEvent<HTMLElement>): void => {
        e.preventDefault()
        e.stopPropagation()
        setDropOn(null)
        const payload = ownDrop(e.dataTransfer)
        setDrag(null)
        if (!payload || verbOf(payload, keysOf(e)) === 'none') return
        onDropInto?.(dest, payload, cardDropKeys(keysOf(e)))
      }
    }
  }
  useEffect(() => {
    const clear = (): void => setDropOn(null)
    const unEnd = listenOn(wins, 'dragend', clear, true)
    const unDrop = listenOn(wins, 'drop', clear, true)
    return () => {
      unEnd()
      unDrop()
    }
  }, [wins])

  /** Go to a place inside the zip, in the card. */
  const go = (to: string): void => {
    lastPlace.set(pathKey(path), to)
    setMoved({ zip: path, here: to })
    list.current?.focus({ preventScroll: true })
  }
  const up = cardUp(path, here)
  // A new place starts at its top.
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0
  }, [here])

  const placeOfRow = (n: string): string => placeOf(here, n)
  const activate = (row: Row): void => {
    if (cardGoesInto(row)) go(placeOfRow(row.name))
    else onOpenMember?.(placeOfRow(row.name))
  }
  /** The members `names` are, for a drag or a verb. */
  const cargoOf = (names: string[]): { archive: string; entries: string[]; places: string[] } | null => {
    if (!placeMeta) return null
    const entries: string[] = []
    const places: string[] = []
    for (const n of names) {
      const p = placeOfRow(n)
      const inner = memberOf(placeMeta, p)
      if (!inner) continue
      entries.push(inner)
      places.push(p)
    }
    return entries.length ? { archive: placeMeta.container, entries, places } : null
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const claim = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }
    // THE CARD'S CHORDS (#483): they act on its picked rows, never on the
    // zip behind it (`useAppKeys` leaves them here). Ctrl+A picks every row,
    // Ctrl+C copies the members, Ctrl+X and Ctrl+V do nothing in a zip.
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && CARD_CHORDS.has(e.key.toLowerCase())) {
      claim()
      const key = e.key.toLowerCase()
      if (key === 'a' && order.length)
        setPick({ marked: order, anchor: order[0], cursor: pick.cursor ?? order[0] })
      else if (key === 'c' && onCopyMembers && placeMeta && pick.marked.length) {
        const byName = new Map(rows.map((r) => [r.name, r]))
        const paths = pick.marked.map(placeOfRow)
        const folders = new Set(pick.marked.filter((n) => byName.get(n)?.dir).map(placeOfRow))
        onCopyMembers(paths, placeMeta, folders)
      }
      return
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      claim()
      const next = stepPick(order, pick, e.key === 'ArrowDown' ? 1 : -1, e.shiftKey)
      setPick(next)
      const el = next.cursor
        ? list.current?.querySelector<HTMLElement>(`[data-archive-row="${CSS.escape(next.cursor)}"]`)
        : null
      el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      claim()
      const row = pick.marked.length === 1 ? rows.find((r) => r.name === pick.marked[0]) : null
      if (row) activate(row)
    } else if (e.key === 'Backspace') {
      claim()
      if (up) go(up)
    }
  }

  const openMenu = (e: MouseEvent, row: Row): void => {
    e.preventDefault()
    e.stopPropagation()
    if (!menu || !placeMeta) return
    const next = pickForMenu(pick, row.name)
    setPick(next)
    const names = next.marked
    const byName = new Map(rows.map((r) => [r.name, r]))
    const paths = names.map(placeOfRow)
    const folders = new Set(names.filter((n) => byName.get(n)?.dir).map(placeOfRow))
    const items = menu({ paths, folders }, placeMeta, (p) => {
      const r = byName.get(names.find((n) => placeOfRow(n) === p) ?? '')
      if (r) activate(r)
    })
    if (items.length) setMenuAt({ x: e.clientX, y: e.clientY, at: e.currentTarget, items })
  }

  return (
    <div
      ref={root}
      className="archive-card"
      data-archive-card
      // Nothing dropped on the card falls through to the window (which opens
      // what is dropped on the viewer); its rows say what they take.
      onDragOver={(e) => {
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'none'
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDrag(null)
      }}
      // A press on the card's bare parts (its head, caption, facts) makes it
      // the one in use: the keyboard goes to its rows, not to nowhere.
      onMouseDown={(e) => {
        const target = e.target
        if (!list.current || !isElement(target) || target.closest('button, [data-archive-card-rows], [role="menu"]')) return
        e.preventDefault()
        list.current.focus({ preventScroll: true })
      }}
    >
      <div className="archive-card-head">
        <KindIcon kind="archive" ext={extOf(name)} name={name} color="var(--p-tree-zip)" size={48} bg="var(--p-bg)" />
        <div className="min-w-0">
          <h2>{name}</h2>
          <p>{facts}</p>
        </div>
      </div>
      <div className="archive-card-verbs">
        <button className="browse-archive-button" onClick={onOpen} data-archive-verb="open">
          <FileMenuIcon name="open" />
          Open
        </button>
        <button className="browse-archive-button" onClick={onExtractHere} data-archive-verb="extract-here">
          <FileMenuIcon name="extract" />
          Extract here
        </button>
        <button className="browse-archive-button" onClick={onExtractTo} data-archive-verb="extract-to">
          <FileMenuIcon name="extract" />
          Extract to...
        </button>
      </div>
      {got?.ok && (
        <>
          <div className="archive-card-caption">
            {up && (
              <button
                type="button"
                className="archive-card-up"
                data-archive-up
                title="Up (Backspace)"
                aria-label="Up"
                onClick={() => go(up)}
              >
                <BrowseIcon name="up" />
              </button>
            )}
            <span>{cardCaption(path, here)}</span>
          </div>
          <div
            ref={list}
            className="archive-card-rows"
            role="listbox"
            aria-multiselectable
            aria-label={cardCaption(path, here)}
            tabIndex={0}
            data-archive-card-rows
            data-inactive={!inUse || undefined}
            data-drag-over={dropOn === here || undefined}
            onKeyDown={onKeyDown}
            {...dropAt(here)}
          >
            {rows.map((row, i) => {
              const selected = marks.has(row.name)
              const kind = fileKind(extOf(row.name), row.name)
              // A run of selected rows is one block, the list's look (browse.css).
              const joinUp = selected && i > 0 && marks.has(rows[i - 1].name)
              const joinDown = selected && i + 1 < rows.length && marks.has(rows[i + 1].name)
              const place = placeOfRow(row.name)
              // A folder row takes a drop into itself; any other row means
              // the card's place.
              const drop = row.dir ? dropAt(place, place) : dropAt(here, place)
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-selected={selected || undefined}
                  data-join-up={joinUp || undefined}
                  data-join-down={joinDown || undefined}
                  tabIndex={-1}
                  className="archive-card-row"
                  key={row.name}
                  data-archive-row={row.name}
                  data-drag-over={(row.dir && dropOn === place) || undefined}
                  {...drop}
                  draggable
                  onClick={(e) => setPick(pickRow(order, pick, row.name, { ctrl: e.ctrlKey, shift: e.shiftKey }))}
                  onDoubleClick={() => activate(row)}
                  onContextMenu={(e) => openMenu(e, row)}
                  onMouseDown={(e) => {
                    // The press readies the cargo for a hand-off to Windows at
                    // the window's edge (#103), as a list row inside a zip does.
                    if (e.button !== 0 || e.ctrlKey || e.shiftKey) return
                    const cargo = cargoOf(cardCargo(pick, row.name))
                    if (!cargo) return
                    const req = { kind: 'members' as const, ...cargo }
                    void window.prism
                      .dragPrepare(req)
                      .then((r) => noteReady(req, r.ok))
                      .catch(() => noteReady(req, false))
                  }}
                  onDragStart={(e: DragEvent<HTMLButtonElement>) => {
                    const names = cardCargo(pick, row.name)
                    if (!pick.marked.includes(row.name)) setPick(pickRow(order, pick, row.name, { ctrl: false, shift: false }))
                    const cargo = cargoOf(names)
                    if (!cargo) {
                      e.preventDefault()
                      return
                    }
                    setDrag({ kind: 'members', ...cargo, card: true })
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(DRAG_MIME, 'members')
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  {row.dir ? (
                    <FolderIcon color="var(--p-tree-folder)" />
                  ) : (
                    <KindIcon
                      kind={kind}
                      ext={extOf(row.name)}
                      name={row.name}
                      color={iconColour(kind)}
                      size={14}
                      bg={
                        selected ? (inUse ? 'var(--p-sel-tint-seen)' : 'var(--p-sel-tint-dim-seen)') : 'var(--p-bg)'
                      }
                    />
                  )}
                  <span>{row.name}</span>
                  <span>{row.dir ? '' : formatBytes(row.size)}</span>
                </button>
              )
            })}
            {!!view?.ok && view.more > 0 && <div className="archive-card-more">and {view.more} more</div>}
          </div>
          <dl className="archive-card-facts">
            <dt>Unpacked</dt>
            <dd>{formatBytes(got.meta.unpacked)}</dd>
            {!!mtimeMs && (
              <>
                <dt>Modified</dt>
                <dd>{formatWhen(mtimeMs)}</dd>
              </>
            )}
          </dl>
        </>
      )}
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} at={menuAt.at} items={menuAt.items} onClose={() => setMenuAt(null)} />}
    </div>
  )
}
