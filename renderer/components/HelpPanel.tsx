import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Modal } from './Modal'
import { hiddenTitle } from '../lib/hiddenTitle'
import {
  ALL_HELP,
  HELP_CATEGORIES,
  HELP_SHELLS,
  isKeyPress,
  type HelpEntry,
  type HelpShellChoice
} from '../../shared/help/index'
import { searchHelp } from '../../shared/help/search'
import { clampHelpWidth, HELP_WIDTH, setHelpWidth, useHelpWidth } from '../lib/helpPrefs'

/**
 * THE COMMAND HELP POPUP (#12). Owner, 2026-09-19: "an easy to use panel where
 * you can find shell commands to use the shell more effectively... searchable...
 * metadata on each command so a natural-language search finds it", and on
 * 2026-09-20: "a pop up with copy icons for easy copying". One copy, for both
 * apps.
 *
 * IT SHOWS, AND IT COPIES ON REQUEST. NOTHING ELSE. Owner, 2026-09-19: "picking
 * a command in the help panel does NOT insert it into the shell". So this file
 * has no way to reach a shell at all: it takes no session id, imports no
 * bridge, and the one thing it can do to the outside world is hand a string to
 * `onCopy`. A person reads the command, copies it, pastes it themselves and
 * presses Enter themselves, which is the whole safety model: several of these
 * commands delete things. Do not add "Run" or "Insert" without a fresh owner
 * decision; it would be a fifth exception to "the app never types into your
 * shell", and the first one that carries Enter in spirit.
 *
 * WHAT IS COPIED IS THE EXACT TEXT ON SCREEN, placeholders and all. A command
 * with FOLDER in it fails loudly when pasted unedited, which is the right
 * failure; a panel that guessed the folder would fail quietly.
 *
 * Props only, like the update window: no bridge, no store, no host. The
 * clipboard is handed in because each host has its own way to it (and
 * `navigator.clipboard` refuses when the document has no focus). The catalogue
 * is curated text that ships with the app, so unlike the release notes there
 * is nothing here off the network; it is still printed as text nodes only.
 *
 * It sits on the OPAQUE surface token for the reason the update window does:
 * `--p-bg` carries the window's alpha on an acrylic theme, and nobody can read
 * a command through the desktop.
 */

/** How many entries are drawn at first, and how many more each time the end
 *  of the list comes into view. The catalogue is a few hundred entries with
 *  several command boxes each: all at once is some ten thousand nodes built
 *  before the first frame, for a list nobody has scrolled yet. */
const FIRST_PAGE = 40
const NEXT_PAGE = 60
/** A search answers with at most this many. Past the first dozen nobody is
 *  reading; they are retyping. */
const MAX_RESULTS = 50
/** How long a copy button says so. */
const COPIED_MS = 1500

const CATEGORY_NAME = new Map(HELP_CATEGORIES.map((c) => [c.id, c.name]))

/**
 * ONE COMMAND IS ONE ROW (#12, owner 2026-09-20: "this has too much text, it
 * just needs the header and the command. no sub text and no highlighted ones.
 * just a simple, minimalist but still elegant and beautiful searchable table").
 * An entry used to be a block: a title, a sentence of summary, its command in a
 * bordered box, then a labelled box per variant and a list of placeholders. Two
 * entries filled the popup. So the entry is FLATTENED here: its own row is
 * named by its task, and each variant becomes a row of its own named by the
 * variant's label ("Copy it to the clipboard"), which is what that label always
 * was. Nothing is hidden from SEARCH by this: `searchHelp` still reads the
 * summary, the keywords and the placeholders off the entry.
 */
export interface HelpRow {
  entry: HelpEntry
  /** 0 is the entry's own command, 1+ its variants. Names the copy button. */
  n: number
  /** The left column. */
  name: string
  command: string
}

/** The list in the order it is drawn, which is the order Up and Down walk. */
function rowsFor(shell: HelpShellChoice, query: string): HelpRow[] {
  const entries =
    query.trim() !== ''
      ? searchHelp(ALL_HELP, query, { shell, limit: MAX_RESULTS }).map((h) => h.entry)
      : // Browsing: by category, in the panel's own order, catalogue order within.
        HELP_CATEGORIES.flatMap((c) => {
          const mine = ALL_HELP.filter((e) => e.shell === shell || e.shell === 'any')
          return mine.filter((e) => e.category === c.id)
        })
  return entries.flatMap((entry) => [
    { entry, n: 0, name: entry.task, command: entry.command },
    ...(entry.variants ?? []).map((v, i) => ({
      entry,
      n: i + 1,
      name: v.label,
      command: v.command
    }))
  ])
}

const CopyIcon = (): JSX.Element => (
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
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
)

const DangerIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={13}
    height={13}
    fill="none"
    stroke="#e0a100"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
    aria-hidden
  >
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </svg>
)

/** The row's columns, shared by the header and every row, so the two line up
 *  with one number to change. */
const COLUMNS = 'grid grid-cols-[minmax(9rem,1fr)_minmax(0,1.5fr)_2.25rem] items-center gap-3'

/**
 * ONE ROW: what it does, the command, a copy button. Zebra-striped the way
 * Prism's own file rows are (owner, 2026-09-20: "make the rows alternate in
 * colour kind of like Prism Explorer"), and the stripe is mixed against the
 * TEXT colour rather than being a fixed grey, so it holds on a light theme, on
 * void, and on anything somebody builds later. The FIRST row is the plain
 * ground and the second is the stripe, which is Prism's own pick.
 *
 * The command is ONE LINE and truncates: a table whose rows are different
 * heights is a list, not a table. Nothing is lost by it, since the copy takes
 * the whole text and the title shows it.
 */
function Row({
  row,
  index,
  active,
  striped,
  failed,
  mono,
  onCopy,
  onPoint
}: {
  row: HelpRow
  index: number
  active: boolean
  striped: boolean
  failed: boolean
  mono: string
  onCopy: (key: string, command: string) => void
  onPoint: () => void
}): JSX.Element {
  const key = `${row.entry.id}#${row.n}`
  const keys = isKeyPress(row.command)
  return (
    <div
      id={`help-entry-${row.entry.id}-${row.n}`}
      role="option"
      aria-selected={active}
      data-help-id={row.entry.id}
      data-help-variant={row.n}
      data-help-index={index}
      data-help-active={active || undefined}
      data-help-row
      onMouseDown={onPoint}
      className={`${COLUMNS} h-[34px] px-4 ${
        active
          ? 'bg-[color-mix(in_srgb,var(--p-accent)_20%,transparent)]'
          : striped
            ? 'bg-[color-mix(in_srgb,var(--p-text)_3.5%,transparent)]'
            : ''
      }`}
    >
      <span
        data-help-task
        className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-[var(--p-text)]"
      >
        {row.entry.danger && (
          // The warning is now a MARK, not a paragraph: the sentence is still
          // here for the pointer and for a screen reader, which is what the
          // e2e reads. A row that deletes things must not look like one that
          // lists them.
          <span
            data-help-danger
            title={`Careful. ${row.entry.danger}`}
            className="flex items-center"
          >
            <DangerIcon />
            <span className="sr-only">Careful. {row.entry.danger}</span>
          </span>
        )}
        <span className="truncate" {...hiddenTitle(row.name)}>
          {row.name}
        </span>
      </span>
      {keys ? (
        // A key to press is drawn as key caps and has no copy button: the
        // characters "Ctrl+C" on a clipboard help nobody.
        <span data-help-keys className="flex min-w-0 items-center gap-1">
          {row.command.split('+').map((k, i) => (
            <kbd
              key={i}
              className="rounded border border-[color:var(--p-line)] px-1.5 py-px text-[11px] font-semibold text-[var(--p-text-soft)]"
              style={{ fontFamily: mono }}
            >
              {k}
            </kbd>
          ))}
        </span>
      ) : (
        <code
          data-help-command
          className="min-w-0 select-text truncate text-[12.5px] text-[var(--p-text-soft)]"
          style={{ fontFamily: mono }}
          {...hiddenTitle(row.command)}
        >
          {row.command}
        </code>
      )}
      {keys ? (
        <span aria-hidden />
      ) : (
        <button
          type="button"
          data-help-copy={key}
          onClick={(e) => {
            e.stopPropagation()
            onCopy(key, row.command)
          }}
          title={failed ? 'Could not copy' : 'Copy'}
          aria-label={`Copy: ${row.command}`}
          className={`grid h-7 w-7 place-items-center justify-self-end rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)] ${
            failed
              ? 'text-[#e0a100]'
              : 'text-[var(--p-icon)] hover:bg-[var(--p-hover-hi)] hover:text-[var(--p-text)]'
          }`}
        >
          {/* A copy that WORKED is said once, by the app's "Copied" badge at the
              bottom of the window (owner, 2026-09-23), not here as well; only a
              copy that failed is marked on its row. */}
          <CopyIcon />
        </button>
      )}
    </div>
  )
}

export default function HelpPanel({
  shell,
  monoFont,
  onCopy,
  onPickShell,
  onClose
}: {
  /** The command language of the shell in front; which chip starts selected. */
  shell: HelpShellChoice
  /** The terminal's own font stack: a command is shown in the face it will be
   *  typed in. */
  monoFont: string
  /** Put this exact text on the clipboard; answer whether it got there. */
  onCopy: (text: string) => Promise<boolean> | boolean
  /** Somebody chose a shell chip by hand: the host may remember it. */
  onPickShell?: (shell: HelpShellChoice) => void
  onClose: () => void
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  // HOW WIDE IT IS, and it is DRAGGED rather than typed (owner, 2026-09-20:
  // "you also need to be able to adjust the width of this since some text can
  // be seen"). A row is one line and truncates, so the width is the only way
  // to read a long command in place. Remembered per app; see helpPrefs.
  const width = useHelpWidth()
  const drag = useRef<{ x: number; from: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onGrab = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { x: e.clientX, from: box.current?.getBoundingClientRect().width ?? width }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    // The popup is CENTRED, so it grows from both edges at once: one pixel of
    // pointer is two of width, or the edge runs away from the pointer.
    const side = e.currentTarget.dataset.helpGrip === 'left' ? -1 : 1
    setHelpWidth(d.from + (e.clientX - d.x) * 2 * side)
  }
  const onDrop = (e: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
  }
  /** The keyboard's way to the same thing, on a focused grip. */
  const onGripKey = (e: React.KeyboardEvent<HTMLDivElement>, side: number): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const step = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 80 : 20) * side
    setHelpWidth((box.current?.getBoundingClientRect().width ?? width) + step)
  }
  const grip = (side: 'left' | 'right'): JSX.Element => (
    <div
      data-help-grip={side}
      role="separator"
      aria-orientation="vertical"
      aria-label="Popup width"
      aria-valuenow={width}
      aria-valuemin={HELP_WIDTH.min}
      aria-valuemax={HELP_WIDTH.max}
      tabIndex={0}
      onPointerDown={onGrab}
      onPointerMove={onDrag}
      onPointerUp={onDrop}
      onPointerCancel={onDrop}
      onKeyDown={(e) => onGripKey(e, side === 'left' ? -1 : 1)}
      // A hit area wider than the line it draws: a 1px target is a target
      // nobody hits. The line itself only shows while it is being used or
      // pointed at, so a popup at rest has no furniture on it.
      // INSIDE the box: it has overflow-hidden, and a grip hanging over the
      // edge is clipped to nothing - the pointer then finds no target at all
      // (measured: the drag moved the width by 0).
      className={`absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} z-10 w-2 cursor-ew-resize focus-visible:outline-none`}
    >
      <div
        className={`mx-auto h-full w-px transition-opacity ${dragging ? 'bg-[var(--p-accent-hi)] opacity-100' : 'bg-[var(--p-divider)] opacity-0 hover:opacity-100'}`}
      />
    </div>
  )
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<HelpShellChoice>(shell)
  const [active, setActive] = useState(0)
  /**
   * NOTHING IS MARKED UNTIL SOMEBODY POINTS AT IT or walks the list (owner,
   * 2026-09-20: "no highlighted ones"). The first row used to open already
   * filled, which on a table of two hundred quiet rows reads as a selection
   * nobody made. The cursor still EXISTS from the first row, so one Down marks
   * it and Enter copies it; it is only not drawn before then.
   */
  const [marked, setMarked] = useState(false)
  const [limit, setLimit] = useState(FIRST_PAGE)
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null)
  /** What a screen reader is told. Its own state, since two copies of the same
   *  command must both be announced and an unchanged string is not. */
  const [said, setSaid] = useState('')

  const rows = useMemo(() => rowsFor(chip, query), [chip, query])
  const searching = query.trim() !== ''

  // A new question is a new list: back to the top, first page, first entry.
  // Done while RENDERING, not in an effect: an effect would draw one frame of
  // the new list with the old highlight somewhere down it.
  const [listKey, setListKey] = useState(`${chip}|${query}`)
  if (listKey !== `${chip}|${query}`) {
    setListKey(`${chip}|${query}`)
    setActive(0)
    setMarked(false)
    setLimit(FIRST_PAGE)
  }
  useEffect(() => {
    list.current?.scrollTo({ top: 0 })
  }, [listKey])

  const copy = (key: string, command: string): void => {
    void Promise.resolve(onCopy(command))
      .catch(() => false)
      .then((ok) => {
        setCopied({ key, ok })
        // Success is the badge's to say (it has its own live region).
        setSaid(ok ? '' : 'Could not copy to the clipboard')
      })
  }
  // The answer leaves by itself. Keyed on the OBJECT, so copying the same box
  // twice restarts the clock instead of inheriting what is left of the first.
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => {
      setCopied(null)
      setSaid('')
    }, COPIED_MS)
    return () => clearTimeout(t)
  }, [copied])

  // The end of the drawn list came into view: draw the next page.
  useEffect(() => {
    const el = sentinel.current
    const root = list.current
    if (!el || !root) return
    const io = new IntersectionObserver(
      (hits) => {
        if (hits.some((h) => h.isIntersecting)) setLimit((n) => n + NEXT_PAGE)
      },
      { root, rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [listKey, limit])

  // Only a move made BY KEY scrolls the list: a click on an entry is already
  // where the eye is, and scrolling it under the pointer is how the next click
  // lands on the wrong row.
  const moved = useRef(false)

  // THE KEY LISTENER IS REGISTERED ONCE and reads the latest of everything from
  // a ref, for the reason the update window's is (MEASURED there): keyed on
  // its callbacks, the effect is torn down and put back on every render, and
  // a keydown that lands between the two is heard by nobody.
  const live = useRef({ rows, active, marked, copy, onClose })
  useEffect(() => {
    live.current = { rows, active, marked, copy, onClose }
  })

  // The frame (scrim, Escape, Tab kept inside, a press outside, the focus
  // going back to the shell it came from on close) is the core's Modal; the
  // list's own keys are read here.
  const onKey = (e: KeyboardEvent): void => {
    const { rows: r, active: a } = live.current
    // Chords are the host's (new tab, close tab, Settings...): they keep
    // working over the popup, and none of them is read here.
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (
      e.key === 'ArrowDown' ||
      e.key === 'ArrowUp' ||
      e.key === 'PageDown' ||
      e.key === 'PageUp'
    ) {
      if (!r.length) return
      const step =
        e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 5 : -5
      // The first press MARKS where the cursor already is rather than
      // stepping off it: with nothing drawn, "move down" from nowhere means
      // the top of the list.
      const next = live.current.marked ? Math.max(0, Math.min(r.length - 1, a + step)) : a
      setMarked(true)
      e.preventDefault()
      e.stopPropagation()
      // An entry past the drawn page has to exist before it can be shown.
      setLimit((n) => (next + 5 > n ? next + NEXT_PAGE : n))
      setActive(next)
      moved.current = true
      return
    }
    if (e.key === 'Enter') {
      // On a button, Enter is that button's own press (a chip, a variant's
      // copy, Close). Anywhere else it copies the highlighted entry.
      if ((e.target as HTMLElement | null)?.closest('button')) return
      e.preventDefault()
      e.stopPropagation()
      const row = r[a]
      if (!row) return
      if (isKeyPress(row.command)) setSaid(`${row.command} is a key to press, not text to copy`)
      else live.current.copy(`${row.entry.id}#${row.n}`, row.command)
      return
    }
  }

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    list.current
      ?.querySelector(`[data-help-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, limit])

  const drawn = rows.slice(0, limit)
  const activeId =
    marked && rows[active] ? `help-entry-${rows[active].entry.id}-${rows[active].n}` : undefined

  return (
    <Modal
      shadow={false}
      onCancel={onClose}
      label="Command help"
      focus="input"
      scrim="bg-black/35 backdrop-blur-[6px]"
      scrimAttrs={{ 'data-help-scrim': true }}
      boxAttrs={{ 'data-help-panel': true }}
      boxRef={box}
      onKeyDown={onKey}
      boxStyle={{ width: clampHelpWidth(width) }}
      boxClassName="relative flex h-[min(82vh,680px)] max-w-full flex-col overflow-hidden"
    >
      {grip('left')}
      {grip('right')}
      {/* The question. */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-[color:var(--p-line)] px-4 py-3">
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke="var(--p-dim)"
          strokeWidth="2"
          strokeLinecap="round"
          className="shrink-0"
          aria-hidden
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          ref={input}
          data-help-search
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="help-results"
          aria-activedescendant={activeId}
          aria-label="Search commands. Up and Down move through the results, Enter copies the highlighted command."
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // It teaches by example: what to type is the first thing a
          // newcomer does not know.
          placeholder="Try: find big files, what is using port 3000, undo last commit"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--p-text)] placeholder:text-[var(--p-dim2)] focus:outline-none"
        />
        <button
          type="button"
          data-help-close
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-[var(--p-hover-hi)] hover:text-[var(--p-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)]"
        >
          <svg
            viewBox="0 0 24 24"
            width={13}
            height={13}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      </div>

      {/* Which shell. Git, the agents and the package managers read the same
            in all three, so they are in every list and are not a chip. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[color:var(--p-line)] px-4 py-2">
        <div role="group" aria-label="Shell" className="flex items-center gap-1.5">
          {HELP_SHELLS.map((s) => (
            <button
              key={s.id}
              type="button"
              data-help-shell={s.id}
              aria-pressed={chip === s.id}
              onClick={() => {
                setChip(s.id)
                onPickShell?.(s.id)
                input.current?.focus()
              }}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)] ${
                chip === s.id
                  ? 'border-transparent bg-[var(--p-accent)] text-[var(--p-on-accent)]'
                  : 'border-[color:var(--p-line)] text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1" />
        <span data-help-count role="status" className="shrink-0 text-[11.5px] text-[var(--p-dim)]">
          {searching
            ? rows.length === 0
              ? 'No results'
              : `${rows.length}${rows.length === MAX_RESULTS ? '+' : ''} ${rows.length === 1 ? 'result' : 'results'}`
            : `${rows.length} commands`}
        </span>
      </div>

      {/* The columns, named once. A table's header is what makes two ragged
            columns read as two columns. */}
      <div
        data-help-header
        aria-hidden
        className={`${COLUMNS} shrink-0 border-b border-[color:var(--p-line)] px-4 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--p-dim)]`}
      >
        <span>What you want</span>
        <span>Command</span>
        <span />
      </div>

      {/* The answers. The list scrolls, the popup does not. */}
      <div
        ref={list}
        id="help-results"
        data-help-list
        role="listbox"
        aria-label={searching ? 'Results' : 'All commands'}
        className="p-scroll min-h-0 flex-1 overflow-y-auto"
      >
        {rows.length === 0 && (
          <p
            data-help-empty
            className="px-5 py-8 text-center text-[12.5px] leading-relaxed text-[var(--p-dim)]"
          >
            Nothing matches. Say it another way (what you want to DO, such as "delete a folder"), or
            try another shell.
          </p>
        )}
        {drawn.map((row, i) => {
          const header =
            !searching && (i === 0 || drawn[i - 1].entry.category !== row.entry.category)
          const key = `${row.entry.id}#${row.n}`
          return (
            <div key={key}>
              {header && (
                <h3
                  data-help-category={row.entry.category}
                  className="sticky top-0 z-10 border-b border-[color:var(--p-line)] bg-[var(--p-side-flat)] px-4 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--p-dim)]"
                >
                  {CATEGORY_NAME.get(row.entry.category) ?? row.entry.category}
                </h3>
              )}
              <Row
                row={row}
                index={i}
                active={marked && i === active}
                // The stripe follows the drawn order, so it never restarts
                // under a category heading: the eye reads one ruled table.
                striped={i % 2 === 1}
                failed={copied?.key === key && !copied.ok}
                mono={monoFont}
                onCopy={copy}
                onPoint={() => {
                  setActive(i)
                  setMarked(true)
                }}
              />
            </div>
          )
        })}
        {drawn.length < rows.length && (
          <div ref={sentinel} data-help-more className="h-8" aria-hidden />
        )}
      </div>

      {/* The keys, and nothing else. The sentence that used to sit here -
            "Nothing is typed or run for you: copy a command, then paste it
            yourself" - was REMOVED (owner, 2026-09-20: "remove this line").
            The rule it stated has not changed and is still enforced where it
            matters: this component cannot reach a shell at all, and the e2e
            reads the terminal's text before and after everything it does. */}
      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[color:var(--p-line)] px-4 py-2 text-[11.5px] text-[var(--p-dim)]">
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex" aria-hidden>
          <Key>Up</Key>
          <Key>Down</Key>
          <span>move</span>
          <Key>Enter</Key>
          <span>copy</span>
          <Key>Esc</Key>
          <span>close</span>
        </span>
      </div>
      {/* What a screen reader hears: the visible "Copied" is decoration. */}
      <span data-help-said role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </Modal>
  )
}

function Key({ children }: { children: string }): JSX.Element {
  return (
    <kbd className="rounded border border-[color:var(--p-line)] bg-[var(--p-control)] px-1 py-px font-sans text-[10.5px] font-semibold text-[var(--p-text-soft)]">
      {children}
    </kbd>
  )
}
