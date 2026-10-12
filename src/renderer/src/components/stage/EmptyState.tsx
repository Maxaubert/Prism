import type { JSX } from 'react'

/**
 * The window with nothing in it at all.
 *
 * The first button is NEW TAB, not "Open file…" (owner pick, 2026-08-31).
 * Picking one file from a dialog is the narrowest way into an app whose whole
 * model is a tab rooted at a FOLDER you then browse: it left you with one
 * file and no obvious next move. New tab is instant and lands you somewhere
 * to look around, exactly as the + does, and the folder chooser is beside it
 * for when you know where you are going. Dropping a file still works and the
 * line above still says so.
 */
export function EmptyState({
  onNewTab,
  onOpenFolder
}: {
  onNewTab: () => void
  onOpenFolder: () => void
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      {/* A hairline and nothing else, so the window's own material carries
          through it. No backdrop-filter: inside a transparent window it has
          nothing behind to sample and composites as a solid fill, which is
          exactly the opaque tile this was meant to get rid of. */}
      <div className="grid h-[72px] w-[72px] place-items-center rounded-[20px] border border-[color:var(--p-line)] text-[var(--p-accent-hi)]">
        <svg
          viewBox="0 0 24 24"
          width={30}
          height={30}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M7 18a4 4 0 0 1 .6-8 5.2 5.2 0 0 1 10 1.2A3.4 3.4 0 0 1 17.5 18z" />
          <path d="M12 11v6m0 0l-2.2-2.2M12 17l2.2-2.2" />
        </svg>
      </div>
      <div className="text-lg font-semibold">Open a file or folder to view it</div>
      <div className="text-sm text-[var(--p-dim)]">Drop a file here, or</div>
      <div className="flex items-center gap-2">
        <button
          className="no-drag rounded-xl bg-[var(--p-accent)] px-4 py-2 text-sm font-semibold text-[var(--p-on-accent)] hover:brightness-110"
          onClick={onNewTab}
        >
          New tab
        </button>
        <button
          className="no-drag rounded-xl border border-[color:var(--p-line)] px-4 py-2 text-sm font-semibold text-[var(--p-text)] transition-colors hover:border-[color:var(--p-accent-hi)]"
          onClick={onOpenFolder}
        >
          Open folder…
        </button>
      </div>
    </div>
  )
}

/** A tab with a root but nothing on screen yet (a terminal-first tab whose
 *  terminal was tucked away): quiet words, not the open-file pitch. The way
 *  in is the sidebar this tab already has, so nothing here needs a button.
 *  Deliberately NOT the first file auto-opened: a hidden terminal must never
 *  start playing whatever happens to sort first. */
export function NoFileState(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
      <div className="text-sm font-medium text-[var(--p-dim)]">No file selected</div>
      <div className="text-xs text-[var(--p-dim2)]">Pick one from the sidebar</div>
    </div>
  )
}
