import type { JSX, ReactNode } from 'react'
import { PanelToggle } from '../PanelToggle'
import { TitleButtons } from './TitleButtons'

/** The title bar: the panel toggle, the wordmark, the open file and its
 *  place, and the buttons at its right end. */
export function TopBar({
  name,
  pos,
  settingsOpen,
  onToggleSettings,
  chip,
  panelOpen,
  onTogglePanel,
  setup,
  wash,
  editable,
  editing,
  dirty,
  onToggleEdit,
  onMore,
  moreOpen
}: {
  /** The open file's name - or '' while the sidebar is showing it, so the
   *  same fact isn't said twice on one screen. */
  name: string
  pos: string
  settingsOpen: boolean
  onToggleSettings: () => void
  /** The left-hand panel of whatever is on screen: the tree, or the rail. */
  panelOpen: boolean
  onTogglePanel?: () => void
  /** First-run setup is up: the bar keeps the name and the window buttons, and
   *  drops the controls for an app you haven't met yet. */
  setup: boolean
  /** Whether the style's light reaches the bar. It follows the window: with a
   *  file on screen there is no wash anywhere. */
  wash: boolean
  /** Whether the open file takes the pencil (only markdown does). */
  editable: boolean
  editing: boolean
  /** The open buffer holds unsaved text: the bar says so with a dot. */
  dirty: boolean
  onToggleEdit: () => void
  /** The update chip, or nothing when there is no update. It is handed in,
   *  not built here: it is prism-term-core's component since #168, and its
   *  state lives in App beside the window it opens, so the bar only gives it
   *  its place. */
  chip?: ReactNode
  /** The More menu: opened under the button, shut by a second press on it. */
  onMore: (button: HTMLElement, keyboard?: boolean) => void
  moreOpen: boolean
}): JSX.Element {
  return (
    // The bar changes colour on a curve rather than in a frame: during the
    // setup's mode wipe it is the one surface the still doesn't cover, and a
    // hard swap there read as a flash.
    <div
      // Named for the e2e (updateWindow asserts the chip is IN the bar), as
      // Prism Terminal's bar is.
      data-title-bar
      className={`drag p-styled-font flex h-9 shrink-0 items-center gap-3 border-b border-[var(--p-divider)] bg-[var(--p-title)] px-3 text-[13px] transition-[background-color,border-color] duration-[550ms] [transition-timing-function:cubic-bezier(.16,1,.3,1)] ${wash ? 'p-wash' : ''}`}
    >
      {!setup && onTogglePanel && (
        <PanelToggle open={panelOpen} settingsOpen={settingsOpen} onToggle={onTogglePanel} />
      )}
      <span data-wordmark className={`font-semibold text-[var(--p-accent-hi)] ${setup ? '-ml-0.5' : ''}`}>
        Prism
      </span>
      <span data-testid="titlebar-file-name" className="min-w-0 flex-1 truncate text-[var(--p-dim)]">{name}</span>
      {/* Unsaved work is the one thing the bar interrupts itself to say. The
          tree names the file, so the dot goes where the eye already is. */}
      {dirty && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--p-accent-hi)]"
          title="Unsaved changes (Ctrl+S)"
          aria-label="Unsaved changes"
        />
      )}
      {pos && <span className="text-[var(--p-dim)]">{pos}</span>}
      <TitleButtons
        setup={setup}
        chip={chip}
        onMore={onMore}
        moreOpen={moreOpen}
        editable={editable}
        editing={editing}
        onToggleEdit={onToggleEdit}
        settingsOpen={settingsOpen}
        onToggleSettings={onToggleSettings}
      />
    </div>
  )
}
