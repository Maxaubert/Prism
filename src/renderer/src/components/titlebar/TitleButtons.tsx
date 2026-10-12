import type { JSX, ReactNode } from 'react'
import { Gear } from '../icons/Icon'

/**
 * The title bar's right end: the update chip, More, the pencil, the cog and
 * the three window buttons. Its own component because with the title bar
 * hidden (#250) the same group sits at the end of the tab row instead.
 */
export function TitleButtons({
  setup,
  chip,
  onMore,
  moreOpen,
  editable,
  editing,
  onToggleEdit,
  settingsOpen,
  onToggleSettings
}: {
  setup: boolean
  chip?: ReactNode
  onMore: (button: HTMLElement, keyboard?: boolean) => void
  moreOpen: boolean
  editable: boolean
  editing: boolean
  onToggleEdit: () => void
  settingsOpen: boolean
  onToggleSettings: () => void
}): JSX.Element {
  const w = window.prism
  return (
    <>
      {/* The update chip: a quiet pill, present only while there is something
          to install, and the SAME component as Prism Terminal's (#168). The
          rule it was built to keep is this bar's own (owner pick from 12
          mockups, 2026-08-24): the chip IS the progress bar, one shape for
          every state, and it never changes width. A click opens the update
          window; it no longer installs. IT LEADS THE GROUP (owner,
          2026-09-20, #179: "update button in prism should be the left most
          button, right now it has the remote button to its left"): the one
          control in the bar that comes and goes should not sit BETWEEN two
          that stay, where its arrival pushes More sideways from under the
          pointer. At the head of the group it only ever takes room from the
          file's name, which truncates. */}
      {!setup && chip}
      {/* More (2026-09-06, #104, as Tools): a menu of things that are not
          about the open file. Glyph only like its neighbours, and RIGHT of the
          update chip since 2026-09-20 (#179): it was built to its left.
          THREE VERTICAL DOTS since #272 (owner, 2026-10-04: "remote should be
          where it is but the icon should be a 3 vertical dot menu where will
          have multiple things, remote just being one of them"): the pen read
          as one tool, and the menu is a drawer for several. It TOGGLES ("it
          should open then close open close"): the menu ignores a press on
          the button that owns it, so the button's own click is what shuts it. */}
      {/* TWO GROUPS (owner, 2026-10-04, of More, the cog and the window
          buttons: "the icons here seem too far apart, or maybe it should be
          the 3 vertical dots on the inside"): the app's own buttons sit close
          together with More on the INSIDE, next to the window buttons, where
          Chrome and VS Code keep it; a wider step then parts them from
          minimize, maximize and close. */}
      <div className="no-drag flex items-center gap-0.5">
        {!setup && editable && (
          <button
            className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
            onClick={onToggleEdit}
            title={editing ? 'Stop editing' : 'Edit'}
            aria-label="Edit"
            aria-pressed={editing}
          >
            <svg
              viewBox="0 0 24 24"
              width={15}
              height={15}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              data-toggle-glyph={editing ? 'on' : 'off'}
            >
              {/* Pressed, the pencil is SOLID, as the preview's column is: a
                  pressed toggle is never tinted the accent (owner, 2026-10-12). */}
              {editing ? (
                <path d="M4 20h4L19 9l-4-4L4 16v4z" fill="currentColor" />
              ) : (
                <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
              )}
            </svg>
          </button>
        )}
        {!setup && (
          <button
            className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
            onClick={onToggleSettings}
            title="Settings"
            aria-label="Settings"
            aria-pressed={settingsOpen}
          >
            <Gear size={15} solid={settingsOpen} data-toggle-glyph={settingsOpen ? 'on' : 'off'} />
          </button>
        )}
        {!setup && (
          <button
            className="no-drag grid h-7 w-8 shrink-0 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
            // detail 0 is Enter or Space: the menu then takes the focus.
            onClick={(e) => onMore(e.currentTarget, e.detail === 0)}
            title="More"
            aria-label="More"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            data-more-button
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden data-more-glyph>
              <circle cx="12" cy="5.5" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="12" cy="18.5" r="1.7" />
            </svg>
          </button>
        )}
      </div>
      <div className="no-drag ml-2 flex items-center gap-1">
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
          onClick={() => w.minimize()}
          aria-label="Minimize"
          data-window-button
        >
          –
        </button>
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
          onClick={() => w.toggleMaximize()}
          aria-label="Maximize"
          data-window-button
        >
          ▢
        </button>
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] hover:bg-red-500/80 hover:text-[var(--p-text)]"
          onClick={() => w.close()}
          aria-label="Close window"
          data-window-button
        >
          ✕
        </button>
      </div>
    </>
  )
}
