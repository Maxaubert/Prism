import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { Glyph } from './Glyph'
import { IconTile, RULE, SUB_INK, Subtext } from './SettingRow'
import { PANEL_RADIUS } from './SettingsSection'
import { flashPref } from './flash'
import { hiddenTitle } from '../../lib/hiddenTitle'
import { searchSettings, type SettingsIndexEntry } from './search'

// THE SETTINGS FRAME, for both apps (2026-10-05, the grouped cards redesign;
// owner: "can you mock up some new settings pages ... grouped cards ... both
// apps", the approved v1 and its Prism Terminal version). The rail with its
// title, Find a setting and the pages; the pane with the page's header and the
// host's sections. Props only: which pages exist, what each holds and what the
// index says are the host's.
//
// THE CHOSEN PAGE IS A GREY FILL, NOT THE ACCENT (owner, 2026-10-05: no accent
// bar on the chosen rail item): `--p-hover-hi`, bold text, a brighter icon.
//
// NARROW: below 760px of the FRAME's own width (a container query, since in
// Prism Terminal the page is a tab and in Prism the frame is zoomed) the rail
// is icons only, 56px, and Find a setting is a magnifier that opens the field
// over the pane. `compact` asks for the same at any width (Prism's toggle).

export interface SettingsPageDef {
  id: string
  label: string
  icon: string
  /** Drawn at the bottom of the rail, after a spacer (About). */
  end?: boolean
}

export type { SettingsIndexEntry } from './search'

/** The settings font: the system's, whatever the theme or style wears. */
export const SETTINGS_FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const DISPLAY_FONT = '"Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'

// Every narrow rule twice, as literals Tailwind can find: once behind the
// container query, once for `compact`, which applies it at any width.
const NARROW = {
  rail: '@max-[760px]:w-14 @max-[760px]:items-center @max-[760px]:px-2',
  hide: '@max-[760px]:hidden',
  find: '@max-[760px]:w-10',
  input:
    '@max-[760px]:absolute @max-[760px]:left-0 @max-[760px]:top-0 @max-[760px]:w-10 @max-[760px]:cursor-pointer @max-[760px]:pr-0 @max-[760px]:text-transparent @max-[760px]:placeholder:text-transparent @max-[760px]:focus:w-[300px] @max-[760px]:focus:cursor-text @max-[760px]:focus:bg-[var(--p-side-flat)] @max-[760px]:focus:pr-[30px] @max-[760px]:focus:text-[var(--p-text)] @max-[760px]:focus:placeholder:text-[var(--p-dim)] @max-[760px]:[&:not(:placeholder-shown)]:w-[300px] @max-[760px]:[&:not(:placeholder-shown)]:bg-[var(--p-side-flat)] @max-[760px]:[&:not(:placeholder-shown)]:pr-[30px] @max-[760px]:[&:not(:placeholder-shown)]:text-[var(--p-text)]',
  glass: '@max-[760px]:left-[13px]',
  clear: '@max-[760px]:left-[274px] @max-[760px]:right-auto',
  nav: '@max-[760px]:w-10 @max-[760px]:justify-center @max-[760px]:px-0',
  inner: '@max-[760px]:px-5 @max-[760px]:pb-12 @max-[760px]:pt-5'
}
const COMPACT = {
  rail: 'w-14 items-center px-2',
  hide: 'hidden',
  find: 'w-10',
  input:
    'absolute left-0 top-0 w-10 cursor-pointer pr-0 text-transparent placeholder:text-transparent focus:w-[300px] focus:cursor-text focus:bg-[var(--p-side-flat)] focus:pr-[30px] focus:text-[var(--p-text)] focus:placeholder:text-[var(--p-dim)] [&:not(:placeholder-shown)]:w-[300px] [&:not(:placeholder-shown)]:bg-[var(--p-side-flat)] [&:not(:placeholder-shown)]:pr-[30px] [&:not(:placeholder-shown)]:text-[var(--p-text)]',
  glass: 'left-[13px]',
  clear: 'left-[274px] right-auto',
  nav: 'w-10 justify-center px-0',
  inner: 'px-5 pb-12 pt-5'
}

export function SettingsFrame({
  pages,
  page,
  onPage,
  index,
  title = 'Settings',
  headerAction,
  compact = false,
  children
}: {
  pages: SettingsPageDef[]
  page: string
  onPage: (id: string, view?: string) => void
  /** Every row the host draws on this PC, in page order. */
  index: readonly SettingsIndexEntry[]
  title?: string
  /** At the right end of the page header (Prism's Media switch). */
  headerAction?: ReactNode
  compact?: boolean
  children: ReactNode
}): JSX.Element {
  const n = compact ? COMPACT : NARROW
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(-1)
  const [pending, setPending] = useState<SettingsIndexEntry | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const headId = useId()
  const names = useMemo(() => Object.fromEntries(pages.map((p) => [p.id, p.label])), [pages])
  const searching = query.trim().length > 0
  const hits = useMemo(() => (searching ? searchSettings(index, query, names) : []), [searching, index, query, names])
  const active = pages.find((p) => p.id === page) ?? pages[0]

  // A new page starts at its top; a result then scrolls to its row.
  useEffect(() => {
    if (pane.current) pane.current.scrollTop = 0
  }, [page, searching])
  useEffect(() => {
    if (!pending || !pane.current) return
    // Each choice is a new object, so this runs once per choice; the wait
    // for a late row is cancelled only by the next choice or by leaving.
    return flashPref(pane.current, pending.id, pending.sectionId)
  }, [pending])

  const choose = (hit: SettingsIndexEntry): void => {
    setQuery('')
    setCursor(-1)
    onPage(hit.page, hit.view)
    setPending({ ...hit })
  }
  const mark = (i: number): void => {
    setCursor(i)
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[i]?.focus()
  }
  const clear = (): void => {
    setQuery('')
    setCursor(-1)
    field.current?.focus()
  }

  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape' && query) {
      // Only an EMPTY field lets Escape through to the host (Prism closes
      // Settings on it).
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      setQuery('')
      setCursor(-1)
    } else if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault()
      mark(0)
    } else if (e.key === 'Enter' && hits.length) {
      e.preventDefault()
      choose(hits[0])
    }
  }
  const onListKey = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mark(Math.min(cursor + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (cursor <= 0) {
        setCursor(-1)
        field.current?.focus()
      } else mark(cursor - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (hits[cursor]) choose(hits[cursor])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      clear()
    }
  }
  const onRailKey = (e: ReactKeyboardEvent): void => {
    const all = [...(e.currentTarget.querySelectorAll<HTMLElement>('[data-settings-tab]') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const j =
      e.key === 'ArrowDown' ? Math.min(i + 1, all.length - 1)
      : e.key === 'ArrowUp' ? Math.max(i - 1, 0)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? all.length - 1
      : -1
    if (j < 0) return
    e.preventDefault()
    all[j].focus()
  }

  const railButton = (p: SettingsPageDef): JSX.Element => {
    const on = p.id === active.id && !searching
    return (
      <button
        key={p.id}
        data-settings-tab={p.id}
        onClick={() => {
          setQuery('')
          onPage(p.id)
        }}
        aria-current={on ? 'page' : undefined}
        aria-label={p.label}
        // The name on hover only while the rail is folded to its icons.
        {...hiddenTitle(p.label)}
        className={`flex h-9 w-full shrink-0 items-center gap-[11px] rounded-md px-2.5 text-left text-[13px] transition-colors focus-visible:outline-none ${n.nav} ${
          on
            ? 'bg-[var(--p-hover-hi)] font-semibold text-[var(--p-text)]'
            : 'font-medium text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:bg-[var(--p-hover)] focus-visible:text-[var(--p-text)]'
        }`}
      >
        <span className={on ? 'text-[var(--p-text)]' : 'text-[var(--p-dim)]'}>
          <Glyph name={p.icon} size={17} />
        </span>
        <span className={n.hide}>{p.label}</span>
      </button>
    )
  }

  return (
    <div
      data-settings-page
      data-settings-searching={searching || undefined}
      className="@container flex h-full min-h-0 w-full bg-[var(--p-bg)]"
      style={{ fontFamily: SETTINGS_FONT, fontSize: '12.5px' }}
    >
      <nav
        aria-label="Settings pages"
        onKeyDown={onRailKey}
        className={`flex w-[244px] shrink-0 flex-col border-r border-[color:var(--p-divider)] bg-[var(--p-side)] px-3 pb-3 pt-[18px] ${n.rail}`}
      >
        <h1
          className={`mx-2 mb-3 mt-0 text-[15px] font-bold tracking-[-0.01em] text-[var(--p-text)] ${n.hide}`}
          style={{ fontFamily: DISPLAY_FONT }}
        >
          {title}
        </h1>
        <div className={`relative mb-3.5 h-8 shrink-0 ${n.find}`}>
          <input
            ref={field}
            data-settings-find
            // ONLY WHILE IT HOLDS TEXT: a host's own Escape yields to whatever
            // wears this (Prism's App tests for it with querySelector), and a
            // field that is always on the page would take Escape from the host
            // for good. An empty field lets Escape through (spec 1.3).
            data-owns-escape={query ? '' : undefined}
            type="search"
            value={query}
            placeholder="Find a setting"
            aria-label="Find a setting"
            aria-controls={listId}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(-1)
            }}
            onKeyDown={onFieldKey}
            className={`z-30 h-8 w-full appearance-none rounded-md border border-[color:var(--p-line)] bg-[color-mix(in_srgb,var(--p-text)_3.6%,transparent)] pl-8 pr-[30px] text-[12.5px] text-[var(--p-text)] outline-none transition-[width] placeholder:text-[var(--p-dim)] focus:border-[color:color-mix(in_srgb,var(--p-text)_22%,transparent)] [&::-webkit-search-cancel-button]:hidden ${n.input}`}
          />
          <span className={`pointer-events-none absolute left-2.5 top-1/2 z-30 -translate-y-1/2 text-[var(--p-dim)] ${n.glass}`}>
            <Glyph name="search" size={14} stroke={2} />
          </span>
          {query && (
            <button
              aria-label="Clear the search"
              onClick={clear}
              className={`absolute right-1.5 top-1/2 z-30 grid h-5 w-5 ${n.clear} -translate-y-1/2 place-items-center rounded text-[var(--p-dim)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)] focus-visible:bg-[var(--p-hover)] focus-visible:text-[var(--p-text)] focus-visible:outline-none`}
            >
              <Glyph name="x" size={10} stroke={2.6} />
            </button>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-0.5">
          {pages.filter((p) => !p.end).map(railButton)}
          <div className="flex-1" />
          {pages.filter((p) => p.end).map(railButton)}
        </div>
      </nav>

      <div ref={pane} className="p-scroll min-w-0 flex-1 overflow-y-auto">
        <div
          role="region"
          aria-labelledby={headId}
          className={`max-w-[960px] px-11 pb-16 pt-[26px] [&_section:first-of-type]:mt-[18px] ${n.inner}`}
        >
          <div className="flex items-center gap-4">
            <h2
              id={headId}
              className="m-0 text-[24px] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--p-text)]"
              style={{ fontFamily: DISPLAY_FONT }}
            >
              {searching ? 'Results' : active.label}
            </h2>
            {searching ? (
              <span role="status" className="ml-auto text-[11.5px] text-[var(--p-dim)]">
                {hits.length ? `${hits.length} ${hits.length === 1 ? 'result' : 'results'}` : 'No results'}
              </span>
            ) : (
              headerAction && <div className="ml-auto">{headerAction}</div>
            )}
          </div>
          {searching ? (
            <section className="mt-[26px]">
              {hits.length ? (
                <div
                  ref={list}
                  id={listId}
                  role="listbox"
                  aria-label="Results"
                  onKeyDown={onListKey}
                  className={`border border-[color:var(--p-line)] bg-[color-mix(in_srgb,var(--p-text)_3.6%,transparent)] ${PANEL_RADIUS}`}
                >
                  {hits.map((h, i) => (
                    <div
                      key={`${h.page}:${h.id}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={i === cursor}
                      data-hit={h.id}
                      onClick={() => choose(h)}
                      onFocus={() => setCursor(i)}
                      className={`relative grid min-h-[58px] cursor-pointer grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3.5 py-2.5 pl-3.5 pr-4 outline-none first:rounded-t-[inherit] last:rounded-b-[inherit] ${RULE} before:left-[60px] hover:bg-[color-mix(in_srgb,var(--p-text)_2.5%,transparent)] aria-selected:bg-[var(--p-hover)]`}
                    >
                      <IconTile icon={h.icon} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold leading-[1.3] text-[var(--p-text)]">{h.label}</div>
                        {h.sub && <Subtext text={h.sub} />}
                      </div>
                      <span className={`whitespace-nowrap text-[11.5px] ${SUB_INK}`}>
                        {[names[h.page] ?? h.page, h.section].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  id={listId}
                  data-settings-nothing
                  className={`border border-[color:var(--p-line)] bg-[color-mix(in_srgb,var(--p-text)_3.6%,transparent)] px-[18px] py-7 text-[12.5px] text-[var(--p-dim)] ${PANEL_RADIUS}`}
                >
                  Nothing matches <b className="font-semibold text-[var(--p-text)]">{query.trim()}</b>. Try a shorter word.
                </div>
              )}
            </section>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  )
}
