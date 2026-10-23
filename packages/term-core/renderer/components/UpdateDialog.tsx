import { useEffect, useMemo, useRef, type JSX } from 'react'
import { Modal } from './Modal'
import { groupReleaseNotes } from '../../shared/releaseGroups'
import { moreLine, parseReleaseNotes } from '../../shared/releaseNotes'
import type { UpdateInfo, UpdatePhase } from '../../shared/updateTypes'

/**
 * The window the update chip opens (#28). Owner, 2026-09-19: "when you click
 * the Update badge, it opens like a pop window, which shows the change log or
 * like patch notes for the new update, and then you can choose cancel or
 * install." One copy, for both apps.
 *
 * Props only, like the chip. It closes on Cancel, on Escape and on a press
 * outside it. Whether Install may start at once is the HOST's question (it ends
 * in the app quitting, and a working agent or unsaved text has a say), so this
 * only reports the choice.
 *
 * IT STAYS FOR THE INSTALL, AND DRAWS THE BAR (#32). Owner, 2026-09-20: "when
 * you click install keep me with the panel open and have the progress bar
 * straight there, kind of like the way extract works for zip files in Prism."
 * It used to close on Install and leave the progress to the chip. So, as the
 * archive panel does it: the progress track is ALWAYS in the layout and only
 * fades in, because a track inserted when the work began would push the buttons
 * down and pull them back (the e2e measures that the box does not change size).
 * While the install runs the window cannot be put away by the user: Escape and
 * a press outside do nothing, and Cancel cancels the DOWNLOAD where the host
 * can (`onAbort`), which is the only honest meaning it can have then. Once the
 * installer has the file there is nothing left to cancel and the button says so
 * by being disabled. How it ended (a failure, a preview) is said on the same
 * line the progress was on, in the window the user is already looking at.
 *
 * THE NOTES ARE PLAIN TEXT, AND THAT IS A RULE, NOT A STYLE. They are a GitHub
 * release body, which is text off the network, shown in a window that can reach
 * the app's bridge to main. `parseReleaseNotes` reduces the body to strings and
 * each one is printed below as a text node, which React escapes. No markdown is
 * rendered, no HTML is set, and nothing in here is an anchor: a url in a title
 * is only characters. Do not "improve" this with a markdown renderer.
 *
 * It looks like each app's own Dialog on purpose (same scrim, same box, same
 * buttons), and sits on the OPAQUE surface token: `--p-title` and `--p-bg`
 * carry the window's alpha on an acrylic theme, and a question is not
 * something to read the desktop through.
 */
export default function UpdateDialog({
  info,
  currentVersion,
  phase = 'idle',
  pct = 0,
  aborting = false,
  notice = null,
  onInstall,
  onCancel,
  onAbort
}: {
  info: UpdateInfo
  /** The running app's version; the quiet line under the title. */
  currentVersion: string
  phase?: UpdatePhase
  pct?: number
  /** Cancel was pressed and the download has not stopped yet. */
  aborting?: boolean
  /** How the last install ended, while this window was up. */
  notice?: string | null
  onInstall: () => void
  /** Backing out while nothing runs. */
  onCancel: () => void
  /** Stop the download. Left out by a host that cannot. */
  onAbort?: () => void
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const notes = useMemo(() => parseReleaseNotes(info.notes), [info.notes])
  // SORTED UNDER HEADINGS, worded for a reader (owner, 2026-09-20: "headers bug
  // fixes, new features, so on... not like a git commit"). Still the parser's
  // plain strings, only moved and trimmed: see shared/releaseGroups.
  const sections = useMemo(() => groupReleaseNotes(notes), [notes])
  const running = phase !== 'idle'
  const title = running ? `Updating to ${info.version}` : `Update to ${info.version}`
  const status = aborting
    ? 'Cancelling…'
    : phase === 'downloading'
      ? 'Downloading the update'
      : phase === 'installing'
        ? info.mock
          ? 'Installing (preview: nothing is installed)'
          : 'Installing. The app will close and reopen.'
        : (notice ?? '')
  const canAbort = phase === 'downloading' && !aborting && !!onAbort
  // Install is disabled the moment it is pressed, and a disabled button drops
  // the focus to the body, behind which is a terminal. It goes to the box.
  useEffect(() => {
    if (running) box.current?.focus()
  }, [running])

  // The frame (scrim, Escape swallowed and acted on only while nothing runs,
  // Tab kept inside, a press outside, focus on Install) is the core's Modal.
  return (
    <Modal
      onCancel={onCancel}
      locked={running}
      label={title}
      scrimAttrs={{ 'data-update-scrim': true }}
      boxAttrs={{ 'data-update-dialog': true, 'data-phase': phase }}
      boxRef={box}
      boxClassName="flex max-h-full w-full max-w-[460px] flex-col p-5"
    >
      <h2 className="text-[14.5px] font-semibold text-[var(--p-text)]">{title}</h2>
      <p data-update-current className="mt-1 text-[12.5px] leading-relaxed text-[var(--p-dim)]">
        You have {currentVersion}
      </p>
      {/* The list scrolls, the dialog does not: a long release must not push
            Cancel and Install off the bottom of a small window. tabIndex so the
            keyboard can scroll it. */}
      <div
        data-update-notes
        tabIndex={0}
        aria-label="What is new"
        // NO BOX ROUND THE NOTES (owner, 2026-09-20: "dont have the changelog
        // inside a container, i just want it on the main window bg"). It was
        // a bordered, tinted panel inside the dialog: a box in a box. The
        // list still scrolls inside a capped height, which is what keeps
        // Cancel and Install on screen under a long release; the right
        // padding is only room for that scrollbar.
        className="p-scroll mt-4 max-h-[min(44vh,300px)] min-h-0 overflow-y-auto pr-2 focus-visible:outline-none"
      >
        {notes.empty ? (
          <p className="text-[12.5px] leading-relaxed text-[var(--p-dim)]">{notes.entries[0]}</p>
        ) : (
          <>
            {sections.map((section, n) => (
              <section
                key={section.kind}
                data-update-section={section.kind}
                className={n ? 'mt-4' : ''}
              >
                <h3 className="mb-1.5 text-[12.5px] font-semibold text-[var(--p-text)]">
                  {section.heading}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {section.entries.map((entry, i) => (
                    // The index is the key: two pull requests can share a title.
                    <li
                      key={i}
                      data-update-entry
                      className="flex gap-2 text-[12.5px] leading-snug text-[var(--p-text-soft)]"
                    >
                      <span
                        aria-hidden
                        className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-[var(--p-accent-hi)]"
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{entry}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {notes.more > 0 && (
              <p data-update-more className="mt-3 text-[12px] text-[var(--p-dim)]">
                {moreLine(notes.more)}
              </p>
            )}
          </>
        )}
      </div>
      {/* A preview is NOT announced up front (owner, 2026-09-20: "dont show
            this text"): the point of one is to see the window as it will be.
            What it did is still said, truthfully, where it ends: "Preview
            only: nothing was installed" on the status line, and "(preview:
            nothing is installed)" beside "Installing". */}
      {/* ALWAYS IN THE LAYOUT, only fading in: see the note at the top. One
            line of status with the percentage at its right, the track under
            it. The ending is said on the status line, with the track gone. */}
      <div
        data-update-progress
        data-active={running || !!notice}
        aria-hidden={!running && !notice}
        className={`mt-4 shrink-0 transition-opacity duration-200 ${running || notice ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="flex min-h-[18px] items-baseline justify-between gap-3 text-[12px] leading-[18px]">
          <span data-update-status role="status" className="min-w-0 text-[var(--p-text-soft)]">
            {status}
          </span>
          <span
            data-update-pct
            aria-hidden
            className={`shrink-0 tabular-nums text-[var(--p-dim)] ${running ? '' : 'hidden'}`}
          >
            {pct}%
          </span>
        </div>
        <div
          data-update-track
          {...(running
            ? {
                role: 'progressbar',
                'aria-label': title,
                'aria-valuenow': pct,
                'aria-valuemin': 0,
                'aria-valuemax': 100
              }
            : {})}
          className={`mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--p-text)_12%,transparent)] ${running ? '' : 'invisible'}`}
        >
          {/* No transition on the way back to 0: a bar that drains reads as
                an install running backwards. */}
          <div
            data-update-fill
            className={`h-full rounded-full bg-[var(--p-accent-solid,var(--p-accent))] ${running ? 'transition-[width] duration-300 ease-out' : ''}`}
            style={{ width: `${running ? pct : 0}%` }}
          />
        </div>
      </div>
      <div className="mt-5 flex shrink-0 justify-end gap-2">
        <button
          data-update-cancel
          onClick={running ? onAbort : onCancel}
          disabled={running && !canAbort}
          title={
            running && !canAbort && !aborting
              ? phase === 'installing'
                ? 'The installer has started'
                : 'This download cannot be cancelled'
              : undefined
          }
          className="disabled:cursor-default disabled:opacity-45 disabled:hover:text-[var(--p-text-soft)] rounded-lg border border-[color:var(--p-divider)] bg-[var(--p-hover)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--p-text-soft)] transition-colors hover:text-[var(--p-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)]"
        >
          {!running && notice ? 'Close' : 'Cancel'}
        </button>
        <button
          data-update-install
          data-primary="true"
          onClick={onInstall}
          disabled={running}
          className="disabled:cursor-default disabled:opacity-45 disabled:hover:brightness-100 rounded-lg bg-[var(--p-accent)] px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--p-on-accent)] transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)]"
        >
          Install
        </button>
      </div>
    </Modal>
  )
}
