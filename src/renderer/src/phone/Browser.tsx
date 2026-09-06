import { useEffect, useState, type JSX } from 'react'
import type { DirListing, ViewerFile } from '@shared/types'
import { crumbs, parentOf, stepFile } from './browse'
import { PhoneViewer } from './PhoneViewer'
import { Remote } from './Remote'
import { readMode, writeMode, type PhoneMode } from './mode'

/**
 * One folder at a time, Explorer-shaped (2026-09-06, #104): folders first,
 * then the files Prism can show, tapped to open. The listing is the very
 * one the sidebar gets (`/api/dir` answers with `dir:list`'s output), so the
 * order is the tab's default and a file the PC hides is hidden here too.
 * The viewer takes the whole screen and pages the folder's files with its
 * own next/previous, the way Up/Down page the folder on the PC.
 *
 * WATCH OR REMOTE (#107): the segmented control in the header. In Remote
 * mode the phone IS the remote: the folder list goes, the viewer is
 * UNMOUNTED (a film the phone was watching stops, so the PC's clock is the
 * one clock on screen), and `Remote` draws the PC's state. The choice is
 * remembered (`prism.phone.mode`), so the phone on the sofa arm comes back
 * as a remote. Watch brings the folder back; a file is opened from there.
 */
export function Browser({ root }: { root: string }): JSX.Element {
  const [dir, setDir] = useState(root)
  // Tagged with the folder it answers for, so walking into another folder
  // shows "Loading..." rather than the old rows, and an answer that arrives
  // late for a folder already left is ignored rather than shown.
  const [loaded, setLoaded] = useState<{ dir: string; listing: DirListing | null } | null>(null)
  const [open, setOpen] = useState<ViewerFile | null>(null)
  const [mode, setMode] = useState<PhoneMode>(() => readMode(localStorage))
  const pickMode = (m: PhoneMode): void => {
    setMode(m)
    writeMode(localStorage, m)
    // Remote closes the file, structurally: nothing of the phone's own plays
    // while it is a remote, and Watch comes back to the folder.
    if (m === 'remote') setOpen(null)
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

  const listing = loaded?.dir === dir ? loaded.listing : undefined
  const error = listing === null ? 'Prism could not read this folder' : null
  const files = listing?.files ?? []
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
    const hit = files.find((f) => f.path.toLowerCase() === want)
    if (hit) setOpen(hit)
  }

  if (open && mode === 'watch') {
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
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b border-[color:var(--p-line)] bg-[var(--p-bg)] px-2 pt-[env(safe-area-inset-top)]">
        {mode === 'remote' && (
          <span
            className="flex h-11 min-w-0 flex-1 items-center px-2 text-sm opacity-70"
            data-phone-root
          >
            {trail[0]?.name}
          </span>
        )}
        {mode === 'watch' && (
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
        )}
        {mode === 'watch' && (
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
        )}
        <ModeSwitch mode={mode} onPick={pickMode} />
      </header>
      {mode === 'remote' && <Remote />}
      {mode === 'watch' && error && (
        <p className="p-4 text-red-400" data-phone-error>
          {error}
        </p>
      )}
      {mode === 'watch' && listing === undefined && <p className="p-4 opacity-70">Loading...</p>}
      {mode === 'watch' && listing && (
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
          {listing.unreadable && (
            <li className="p-4 opacity-70">Prism could not read this folder.</li>
          )}
          {!listing.unreadable && listing.folders.length === 0 && listing.files.length === 0 && (
            <li className="p-4 opacity-70">Nothing Prism can show here.</li>
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * Watch | Remote. A radio group rather than two buttons: the two are one
 * choice, and a screen reader says which is on. 36px tall inside the 44px
 * header row, the phone's own floor for a finger.
 */
function ModeSwitch({
  mode,
  onPick
}: {
  mode: PhoneMode
  onPick: (m: PhoneMode) => void
}): JSX.Element {
  const seg = (m: PhoneMode, label: string): JSX.Element => {
    const on = mode === m
    return (
      <button
        role="radio"
        aria-checked={on}
        data-phone-mode={m}
        className={`h-9 rounded-full px-3 text-sm ${on ? 'bg-[var(--p-accent)] text-white' : 'opacity-70'}`}
        onClick={() => onPick(m)}
      >
        {label}
      </button>
    )
  }
  return (
    <div
      role="radiogroup"
      aria-label="Mode"
      className="my-1 flex shrink-0 items-center rounded-full border border-[color:var(--p-line)] p-0.5"
    >
      {seg('watch', 'Watch')}
      {seg('remote', 'Remote')}
    </div>
  )
}
