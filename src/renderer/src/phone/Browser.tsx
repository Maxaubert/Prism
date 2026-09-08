import { useEffect, useMemo, useState, type JSX } from 'react'
import type { DirListing, SearchHit, ViewerFile } from '@shared/types'
import { crumbs, fileFromHit, parentOf, stepFile } from './browse'
import { PhoneViewer } from './PhoneViewer'

/** The debounce the sidebar's own search box waits, so a phone typing at the
 *  same speed costs the PC the same number of walks. */
const DEBOUNCE_MS = 180

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
export function Browser({ root }: { root: string }): JSX.Element {
  const [dir, setDir] = useState(root)
  // Tagged with the folder it answers for, so walking into another folder
  // shows "Loading..." rather than the old rows, and an answer that arrives
  // late for a folder already left is ignored rather than shown.
  const [loaded, setLoaded] = useState<{ dir: string; listing: DirListing | null } | null>(null)
  const [open, setOpen] = useState<ViewerFile | null>(null)
  /** Whether the field is showing; the query is what decides what is listed. */
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  // Keyed by the query it answers, exactly as the sidebar's panel keys its
  // own, so a slow walk never draws under a newer search.
  const [found, setFound] = useState<{ q: string; hits: SearchHit[]; truncated: boolean } | null>(
    null
  )

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
  // no one's benefit.
  useEffect(() => {
    let alive = true
    const t = query
      ? setTimeout(() => {
          void window.prism.searchTree(root, query).then((r) => {
            if (alive) setFound({ q: query, ...r })
          })
        }, DEBOUNCE_MS)
      : null
    return () => {
      alive = false
      if (t) clearTimeout(t)
    }
  }, [root, query])

  const listing = loaded?.dir === dir ? loaded.listing : undefined
  const error = listing === null ? 'Prism could not read this folder' : null
  const hits = found?.q === query ? found : null
  // What next/previous page while a file is open: the list it was opened
  // FROM. A hit lives anywhere under the root, so paging the folder's own
  // files would step to something you were not looking at, and for a hit
  // from another folder it would step to nothing at all.
  const files = useMemo(
    () =>
      query
        ? (hits?.hits ?? []).filter((h) => !h.isFolder).map(fileFromHit)
        : (listing?.files ?? []),
    [query, hits, listing]
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
  /**
   * The rows every list here wears (2026-09-08, owner, after an iPad: "the
   * rows in the file explorer are too small"). They are the thing being
   * pointed at all day, so they are the thing to size first: taller than the
   * 44px floor a button needs, because a LIST is scrolled past as well as
   * tapped, and the name is set at 17px, which is the size a phone's own
   * file list uses. The numbers live in phone.css, so the floor is one
   * number in one place rather than a Tailwind size per row.
   */
  const rowClass =
    'flex min-h-[var(--phone-row)] w-full items-center gap-3 px-4 py-2.5 text-left text-[17px] active:bg-[var(--p-hover)]'
  return (
    <div
      className="flex min-h-dvh flex-col bg-[var(--p-bg)] text-[var(--p-text)]"
      data-phone-browser
    >
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-[color:var(--p-line)] bg-[var(--p-bg)] px-2 pt-[env(safe-area-inset-top)]">
        {searching ? (
          <>
            <span className="grid h-[var(--phone-touch)] w-[var(--phone-touch)] shrink-0 place-items-center opacity-60" aria-hidden>
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
      </header>
      {query ? (
        <Results
          hits={hits}
          rowClass={rowClass}
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
                  <button className={rowClass} onClick={() => setDir(f.path)} data-phone-folder>
                    <FolderGlyph />
                    <span className="truncate">{f.name}</span>
                  </button>
                </li>
              ))}
              {listing.files.map((f) => (
                <li key={f.path}>
                  <button
                    className={rowClass}
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
 *  same name apart. A hit that is a FOLDER walks there instead of opening. */
function Results({
  hits,
  rowClass,
  onOpen
}: {
  hits: { hits: SearchHit[]; truncated: boolean } | null
  rowClass: string
  onOpen: (hit: SearchHit) => void
}): JSX.Element {
  if (!hits) return <p className="p-4 opacity-70">Searching...</p>
  if (!hits.hits.length) return <p className="p-4 opacity-70">Nothing matches.</p>
  return (
    <ul className="flex flex-col pb-[env(safe-area-inset-bottom)]" role="list">
      {hits.hits.map((h) => (
        <li key={h.path}>
          <button
            className={rowClass}
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
      {hits.truncated && (
        <li className="p-4 text-[13px] opacity-60">
          more than {hits.hits.length} matches; keep typing
        </li>
      )}
    </ul>
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
