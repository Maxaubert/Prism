import { useEffect, useMemo, useState, type JSX } from 'react'
import { dictationHost } from 'prism-term-core/renderer/host'
import { Segmented } from 'prism-term-core/renderer/settings/fields'
import { SettingsFrame } from 'prism-term-core/renderer/settings/layout/SettingsFrame'
import { DictationPage } from 'prism-term-core/renderer/settings/sections/DictationPage'
import { useTitleBarMode } from '../../lib/titleBarPrefs'
import type { TransportStyle } from '../../lib/transport'
import { useTreeSize } from '../../lib/treePrefs'
import { useStyle } from '../../lib/theme'
import { AboutPage } from './AboutPage'
import { AgentsPage } from './AgentsPage'
import { AppearancePage } from './AppearancePage'
import type { AppPageId, MediaView } from './appOptions'
import { ExplorerPage } from './ExplorerPage'
import { MediaPage } from './MediaPage'
import { ProjectPage } from './ProjectPage'
import { SETTINGS_PAGES, settingsIndex } from './settingsIndex'
import { TerminalPage } from './TerminalPage'

// THE SETTINGS PAGE IS PRISM'S; ITS FRAME, SECTIONS AND ROWS ARE THE CORE'S
// (2026-10-05, the grouped cards redesign, #292; the owner approved v1,
// "Grouped cards", with no accent bar on the chosen rail item). What is
// Prism's: which pages exist and in what order, which section sits on which
// page, its own rows (`appOptions.ts`), the page and Media view memory, the
// compact rail toggle and the zoom. The terminal's and dictation's rows are
// the core's, the same code as Prism Terminal's (#154).

const MEDIA_VIEWS: Array<{ id: MediaView; name: string }> = [
  { id: 'visualizer', name: 'Visualizer' },
  { id: 'progress', name: 'Progress bar' }
]

export function Settings({
  open,
  onClose,
  compactRail,
  onShowSetup,
  transportStyle,
  onPickTransport,
  transportBg,
  onPickTransportBg
}: {
  open: boolean
  onClose: () => void
  /** The rail collapsed to its icons, from the title-bar button. */
  compactRail: boolean
  /** Run the first-run setup again. */
  onShowSetup: () => void
  transportStyle: TransportStyle
  onPickTransport: (s: TransportStyle) => void
  transportBg: number
  onPickTransportBg: (pct: number) => void
}): JSX.Element | null {
  // ALWAYS MOUNTED, so the page and the Media view are remembered across a
  // close and an open (nothing is saved: a new launch opens on Appearance).
  const [page, setPage] = useState<AppPageId>('appearance')
  const [view, setView] = useState<MediaView>('visualizer')
  const size = useTreeSize()
  const style = useStyle()
  // The GPU row is drawn only where an NVIDIA card is found, so it is in the
  // index only there too.
  const [nvidia, setNvidia] = useState(false)
  useEffect(() => {
    if (!open) return
    let live = true
    void dictationHost()
      ?.api.dictationInfo()
      .then((info) => {
        if (live) setNvidia(!!info?.nvidia)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [open])
  const index = useMemo(() => settingsIndex(nvidia, style.name), [nvidia, style.name])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        // A MODAL QUESTION OVER THIS PAGE OWNS ESCAPE (2026-09-20, #168; found
        // by the updateWindow e2e). The update window can be opened from the
        // title bar while Settings is up, and one Escape closed BOTH: every
        // Escape listener here sits on the window in the capture phase, where
        // stopPropagation does not silence a sibling listener, and this one
        // was registered first. It yields by inspection, as App's does. The
        // test is the modal dialog itself and NOT `data-owns-escape` at large:
        // that attribute is also worn by things UNDER this page (an editor
        // whose caret is in the file, a player's open menu), and yielding to
        // those would leave Settings with no way to be closed from the keyboard.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
        // AN OPEN COLOUR PICKER OWNS ESCAPE TOO (the core's ColourPopover):
        // there it undoes the picker's writes. This listener is native and
        // runs first, and stopping the event here would close the whole page
        // and never let the picker hear it.
        if ((e.target as Element | null)?.closest?.('[data-colour-popover]')) return
        // THE THEME WALL WHILE IT PREVIEWS owns Escape (#298): it goes back to
        // the theme it had. With nothing previewed it does not, and Escape
        // closes the page as it always did.
        if ((e.target as Element | null)?.closest?.('[data-theme-wall][data-owns-escape]')) return
        // FIND A SETTING HOLDING TEXT owns Escape (spec 1.3): it clears the
        // field, and only an empty field lets Escape close Settings. The core
        // marks the field `data-owns-escape` only while it holds text.
        // Typed text with the keyboard ELSEWHERE (a press on the empty pane, a
        // Tab to the rail) made Escape do nothing at all: this yielded, and
        // the field, which clears, never heard it. So the keyboard goes back
        // to the field, and the next Escape clears it there.
        const find = document.querySelector<HTMLInputElement>('[data-settings-find][data-owns-escape]')
        if (find) {
          const t = e.target as Element | null
          if (!t?.closest?.('[data-settings-find], [data-settings-page] [role="listbox"]')) {
            e.stopPropagation()
            find.focus()
          }
          return
        }
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
  // The page starts where the chrome ends: under the title bar AND the tab
  // row (68px), or under the one row when the title bar is hidden (36px, #250;
  // owner, 2026-10-03: "the settings page doesnt move up to cover the gap").
  const titleBar = useTitleBarMode()

  if (!open) return null
  return (
    // A full-window settings page under the chrome, not a popup. The frame
    // sets the system font whatever the style says: a style's typeface
    // belongs to the app you are looking at, and letting it set the type in
    // here resizes the page the cards are chosen on. `colorScheme` follows the
    // style's mode, so the core's `light-dark()` inks (a warning subtext)
    // pick the light branch on a light style: Prism's :root says dark.
    <div
      data-settings-overlay
      // The compact rail's three rules the core's classes lose (index.css).
      data-settings-compact={compactRail || undefined}
      className={`fixed inset-x-0 bottom-0 z-40 ${titleBar === 'hidden' ? 'top-[36px]' : 'top-[68px]'}`}
      style={{ colorScheme: style.mode }}
    >
      <div className="h-full w-full" style={{ zoom: size.zoom }}>
        <SettingsFrame
          pages={SETTINGS_PAGES}
          page={page}
          onPage={(id, v) => {
            setPage(id as AppPageId)
            if (v === 'visualizer' || v === 'progress') setView(v)
          }}
          index={index}
          compact={compactRail}
          headerAction={page === 'media' ? <Segmented value={view} onChange={setView} options={MEDIA_VIEWS} /> : undefined}
        >
          {page === 'appearance' ? (
            <AppearancePage />
          ) : page === 'explorer' ? (
            <ExplorerPage />
          ) : page === 'project' ? (
            <ProjectPage />
          ) : page === 'terminal' ? (
            <TerminalPage />
          ) : page === 'agents' ? (
            <AgentsPage />
          ) : page === 'dictation' ? (
            // THE CORE'S PAGE, whole: the same settings Prism Terminal shows,
            // with this app's own values (the model files are shared).
            <DictationPage />
          ) : page === 'media' ? (
            <MediaPage
              view={view}
              transportStyle={transportStyle}
              onPickTransport={onPickTransport}
              transportBg={transportBg}
              onPickTransportBg={onPickTransportBg}
            />
          ) : (
            <AboutPage onShowSetup={onShowSetup} />
          )}
        </SettingsFrame>
      </div>
    </div>
  )
}
