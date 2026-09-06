import { useEffect, useState, type JSX } from 'react'
import type { DirListing, ViewerFile } from '@shared/types'
import { crumbs, parentOf, stepFile } from './browse'
import { PhoneViewer } from './PhoneViewer'

/**
 * One folder at a time, Explorer-shaped (2026-09-06, #104): folders first,
 * then the files Prism can show, tapped to open. The listing is the very
 * one the sidebar gets (`/api/dir` answers with `dir:list`'s output), so the
 * order is the tab's default and a file the PC hides is hidden here too.
 * The viewer takes the whole screen and pages the folder's files with its
 * own next/previous, the way Up/Down page the folder on the PC.
 */
export function Browser({ root }: { root: string }): JSX.Element {
  const [dir, setDir] = useState(root)
  // Tagged with the folder it answers for, so walking into another folder
  // shows "Loading..." rather than the old rows, and an answer that arrives
  // late for a folder already left is ignored rather than shown.
  const [loaded, setLoaded] = useState<{ dir: string; listing: DirListing | null } | null>(null)
  const [open, setOpen] = useState<ViewerFile | null>(null)

  useEffect(() => {
    let live = true
    void window.prism.listDir(root, dir).then((l) => {
      if (live) setLoaded({ dir, listing: l })
    })
    return () => {
      live = false
    }
  }, [root, dir])

  const listing = loaded?.dir === dir ? loaded.listing : undefined
  const error = listing === null ? 'Prism could not read this folder' : null
  const files = listing?.files ?? []
  const step = (d: 1 | -1): void => {
    if (!open) return
    const next = stepFile(files, open.path, d)
    if (next) setOpen(next)
  }

  if (open) {
    return (
      <PhoneViewer
        file={open}
        onClose={() => setOpen(null)}
        onStep={step}
        canStep={(d) => !!stepFile(files, open.path, d)}
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
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-[color:var(--p-line)] bg-[var(--p-bg)] px-2 pt-[env(safe-area-inset-top)]">
        <button
          className="grid h-11 w-10 shrink-0 place-items-center rounded disabled:opacity-30"
          aria-label="Up"
          disabled={up === null}
          onClick={() => up !== null && setDir(up)}
        >
          <svg
            viewBox="0 0 24 24"
            width={18}
            height={18}
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
          className="flex h-11 min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm"
          aria-label="Folder"
        >
          {trail.map((c, i) => {
            const last = i === trail.length - 1
            return (
              <span key={c.path} className="flex shrink-0 items-center gap-1">
                <button
                  className={`rounded px-1 py-1 ${last ? 'font-semibold' : 'opacity-70'}`}
                  aria-current={last ? 'location' : undefined}
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
      </header>
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
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-[var(--p-hover)]"
                onClick={() => setDir(f.path)}
                data-phone-folder
              >
                {/* The sidebar's own folder silhouette (TreeRows.FolderIcon),
                    inlined rather than imported: TreeRows carries the whole
                    tree, its drag and its selection into any bundle that
                    imports it. */}
                <svg
                  viewBox="0 0 24 24"
                  width={18}
                  height={18}
                  fill="var(--p-tree-folder)"
                  className="shrink-0"
                  aria-hidden
                >
                  <path d="M2.5 5.5h6.2l2 2.6h10.8v10.4H2.5z" />
                </svg>
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
          {listing.files.map((f) => (
            <li key={f.path}>
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-[var(--p-hover)]"
                onClick={() => setOpen(f)}
                data-phone-file
                data-kind={f.kind}
              >
                <span
                  className="w-9 shrink-0 text-center text-[10px] uppercase tracking-wide opacity-60"
                  aria-hidden
                >
                  {f.ext.slice(1, 5)}
                </span>
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
          {listing.unreadable && <li className="p-4 opacity-70">Prism could not read this folder.</li>}
          {!listing.unreadable && listing.folders.length === 0 && listing.files.length === 0 && (
            <li className="p-4 opacity-70">Nothing Prism can show here.</li>
          )}
        </ul>
      )}
    </div>
  )
}
