import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { Glyph } from 'prism-term-core/renderer/settings/layout/Glyph'
import {
  deletePreset,
  previewStyle,
  setStyle,
  useCurrentId,
  usePreviewId,
  useSelectedId,
  useStoredStyle,
  useThemes,
  type Style
} from '../../lib/theme'
import { columnsFor, rowOf, visibleIndices, wallTarget, WALL_COLS } from '../../lib/themes/wall'
import { useWallMotion } from '../../hooks/useWallMotion'
import { ThemeCard } from '../ThemeCard'

/**
 * THE THEME WALL (#298; owner, 2026-10-06): ONE picker, the 18 themes then
 * the own copies, no Colour mode. Collapsed to the row that holds the current
 * theme (the default each time it is shown, not remembered), with an
 * animated "Show all 18 themes" / "Show fewer" under it.
 *
 * ONE FOCUS STOP (roving tabIndex on the chosen card). The arrows move AND
 * show: each repaints the window in the theme it lands on, as a PREVIEW
 * (`previewStyle`): nothing is written, the draft is hidden and kept, the
 * terminal's theme is untouched. Moving past the row in view opens the wall,
 * so the arrows walk every theme. Enter or Space keeps the theme on screen;
 * so does a click, and the focus leaving the wall on a preview. Escape goes
 * back to the theme the wall had (repainting it with its draft) and keeps the
 * focus there; with nothing to undo it is left to Settings, which closes.
 */
export function ThemeWall({
  label = 'Themes',
  height = 104,
  commitWith
}: {
  /** The radiogroup's name: the header row's label. */
  label?: string
  /** The card preview's height: 104px here, 72px in onboarding. */
  height?: number
  /** A host that commits a kept theme itself, later: onboarding plays its
   *  sweep across a change of mode and changes the theme under it. `from`
   *  is what is on screen (a preview included), `to` the theme kept. */
  commitWith?: (from: Style, to: Style, commit: () => void) => void
}): JSX.Element {
  const themes = useThemes()
  const current = useCurrentId()
  const stored = useStoredStyle()
  const selected = useSelectedId()
  const preview = usePreviewId()
  const wallRef = useRef<HTMLDivElement>(null)
  const cards = useRef(new Map<string, HTMLButtonElement>())
  const [open, setOpen] = useState(false)
  // The layout React draws; during a close the wall stays laid out open until
  // the animation ends (`useWallMotion`).
  const [laidOpen, setLaidOpen] = useState(false)
  const [cols, setCols] = useState(WALL_COLS)
  const [say, setSay] = useState('')
  const motion = useWallMotion(wallRef, (o) => flushSync(() => setLaidOpen(o)))

  // The card that is chosen: the theme on screen.
  const chosenId = preview ?? current
  const chosen = Math.max(
    0,
    themes.findIndex((t) => t.id === chosenId)
  )
  const shown = new Set(visibleIndices(themes.length, cols, chosen, laidOpen))

  // Six across, three when six 124px cards do not fit.
  useLayoutEffect(() => {
    const w = wallRef.current
    if (!w) return
    const measure = (): void => setCols(columnsFor(w.getBoundingClientRect().width))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(w)
    return () => ro.disconnect()
  }, [])

  // A preview left standing when the wall goes (Settings closed with the
  // mouse) is kept, as the focus leaving the wall keeps it.
  const previewRef = useRef(preview)
  useEffect(() => {
    previewRef.current = preview
  })
  useEffect(
    () => () => {
      if (previewRef.current !== null) setStyle(previewRef.current)
    },
    []
  )

  const toggle = (next: boolean): void => {
    setOpen(next)
    motion.run(next, rowOf(chosen, cols), cols)
  }

  const keep = (id: string): void => {
    // The current theme kept while it is edited keeps its edits: a click on
    // it never throws them away (as before #298).
    if (id === current && preview === null) return
    const from = (preview !== null ? themes.find((t) => t.id === preview) : undefined) ?? stored
    const to = themes.find((t) => t.id === id)
    if (commitWith && to) commitWith(from, to, () => setStyle(id))
    else setStyle(id)
  }

  const focusCard = (id: string): void => cards.current.get(id)?.focus()

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, st: Style): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      keep(chosenId)
      setSay(`${themes[chosen]?.name ?? ''} kept`)
      return
    }
    if (e.key === 'Escape') {
      if (preview === null) return // nothing to undo: Settings' own Escape
      e.preventDefault()
      e.stopPropagation()
      previewStyle(null)
      focusCard(current)
      setSay(`Back to ${stored.name}`)
      return
    }
    if (e.key === 'Delete' && st.custom) {
      e.preventDefault()
      deletePreset(st.id)
      return
    }
    const j = wallTarget(chosen, e.key, themes.length, cols)
    if (j < 0 || e.altKey || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    e.stopPropagation()
    // Moving past the row in view opens the wall: the arrows walk them all.
    if (!open && rowOf(j, cols) !== rowOf(chosen, cols)) toggle(true)
    const id = themes[j].id
    previewStyle(id === current ? null : id)
    // The card has to be laid out before it can take the focus.
    requestAnimationFrame(() => focusCard(id))
  }

  return (
    <div className="flex flex-col" data-theme-wall-root="">
      <div
        ref={wallRef}
        id="theme-wall"
        role="radiogroup"
        aria-label={label}
        data-theme-wall=""
        data-open={open ? '' : undefined}
        // While a theme is only previewed, Escape is the wall's: it goes back.
        data-owns-escape={preview !== null ? '' : undefined}
        className="grid gap-x-2 gap-y-3 p-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        onBlur={(e) => {
          // The focus leaving the wall keeps a previewed theme.
          if (preview !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) keep(preview)
        }}
      >
        {themes.map((st, i) => {
          // The CURRENT theme's card is live: it renders the edited theme, so
          // an edit shows on its card; every other card shows its saved self.
          const live = st.id === current
          const on = st.id === chosenId
          return (
            <ThemeCard
              key={st.id}
              ref={(el) => {
                if (el) cards.current.set(st.id, el)
                else cards.current.delete(st.id)
              }}
              st={live ? stored : st}
              chosen={on}
              tabbable={on}
              height={height}
              hidden={!shown.has(i)}
              onPick={(e) => {
                const card = e.currentTarget as HTMLButtonElement
                if (live && preview === null && selected === null) {
                  card.focus()
                  return
                }
                keep(st.id)
                card.focus()
              }}
              onDelete={st.custom ? () => deletePreset(st.id) : undefined}
              onKeyDown={(e) => onKeyDown(e, st)}
            />
          )
        })}
      </div>
      <div className="mt-1 flex justify-center">
        <button
          type="button"
          data-wall-more=""
          aria-expanded={open}
          aria-controls="theme-wall"
          onClick={() => toggle(!open)}
          className="flex h-7 items-center gap-1.5 rounded-[5px] pl-3 pr-2.5 text-[12px] font-medium text-[var(--p-dim)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
        >
          <span>{open ? 'Show fewer' : `Show all ${themes.length} themes`}</span>
          <span data-wall-chevron="" className="wall-chevron grid place-items-center" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
            <Glyph name="M6 9l6 6 6-6" size={14} stroke={2} />
          </span>
        </button>
      </div>
      <span role="status" aria-live="polite" className="sr-only" data-wall-say="">
        {say}
      </span>
    </div>
  )
}
