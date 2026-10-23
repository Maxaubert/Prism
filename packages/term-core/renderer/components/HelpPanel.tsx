import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { hiddenTitle } from '../lib/hiddenTitle'
import {
  ALL_HELP,
  HELP_CATEGORIES,
  HELP_SHELLS,
  blankless,
  isKeyPress,
  shownIn,
  variantsIn,
  type HelpEntry,
  type HelpShellChoice
} from '../../shared/help/index'
import { searchHelp } from '../../shared/help/search'
import { clampHelpWidth, HELP_WIDTH, setHelpWidth, useHelpWidth } from '../lib/helpPrefs'

/**
 * COMMAND HELP (#12), A SIDE PANEL SINCE #199. Owner, 2026-09-19: "an easy to
 * use panel where you can find shell commands to use the shell more
 * effectively... searchable... metadata on each command so a natural-language
 * search finds it", and on 2026-09-20: "a pop up with copy icons for easy
 * copying". Then 2026-10-13 (#199): "instead of being a pop-up window ... a
 * sidebar that animates from the side ... and overlays over the terminal, like
 * not the whole terminal", the way Copilot Studio and Power Automate open a
 * pane. The mockups are `docs/research/2026-10-13-help-panel/`; the owner
 * settled on the sheet with two columns (A2). One copy, for both apps.
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
 * WHAT IS COPIED IS THE TEXT ON SCREEN. A blank at the END of a command is not
 * drawn (owner, 2026-10-13: "dont say folder the user understand"): the row
 * reads `Set-Location ` and the copy ends in that space, so the paste is ready
 * for the folder. A blank in the MIDDLE is still drawn, since leaving it out
 * would make another command (`blankless`).
 *
 * NOT A DIALOG: the terminal stays where it is, readable and usable beside the
 * panel, and the panel stays open across a click into the shell. It is drawn
 * by the host inside the terminal's region, under the title bar.
 *
 * Props only, like the update window: no bridge, no store, no host. The
 * clipboard is handed in because each host has its own way to it. It sits on
 * the OPAQUE surface token (`--p-side-flat`): `--p-bg` carries the window's
 * alpha under See-through, and nobody can read a command through the desktop.
 */

/** How many entries are drawn at first, and how many more each time the end
 *  of the list comes into view. The catalogue is a few hundred entries with
 *  several rows each: all at once is thousands of nodes built before the first
 *  frame, for a list nobody has scrolled yet. */
const FIRST_PAGE = 40
const NEXT_PAGE = 60
/** A search answers with at most this many. Past the first dozen nobody is
 *  reading; they are retyping. */
const MAX_RESULTS = 50
/** How long a row's copy button wears its check. */
const COPIED_MS = 1400
/** The slide (owner, 2026-10-13: "it has to have animation"): in on a long
 *  exponential ease-out; out quicker, on a curve that MOVES AT ONCE (owner,
 *  2026-10-13: the close "hitches before the closing animation starts"). An
 *  ease-in sat still for its first frames, and the rows fading as it began
 *  read as the hitch, so the rows now stay put until the panel is out. */
const IN_MS = 460
const OUT_MS = 220
const OUT_EASE = 'cubic-bezier(0.4,0,0.6,1)'

const CATEGORY_NAME = new Map(HELP_CATEGORIES.map((c) => [c.id, c.name]))

/**
 * ONE COMMAND IS ONE ROW (#12, owner 2026-09-20: "it just needs the header and
 * the command"). An entry is FLATTENED: its own row is named by its task, and
 * each variant is a row of its own named by its label. Nothing is hidden from
 * SEARCH by this: `searchHelp` still reads the summary, the keywords and the
 * placeholders off the entry.
 */
export interface HelpRow {
  entry: HelpEntry
  /** 0 is the entry's own command, 1+ its variants. Names the copy button. */
  n: number
  /** The left column. */
  name: string
  /** What is shown and copied (`blankless`). */
  command: string
}

/** The list in the order it is drawn, which is the order Up and Down walk. */
function rowsFor(shell: HelpShellChoice, query: string): HelpRow[] {
  const entries =
    query.trim() !== ''
      ? searchHelp(ALL_HELP, query, { shell, limit: MAX_RESULTS }).map((h) => h.entry)
      : // Browsing: by category, in the panel's own order, catalogue order within.
        HELP_CATEGORIES.flatMap((c) => {
          const mine = ALL_HELP.filter((e) => shownIn(e.shell, shell))
          return mine.filter((e) => e.category === c.id)
        })
  return entries.flatMap((entry) => {
    const names = Object.keys(entry.placeholders ?? {})
    return [
      { entry, n: 0, name: entry.task, command: blankless(entry.command, names) },
      // Only the rows of this shell. `n` counts every variant, so a copy
      // button names the same row whichever shell it is drawn in.
      ...(entry.variants ?? []).flatMap((v, i) =>
        variantsIn([v], shell).length
          ? [{ entry, n: i + 1, name: v.label, command: blankless(v.command, names) }]
          : []
      )
    ]
  })
}

const CopyIcon = ({ shown }: { shown: boolean }): JSX.Element => (
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
    className={`col-start-1 row-start-1 transition-[transform,opacity] duration-200 ease-out ${shown ? '' : 'rotate-[-12deg] scale-[.55] opacity-0'}`}
  >
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
)

/** The check a copied row's button turns into: it draws itself. */
const CheckIcon = ({ shown }: { shown: boolean }): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={17}
    height={17}
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    data-help-check={shown || undefined}
    className={`col-start-1 row-start-1 transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${shown ? '' : 'scale-[.6] opacity-0'}`}
  >
    <path
      d="M5 12.5l4.5 4.5L19 7.5"
      strokeDasharray={22}
      strokeDashoffset={shown ? 0 : 22}
      style={{ transition: 'stroke-dashoffset 340ms cubic-bezier(0.16,1,0.3,1) 60ms' }}
    />
  </svg>
)

/**
 * ONE ROW, TWO COLUMNS (owner, 2026-10-13, A2 of the mockups): what you want
 * on the left, wrapping to two lines at most; the command on the right in a
 * quiet recessed block of the terminal's own face, its copy button inside the
 * block. The WHOLE ROW copies (owner: "the whole row should be clickable to
 * copy not just the icon"). Square corners and a stripe on every other row
 * (owner: "have the rows alternate like before"), the stripe a step up from
 * the panel, a hover a step more and the keyboard's row most, so the three
 * never read as the same grey (owner: "the alternation colour cant be the same
 * as the highlight colour"). No warning badge (owner: "remove warning labels
 * and similar tags"): the entry's danger sentence is still the screen
 * reader's and the pointer's.
 */
/** How far a press may travel and still be a click, not a drag. */
const DRAG_PX = 4

function Row({
  row,
  index,
  active,
  striped,
  copied,
  failed,
  mono,
  open,
  onCopy,
  onPoint
}: {
  row: HelpRow
  index: number
  active: boolean
  striped: boolean
  copied: boolean
  failed: boolean
  mono: string
  open: boolean
  onCopy: (key: string, command: string) => void
  onPoint: () => void
}): JSX.Element {
  const key = `${row.entry.id}#${row.n}`
  const keys = isKeyPress(row.command)
  // Where this row's press began, to tell a click from a drag.
  const down = useRef<{ x: number; y: number } | null>(null)
  const fill = active
    ? 'bg-[color-mix(in_srgb,var(--p-text)_13%,transparent)]'
    : striped
      ? 'bg-[color-mix(in_srgb,var(--p-text)_4%,transparent)] hover:bg-[color-mix(in_srgb,var(--p-text)_9%,transparent)]'
      : 'hover:bg-[color-mix(in_srgb,var(--p-text)_9%,transparent)]'
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
      onMouseDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY }
        onPoint()
      }}
      onClick={(e) => {
        // A DRAG IS A SELECTION, NOT A CLICK: it copies nothing (owner,
        // 2026-10-13: "you can drag to select"), as when it starts in the
        // command and ends on the row's name. Judged by THIS press moving,
        // never by a selection being there: one left over from selecting a
        // command blocked every later click on every row (owner, 2026-10-14:
        // "clicking here doesnt copy anymore").
        const d = down.current
        down.current = null
        if (keys || (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG_PX)) return
        window.getSelection()?.removeAllRanges()
        onCopy(key, row.command)
      }}
      // The rows rise in after the panel lands, a few at a time.
      // Rising in, a few at a time; going out, they stay as they are and are
      // reset only once the panel is out of sight, ready for the next rise.
      style={
        open
          ? { transitionDelay: `${Math.min(index, 12) * 18 + 120}ms` }
          : { transitionDuration: '0ms', transitionDelay: `${OUT_MS}ms` }
      }
      className={`group grid min-h-[36px] grid-cols-[minmax(0,.85fr)_minmax(0,1.25fr)] items-center gap-3.5 px-4 py-[3px] transition-[background-color,opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
        keys ? 'cursor-default' : 'cursor-pointer'
      } ${open ? '' : 'translate-y-1.5 opacity-0'} ${fill}`}
    >
      <span
        data-help-task
        className="line-clamp-2 min-w-0 select-none text-[12.5px] leading-[1.3] text-[var(--p-text)]"
        {...hiddenTitle(row.name)}
      >
        {row.name}
        {row.entry.danger && <span className="sr-only">. Careful. {row.entry.danger}</span>}
      </span>
      {keys ? (
        // A key to press is drawn as key caps and copies nothing: the
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
        <span
          data-help-well
          // INSIDE THE WELL A CLICK IS FOR SELECTING, NOT COPYING (owner,
          // 2026-10-14: "if i click inside the box with the command i have to
          // click the copy icon ... im probably trying to select the text"):
          // the rest of the row copies; here only the copy button does.
          onClick={(e) => e.stopPropagation()}
          // A quiet well (owner: "the fields stand out too much"): a shade
          // darker than the panel, fainter still on a light theme, where the
          // same black reads as a grey slab.
          className={`flex min-w-0 cursor-text items-center gap-1.5 rounded-[6px] border bg-[color-mix(in_srgb,black_16%,transparent)] py-px pl-2.5 pr-px transition-colors [[data-mode=light]_&]:bg-[color-mix(in_srgb,black_4%,transparent)] ${
            active ? 'border-[color:var(--p-line)]' : 'border-transparent group-hover:border-[color:var(--p-line)]'
          }`}
        >
          {/* The command is text to select (owner, 2026-10-13): the text
              cursor over it, and the selection in the accent. */}
          <code
            data-help-command
            className="min-w-0 flex-1 cursor-text select-text truncate text-[12.5px] leading-[1.5] text-[var(--p-text)] selection:bg-[color-mix(in_srgb,var(--p-accent)_45%,transparent)] selection:text-[var(--p-text)]"
            style={{ fontFamily: mono }}
            {...hiddenTitle(row.command)}
          >
            {row.command}
          </code>
          <button
            type="button"
            data-help-copy={key}
            data-help-copied={copied || undefined}
            onClick={(e) => {
              e.stopPropagation()
              onCopy(key, row.command)
            }}
            title={failed ? 'Could not copy' : copied ? 'Copied' : 'Copy'}
            aria-label={`Copy: ${row.command}`}
            className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)] ${
              failed
                ? 'text-[#e0a100]'
                : copied
                  ? 'bg-[color-mix(in_srgb,#8fd47a_16%,transparent)] text-[#8fd47a]'
                  : 'text-[var(--p-icon)] hover:bg-[var(--p-hover-hi)] hover:text-[var(--p-text)]'
            }`}
          >
            {/* THE COPY ICON TURNS INTO A CHECK (owner, 2026-10-13: "when you
                click the copy key, that copy icon should turn into a
                checkmark"): said here, on the row, in place of the app's
                "Copied" badge, so a success is said once. */}
            <span className="grid">
              <CopyIcon shown={!copied} />
              <CheckIcon shown={copied} />
            </span>
          </button>
        </span>
      )}
    </div>
  )
}

export default function HelpPanel({
  open,
  shell,
  monoFont,
  onCopy,
  onPickShell,
  onClose
}: {
  /** In or out. The host keeps the panel mounted once it has been opened, so
   *  it can slide out as well as in. */
  open: boolean
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
  const box = useRef<HTMLElement>(null)
  // HOW WIDE IT IS, DRAGGED by its left edge (owner, 2026-09-20: "you also
  // need to be able to adjust the width of this since some text can be seen").
  // The edge draws nothing (owner, 2026-10-13, of the grip line: "remove it");
  // the pointer turns to the resize arrow over it. Remembered per app.
  const width = useHelpWidth()
  const drag = useRef<{ x: number; from: number } | null>(null)
  const onGrab = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    drag.current = { x: e.clientX, from: box.current?.getBoundingClientRect().width ?? width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    // Anchored at the right, so the left edge follows the pointer one to one.
    setHelpWidth(d.from + (d.x - e.clientX))
  }
  const onDrop = (e: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  /** The keyboard's way to the same thing, on a focused edge. */
  const onGripKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    const step = (e.key === 'ArrowLeft' ? 1 : -1) * (e.shiftKey ? 80 : 20)
    setHelpWidth((box.current?.getBoundingClientRect().width ?? width) + step)
  }
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const sentinel = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<HelpShellChoice>(shell)
  const [active, setActive] = useState(0)
  /**
   * NOTHING IS MARKED UNTIL THE KEYBOARD WALKS THE LIST (owner, 2026-09-20: "no
   * highlighted ones", and 2026-10-13 of a row marked from the start: "why is
   * this row always highlighted"). The cursor still EXISTS from the first row,
   * so one Down marks it and Enter copies it; the pointer moving over the list
   * takes the mark away again, so only the row under it is lit.
   */
  const [marked, setMarked] = useState(false)
  const [limit, setLimit] = useState(FIRST_PAGE)
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null)
  /** What a screen reader is told. Its own state, since two copies of the same
   *  command must both be announced and an unchanged string is not. */
  const [said, setSaid] = useState('')

  // Each opening starts on the shell in front, at the top, with an empty
  // question, as the popup did when it was mounted afresh: what was asked
  // before is somebody else's moment.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) {
      setChip(shell)
      setQuery('')
      setActive(0)
      setMarked(false)
    }
  }
  useEffect(() => {
    if (!open) return
    // After the first frame of the slide, so the field is there to focus.
    const t = setTimeout(() => input.current?.focus({ preventScroll: true }), 60)
    return () => clearTimeout(t)
  }, [open])

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
        setSaid(ok ? `Copied ${command}` : 'Could not copy to the clipboard')
      })
  }
  // The check leaves by itself. Keyed on the OBJECT, so copying the same row
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

  const onKey = (e: React.KeyboardEvent): void => {
    // Chords are the host's (new tab, close tab, Settings...): they keep
    // working over the panel, and none of them is read here.
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'PageDown' || e.key === 'PageUp') {
      if (!rows.length) return
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? 5 : -5
      // The first press MARKS where the cursor already is rather than
      // stepping off it: with nothing drawn, "move down" from nowhere means
      // the top of the list.
      const next = marked ? Math.max(0, Math.min(rows.length - 1, active + step)) : active
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
      // On a button, Enter is that button's own press (a chip, a row's copy,
      // Close). Anywhere else it copies the highlighted entry.
      if ((e.target as HTMLElement | null)?.closest('button')) return
      e.preventDefault()
      e.stopPropagation()
      const row = rows[active]
      if (!row) return
      if (isKeyPress(row.command)) setSaid(`${row.command} is a key to press, not text to copy`)
      else copy(`${row.entry.id}#${row.n}`, row.command)
    }
  }

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    list.current?.querySelector(`[data-help-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, limit])

  const drawn = rows.slice(0, limit)
  const activeId =
    marked && rows[active] ? `help-entry-${rows[active].entry.id}-${rows[active].n}` : undefined

  return (
    <aside
      ref={box}
      data-help-panel
      data-help-open={open || undefined}
      aria-label="Command help"
      aria-hidden={!open}
      // Out, it takes no keys and no clicks, and is not read.
      inert={!open}
      onKeyDown={onKey}
      style={{
        width: clampHelpWidth(width),
        transform: open ? 'none' : 'translateX(104%)',
        visibility: open ? 'visible' : 'hidden',
        transition: open
          ? `transform ${IN_MS}ms cubic-bezier(0.16,1,0.3,1), visibility 0s`
          : `transform ${OUT_MS}ms ${OUT_EASE}, visibility 0s ${OUT_MS}ms`
      }}
      className="no-drag absolute inset-y-0 right-0 z-30 flex max-w-[calc(100%-120px)] flex-col border-l border-[color:var(--p-divider)] bg-[var(--p-side-flat)] text-[var(--p-text)] shadow-[-18px_0_40px_-18px_rgba(0,0,0,.65)] motion-reduce:!transition-none"
    >
      {/* The left edge resizes. It draws nothing (owner: "remove it"). */}
      <div
        data-help-grip="left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Panel width"
        aria-valuenow={width}
        aria-valuemin={HELP_WIDTH.min}
        aria-valuemax={HELP_WIDTH.max}
        tabIndex={0}
        onPointerDown={onGrab}
        onPointerMove={onDrag}
        onPointerUp={onDrop}
        onPointerCancel={onDrop}
        onKeyDown={onGripKey}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-ew-resize focus-visible:outline-none"
      />

      <div className="flex shrink-0 flex-col gap-2.5 px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 select-none text-[14.5px] font-semibold text-[var(--p-text)]">Command help</h2>
          <button
            type="button"
            data-help-close
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-[var(--p-hover-hi)] hover:text-[var(--p-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)]"
          >
            <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M7 7l10 10M17 7L7 17" />
            </svg>
          </button>
        </div>
        {/* The question. */}
        <label className="flex h-9 items-center gap-2.5 rounded-[8px] border border-[color:var(--p-line)] bg-[color-mix(in_srgb,black_14%,transparent)] px-3 [[data-mode=light]_&]:bg-[color-mix(in_srgb,black_3%,transparent)] transition-[border-color,box-shadow] focus-within:border-[color:var(--p-accent-hi)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--p-accent)_16%,transparent)]">
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="var(--p-dim)" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden>
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
            placeholder="Try: find big files, what is using port 3000"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[var(--p-text)] caret-[var(--p-accent)] placeholder:text-[var(--p-dim2)] focus:outline-none"
          />
        </label>
        {/* Which shell. Git, the agents and the package managers read the same
            in all three, so they are in every list and are not a chip. */}
        <div className="flex items-center gap-1.5">
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
                className={`select-none rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--p-accent-hi)] ${
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
          <span data-help-count role="status" className="shrink-0 select-none text-[11.5px] tabular-nums text-[var(--p-dim)]">
            {searching
              ? rows.length === 0
                ? 'No results'
                : `${rows.length}${rows.length === MAX_RESULTS ? '+' : ''} ${rows.length === 1 ? 'result' : 'results'}`
              : `${rows.length} commands`}
          </span>
        </div>
      </div>

      {/* The answers. The list scrolls, the panel does not. */}
      <div
        ref={list}
        id="help-results"
        data-help-list
        role="listbox"
        aria-label={searching ? 'Results' : 'All commands'}
        onMouseMove={() => {
          if (marked) setMarked(false)
        }}
        className="p-scroll min-h-0 flex-1 overflow-y-auto pb-2"
      >
        {rows.length === 0 && (
          <p data-help-empty className="px-5 py-8 text-center text-[12.5px] leading-relaxed text-[var(--p-dim)]">
            Nothing matches. Say it another way (what you want to DO, such as "delete a folder"), or try another
            shell.
          </p>
        )}
        {drawn.map((row, i) => {
          const header = !searching && (i === 0 || drawn[i - 1].entry.category !== row.entry.category)
          const key = `${row.entry.id}#${row.n}`
          return (
            <div key={key}>
              {header && (
                // Headings are not text to select (owner, 2026-10-13).
                <h3
                  data-help-category={row.entry.category}
                  className="sticky top-0 z-10 cursor-default select-none bg-[var(--p-side-flat)] px-4 pb-1.5 pt-3.5 text-[11.5px] font-semibold text-[var(--p-dim)]"
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
                copied={copied?.key === key && copied.ok}
                failed={copied?.key === key && !copied.ok}
                mono={monoFont}
                open={open}
                onCopy={copy}
                onPoint={() => setActive(i)}
              />
            </div>
          )
        })}
        {drawn.length < rows.length && <div ref={sentinel} data-help-more className="h-8" aria-hidden />}
      </div>

      {/* The keys, and nothing else. */}
      <div className="flex shrink-0 select-none items-center justify-end gap-3 border-t border-[color:var(--p-line)] px-4 py-2 text-[11.5px] text-[var(--p-dim)]">
        <span className="flex shrink-0 items-center gap-1.5" aria-hidden>
          <Key>Up</Key>
          <Key>Down</Key>
          <span>move</span>
          <Key>Enter</Key>
          <span>copy</span>
          <Key>Esc</Key>
          <span>close</span>
        </span>
      </div>
      {/* What a screen reader hears: the check on the row is for the eye. */}
      <span data-help-said role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </aside>
  )
}

function Key({ children }: { children: string }): JSX.Element {
  return (
    <kbd className="rounded border border-[color:var(--p-line)] bg-[var(--p-control)] px-1 py-px font-sans text-[10.5px] font-semibold text-[var(--p-text-soft)]">
      {children}
    </kbd>
  )
}
