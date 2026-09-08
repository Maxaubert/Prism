import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react'
import type { DirListing, SearchHit, ViewerFile } from '@shared/types'
import { crumbs, fileFromHit, parentOf, stepFile } from './browse'
import { narrowHits } from './narrow'
import { PhoneViewer } from './PhoneViewer'
import { ROW_CLASS } from './rows'
import { TabList } from './TabList'

/** The debounce the sidebar's own search box waits, so a phone typing at the
 *  same speed costs the PC the same number of walks. KEPT at 180ms rather
 *  than lowered (2026-09-08): what was slow was the blank list, not the walk
 *  - the rows narrow locally on the keystroke itself now, so the wait is
 *  confirmation rather than the first thing you see, and the PC pays for
 *  exactly the walks it paid for before. */
const DEBOUNCE_MS = 180

/** How long a superseded walk is left alone before asking again, and how many
 *  times. A walk is superseded when somebody else's search bumped the ticket
 *  (the PC's own sidebar, or a second phone), so its empty answer is not
 *  "nothing matches" and must not be drawn as one. Asking again is right;
 *  asking for ever is two clients cancelling each other, so it gives up and
 *  leaves the rows it has rather than emptying the screen. */
const RETRY_MS = 200
const RETRIES = 3

/**
 * One folder at a time, Explorer-shaped (2026-09-06, #104): folders first,
 * then the files Prism can show, tapped to open. The listing is the very
 * one the sidebar gets (`/api/dir` answers with `dir:list`'s output), so the
 * order is the tab's default and a file the PC hides is hidden here too.
 * The viewer takes the whole screen and pages the folder's files with its
 * own next/previous, the way Up/Down page the folder on the PC.
 *
 * ONE SCREEN (2026-09-07, #107): this is it. The explorer is always the
 * shell and a file always opens into `PhoneViewer`. What the phone does NOT
 * do is drive the PC (owner, 2026-09-08, after using it): a Watch / Remote
 * pair of modes was built, then reworked into a per-film "This phone / This
 * PC" target, and then removed root and branch. The phone plays what it
 * opens, and that is the whole shape of it.
 *
 * AND IT SEARCHES (2026-09-07, owner ask). The magnifier opens a field over
 * the crumb row, and while it holds a query the results ARE the list: the
 * whole root, subfolders included, which is the only way to reach a file
 * more than a tap or two down on a phone that browses one level at a time.
 * The GRAMMAR IS THE DESKTOP'S - every word in any order, "a phrase", globs,
 * `ext:` and `-exclusions` - because the field calls `searchTree`, which the
 * server answers with the same `searchFiles` the sidebar's box does. It is
 * taught in one place (`shared/searchQuery`) and there is nothing here that
 * could teach it differently.
 */
export function Browser({
  root,
  tab,
  onSwitch
}: {
  root: string
  /** The name of the tab this phone is on, as the PC spells it. */
  tab: string
  /** Move this phone to another of the PC's open tabs. Rejects with the PC's
   *  own reason when it does not hold that folder any more. */
  onSwitch: (root: string) => Promise<void>
}): JSX.Element {
  const [dir, setDir] = useState(root)
  // Tagged with the folder it answers for, so walking into another folder
  // shows "Loading..." rather than the old rows, and an answer that arrives
  // late for a folder already left is ignored rather than shown.
  const [loaded, setLoaded] = useState<{ dir: string; listing: DirListing | null } | null>(null)
  const [open, setOpen] = useState<ViewerFile | null>(null)
  /** Whether the field is showing; the query is what decides what is listed. */
  const [searching, setSearching] = useState(false)
  /** Whether the tab list is showing over the folder. */
  const [tabsOpen, setTabsOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Keyed by the query it answers, exactly as the sidebar's panel keys its
  // own, so a slow walk never draws under a newer search.
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; truncated: boolean } | null>(
    null
  )
  /** The query whose ask has FINISHED, which is not the same as the query
   *  that has an answer: a walk superseded past its retries finishes without
   *  one, and an indicator that never stops is a page that looks stuck. It is
   *  written only when an ask lands, so nothing here sets state while an
   *  effect runs. */
  const [settled, setSettled] = useState<string | null>(null)
  // Cleared on the way IN to a new query rather than in an effect (the shape
  // the players use for a new file): backspacing to a query that was answered
  // a moment ago starts a fresh walk, and comparing to the query alone would
  // call that walk finished before it had been made.
  const [askFor, setAskFor] = useState(query)
  if (askFor !== query) {
    setAskFor(query)
    setSettled(null)
  }

  useEffect(() => {
    let live = true
    void window.prism.listDir(root, dir).then((l) => {
      if (live) setLoaded({ dir, listing: l })
    })
    return () => {
      live = false
    }
  }, [root, dir])

  // An emptied field leaves the last answer where it is rather than clearing
  // it: what is DRAWN is keyed by the query, so an old answer is already
  // invisible, and clearing it here would be a setState inside an effect for
  // no one's benefit. It is also what the next keystroke narrows from.
  useEffect(() => {
    if (!query) return
    let alive = true
    let tries = 0
    let t: ReturnType<typeof setTimeout>
    const ask = (): void => {
      void window.prism.searchTree(root, query).then((r) => {
        if (!alive) return
        // A SUPERSEDED walk is not an answer (2026-09-08): main stops a
        // cancelled walk where it stands and answers with no hits, which is
        // the same shape as "nothing matches" - and drawn as one it empties a
        // list that was right. Ask again instead, and past a few tries leave
        // the rows where they are rather than swapping them for a hole.
        if (r.superseded) {
          if (tries++ < RETRIES) {
            t = setTimeout(ask, RETRY_MS)
            return
          }
        } else {
          setFound({ q: query, hits: r.hits, truncated: r.truncated })
        }
        setSettled(query)
      })
    }
    t = setTimeout(ask, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [root, query])

  const listing = loaded?.dir === dir ? loaded.listing : undefined
  const error = listing === null ? 'Prism could not read this folder' : null
  const answer = found?.q === query ? found : null
  /** Whether a walk is still out for what the field holds. */
  const pending = !!query && settled !== query
  /**
   * The rows on screen: the PC's answer once it lands, and until then the
   * last answer NARROWED locally (see ./narrow). The list used to go blank
   * for the debounce plus a Wi-Fi round trip on every single keystroke, which
   * is what made a 73-357ms search feel slow (owner, 2026-09-08).
   */
  const rows = useMemo(
    () => (answer ? answer.hits : narrowHits(found, query)),
    [answer, found, query]
  )
  // What next/previous page while a file is open: the list it was opened
  // FROM. A hit lives anywhere under the root, so paging the folder's own
  // files would step to something you were not looking at, and for a hit
  // from another folder it would step to nothing at all.
  const files = useMemo(
    () =>
      query ? (rows ?? []).filter((h) => !h.isFolder).map(fileFromHit) : (listing?.files ?? []),
    [query, rows, listing]
  )
  const step = (d: 1 | -1): void => {
    if (!open) return
    const next = stepFile(files, open.path, d)
    if (next) setOpen(next)
  }

  // A markdown's link to a local file opens it if THIS folder lists it, and
  // is otherwise ignored (#106): the phone browses one level at a time and
  // has no tree to walk to a file elsewhere, and the server would refuse a
  // path outside the root regardless. Case-insensitive, as Windows paths are.
  const openLocal = (p: string): void => {
    const want = p.toLowerCase()
    const hit = (listing?.files ?? []).find((f) => f.path.toLowerCase() === want)
    if (hit) setOpen(hit)
  }

  /** A folder, whether it came from the listing or from a hit: walking there
   *  is what the tap means, so the search closes and the folder is the view. */
  const walkTo = (p: string): void => {
    setDir(p)
    setQuery('')
    setSearching(false)
  }

  if (open) {
    return (
      <PhoneViewer
        file={open}
        onClose={() => setOpen(null)}
        onStep={step}
        canStep={(d) => !!stepFile(files, open.path, d)}
        onOpenLocal={openLocal}
      />
    )
  }

  const up = parentOf(root, dir)
  const trail = crumbs(root, dir)
  return (
    <div
      className="flex min-h-dvh flex-col bg-[var(--p-bg)] text-[var(--p-text)]"
      data-phone-browser
    >
      <header className="sticky top-0 z-10 flex flex-col border-b border-[color:var(--p-line)] bg-[var(--p-bg)] pt-[env(safe-area-inset-top)]">
        {/* WHICH TAB, on its own row above where-you-are (2026-09-08, owner:
            "i should be able to see the available tabs and switch"). Its own
            row rather than another control squeezed in beside the crumbs,
            because the two say different things: this one is the folder the
            PC has open, the row under it is where in that folder you are. */}
        <button
          className="flex min-h-[var(--phone-touch)] w-full items-center gap-2 px-3 text-left text-[15px] font-semibold active:bg-[var(--p-hover)]"
          onClick={() => setTabsOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={tabsOpen}
          data-phone-tab
        >
          <TabsIcon />
          <span className="min-w-0 flex-1 truncate">{tab}</span>
          <ChevronDown />
        </button>
        <div className="flex items-center gap-1 px-2">
          {searching ? (
            <>
              <span
                className="grid h-[var(--phone-touch)] w-[var(--phone-touch)] shrink-0 place-items-center opacity-60"
                aria-hidden
              >
                <MagnifierIcon />
              </span>
              <input
                className="min-h-[var(--phone-touch)] min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:opacity-50"
                // The phone's own keyboard is the thing to get right here: a
                // search field spells its return key "Search" and neither
                // corrects nor capitalises what is typed into it, because a
                // file name is not prose.
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                aria-label="Search this folder"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-phone-search
              />
              <button
                className="grid h-[var(--phone-touch)] w-[var(--phone-touch)] shrink-0 place-items-center rounded"
                // One X, two steps, which is how a phone's search field behaves
                // everywhere: it empties a field that holds something, and
                // closes an empty one, so clearing lands you back in the folder
                // you were in rather than taking the field away mid-thought.
                aria-label={query ? 'Clear search' : 'Close search'}
                onClick={() => (query ? setQuery('') : setSearching(false))}
                data-phone-search-clear
              >
                <svg
                  viewBox="0 0 24 24"
                  width={22}
                  height={22}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button
                className="grid h-[var(--phone-touch)] w-[var(--phone-touch)] shrink-0 place-items-center rounded disabled:opacity-30"
                aria-label="Up"
                disabled={up === null}
                onClick={() => up !== null && setDir(up)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width={22}
                  height={22}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <nav
                className="flex min-h-[var(--phone-touch)] min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-[15px]"
                aria-label="Folder"
              >
                {trail.map((c, i) => {
                  const last = i === trail.length - 1
                  return (
                    <span key={c.path} className="flex shrink-0 items-center gap-1">
                      <button
                        className={`rounded px-2 py-2 ${last ? 'font-semibold' : 'opacity-70'}`}
                        aria-current={last ? 'location' : undefined}
                        data-phone-root={i === 0 ? '' : undefined}
                        onClick={() => setDir(c.path)}
                      >
                        {c.name}
                      </button>
                      {/* A chevron at EVERY level, the current one included: that is
                        what makes the row read as a path rather than a sentence
                        (the archive's crumb row, 2026-08-31). */}
                      <span className="opacity-40" aria-hidden>
                        &rsaquo;
                      </span>
                    </span>
                  )
                })}
              </nav>
              <button
                className="grid h-[var(--phone-touch)] w-[var(--phone-touch)] shrink-0 place-items-center rounded"
                aria-label="Search"
                onClick={() => setSearching(true)}
                data-phone-search-open
              >
                <MagnifierIcon />
              </button>
            </>
          )}
          {/* A search is still running. It sits on the header's own bottom edge
            rather than in the list, because the list is showing rows - the
            last answer, narrowed - and a line that pushed them down would be
            the layout shift the narrowing exists to avoid. The keyframe is in
            phone.css and applied inline, so no selector here can go stale. */}
          {pending && (
            <span
              className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
              data-phone-searching
              aria-hidden
            >
              <span
                className="absolute inset-y-0 w-2/5 bg-[var(--color-accent-hi)]"
                style={{ animation: 'phone-searching 1.1s ease-in-out infinite' }}
              />
            </span>
          )}
        </div>
      </header>
      {tabsOpen && (
        <Sheet title="Open tabs" onClose={() => setTabsOpen(false)}>
          {/* The sheet closes on a pick that WORKED; a refused one leaves it
              open with the reason and a list that has been read again. */}
          <TabList onPick={(r) => onSwitch(r).then(() => setTabsOpen(false))} />
        </Sheet>
      )}
      {query ? (
        <Results
          hits={rows}
          // The count belongs to the ANSWER: "more than 200 matches" under a
          // locally narrowed list would be a number about a search that has
          // not happened yet.
          truncated={!!answer?.truncated}
          pending={pending}
          onOpen={(h) => (h.isFolder ? walkTo(h.path) : setOpen(fileFromHit(h)))}
        />
      ) : (
        <>
          {error && (
            <p className="p-4 text-red-400" data-phone-error>
              {error}
            </p>
          )}
          {listing === undefined && <p className="p-4 opacity-70">Loading...</p>}
          {listing && (
            <ul className="flex flex-col pb-[env(safe-area-inset-bottom)]" role="list">
              {listing.folders.map((f) => (
                <li key={f.path}>
                  <button className={ROW_CLASS} onClick={() => setDir(f.path)} data-phone-folder>
                    <FolderGlyph />
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))}
              {listing.files.map((f) => (
                <li key={f.path}>
                  <button
                    className={ROW_CLASS}
                    onClick={() => setOpen(f)}
                    data-phone-file
                    data-kind={f.kind}
                  >
                    <ExtChip ext={f.ext} />
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))}
              {listing.unreadable && (
                <li className="p-4 opacity-70">Prism could not read this folder.</li>
              )}
              {!listing.unreadable &&
                listing.folders.length === 0 &&
                listing.files.length === 0 && (
                  <li className="p-4 opacity-70">Nothing Prism can show here.</li>
                )}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** What the sidebar's panel draws, phone-sized: the name, and under it the
 *  folder the file is in, which is the only thing telling two files of the
 *  same name apart. A hit that is a FOLDER walks there instead of opening.
 *
 *  The rows may be a PREVIEW while `pending` is set (the last answer, narrowed
 *  locally): they are drawn exactly the same, because they are the same rows
 *  and tapping one does the same thing. What says a search is running is the
 *  line on the header, not a different-looking list. */
function Results({
  hits,
  truncated,
  pending,
  onOpen
}: {
  hits: SearchHit[] | null
  truncated: boolean
  pending: boolean
  onOpen: (hit: SearchHit) => void
}): JSX.Element {
  // Nothing to preview and nothing answered: the first query of a session,
  // which is the only time the phone has no rows of its own to narrow.
  if (!hits) return <p className="p-4 opacity-70">Searching...</p>
  if (!hits.length) return <p className="p-4 opacity-70">Nothing matches.</p>
  return (
    <ul className="flex flex-col pb-[env(safe-area-inset-bottom)]" role="list" aria-busy={pending}>
      {hits.map((h) => (
        <li key={h.path}>
          <button
            className={ROW_CLASS}
            onClick={() => onOpen(h)}
            data-phone-hit
            data-kind={h.isFolder ? 'folder' : h.kind}
          >
            {h.isFolder ? <FolderGlyph /> : <ExtChip ext={extOf(h.name)} />}
            <span className="min-w-0">
              <span className="block truncate">{h.name}</span>
              {h.dir && <span className="block truncate text-[13px] opacity-60">{h.dir}</span>}
            </span>
          </button>
        </li>
      ))}
      {truncated && (
        <li className="p-4 text-[13px] opacity-60">more than {hits.length} matches; keep typing</li>
      )}
    </ul>
  )
}

/**
 * A screen over the folder, which on a phone is what a menu is: a list read
 * with a thumb needs the width and the room, and a popover anchored to a
 * header button on a 390px screen is neither.
 */
function Sheet({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-20 flex flex-col bg-[var(--p-bg)] pt-[env(safe-area-inset-top)] text-[var(--p-text)]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-phone-sheet
    >
      <div className="flex items-center gap-1 border-b border-[color:var(--p-line)] px-2">
        <h2 className="min-w-0 flex-1 truncate px-2 text-[15px] font-semibold">{title}</h2>
        <button
          className="grid h-[var(--phone-touch)] w-[var(--phone-touch)] shrink-0 place-items-center rounded"
          aria-label="Close"
          onClick={onClose}
          data-phone-sheet-close
        >
          <svg
            viewBox="0 0 24 24"
            width={22}
            height={22}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">{children}</div>
    </div>
  )
}

/** A hit carries a name, not an extension; the chip wants one. */
const extOf = (name: string): string => /\.[^.]*$/.exec(name)?.[0] ?? ''

/** The sidebar's own folder silhouette (TreeRows.FolderIcon), inlined rather
 *  than imported: TreeRows carries the whole tree, its drag and its selection
 *  into any bundle that imports it. */
function FolderGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="var(--p-tree-folder)"
      className="shrink-0"
      aria-hidden
    >
      <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
    </svg>
  )
}

function ExtChip({ ext }: { ext: string }): JSX.Element {
  return (
    <span
      className="w-11 shrink-0 text-center text-[11px] uppercase tracking-wide opacity-60"
      aria-hidden
    >
      {ext.slice(1, 5)}
    </span>
  )
}

/** Two folders one behind the other: what the PC has open, which is what a
 *  tab is here. */
function TabsIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      className="shrink-0 opacity-70"
      aria-hidden
    >
      <path d="M7 4.5h4l1.4 1.8H20v9.2H7z" />
      <path d="M4 7.5v12h13" />
    </svg>
  )
}

function ChevronDown(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-60"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function MagnifierIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
    </svg>
  )
}
