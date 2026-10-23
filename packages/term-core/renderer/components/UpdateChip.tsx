import type { JSX } from 'react'
import type { UpdateInfo, UpdatePhase } from '../../shared/updateTypes'
import { LAYER } from './layers'

/**
 * The update chip: a pill in the title bar, there only while there is something
 * to install. The same in both apps (#28; owner, 2026-09-19: "yes keep the
 * core"). Props only: it never reaches for a bridge, the host's `useUpdateFlow`
 * hands it everything.
 *
 * A CLICK OPENS THE WINDOW, it does not install (owner, same day: "when you
 * click the Update badge, it opens like a pop window, which shows the change
 * log or like patch notes for the new update, and then you can choose cancel
 * or install"). Until then a click on it downloaded an installer and quit the
 * app, with nothing said about what was in it.
 *
 * IT IS FILLED IN THE ACCENT (#32; owner, 2026-09-20: "have the update
 * available button be accented colour"). It was a quiet grey pill, the same
 * weight as the controls round it, and an update is the one thing in a title
 * bar that is news. The fill is `--p-sel-bg`, NOT `--p-accent`: both apps
 * derive that token as the accent moved until `--p-on-accent` clears 4.5:1 on
 * it, and this is 11.5px text. On the raw accent the floor both apps hold is
 * 3:1, which is a button's floor and not a label's.
 *
 * IT IS NO LONGER THE PROGRESS BAR. That was Prism's standing design (owner
 * pick from 12 mockups, 2026-08-24) and #28 kept it; #32 SUPERSEDES it: the
 * window stays up for the install and draws the bar itself, so a second bar
 * behind its scrim would be the same number twice. What the old design was
 * FOR still holds, and more simply: the chip never changes width, because its
 * label never changes. While an install runs it still opens the window, which
 * is how a window the host had to hide is brought back.
 */
export default function UpdateChip({
  info,
  phase,
  onOpen,
  notice = null,
  onDismissNotice
}: {
  info: UpdateInfo | null
  phase: UpdatePhase
  onOpen: () => void
  /** How an install nobody was watching ended, hung under the chip. The host
   *  passes it only while the window is NOT up; the window says it otherwise. */
  notice?: string | null
  onDismissNotice?: () => void
}): JSX.Element | null {
  if (!info) return null
  return (
    // The wrapper exists for the line under the chip: it is positioned against
    // this box and is out of the flow, so it cannot move the title bar.
    <span className="no-drag relative flex shrink-0 items-center">
      <button
        data-update-chip
        data-phase={phase}
        className="relative flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-[var(--p-sel-bg,var(--p-accent))] px-2.5 text-[11.5px] font-semibold text-[var(--p-on-accent)] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--p-side-flat)]"
        onClick={onOpen}
        title={
          phase !== 'idle'
            ? `Updating to ${info.version}`
            : info.mock
              ? `Preview: see what an update to ${info.version} would look like`
              : `See what is new in ${info.version}`
        }
        aria-label={`Update to ${info.version}`}
        aria-haspopup="dialog"
        aria-busy={phase !== 'idle'}
      >
        <svg
          viewBox="0 0 24 24"
          width={11}
          height={11}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
          aria-hidden
        >
          <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" />
        </svg>
        <span data-update-label="shown" className="whitespace-nowrap tabular-nums">
          Update {info.version}
        </span>
      </button>
      {notice && (
        <div
          data-update-notice
          // A status, so a screen reader says it; a click anywhere on it puts
          // it away, and it leaves by itself after a few seconds.
          role="status"
          onClick={onDismissNotice}
          // The flat surface, not --p-title: that one carries the window's
          // alpha on an acrylic theme, and a line hung over the tab strip must
          // not be read through.
          className={`absolute right-0 top-[calc(100%+8px)] ${LAYER.pop} whitespace-nowrap rounded-md border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2.5 py-1.5 text-[11.5px] text-[var(--p-text-soft)] shadow-[0_10px_30px_rgba(0,0,0,.45)]`}
        >
          {notice}
        </div>
      )}
    </span>
  )
}
