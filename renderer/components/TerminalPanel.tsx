import { useEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { Terminal, type IBufferRange } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { decidePaste, imagePasteKey, newlineKey, sanitizePaste, type PathShell } from '../lib/termPaste'
import { armAtStart, armOnPoll, armOnPrompt, armOnTitle, type ArmStep } from '../lib/agentArm'
import { shellOfShellId } from '../../shared/help/shells'
import {
  onResumingChange,
  registerPaste,
  reportAgentSignal,
  reportCwd,
  reportTermKey,
  reportTitle,
  resumingIds,
  setResuming,
  setScreenTail,
  setTextPaster
} from '../lib/termBus'
import {
  CLEAR,
  agentOfResume,
  onAlternate,
  onChunk,
  onTick,
  revealNow,
  startReveal,
  type RevealState
} from '../lib/resumeReveal'
import { ResumeSkeleton } from './ResumeSkeleton'
import { parseOsc9 } from '../../shared/termCwd'
import { parseAgentSignal } from '../lib/agentHookSignal'
import { resolveTermTheme, watchTermTheme } from '../lib/termTheme'
import { onGround } from '../lib/termGround'
import { xtermTheme, type XtermTheme } from '../lib/termXterm'
import {
  THEME_REPORTS_OFF,
  bellGate,
  colourQueryReplies,
  decrqmReply,
  dsrThemeReply,
  groundMode,
  modeParams,
  nudgeWidths,
  NUDGE_AFTER_MS,
  NUDGE_HOLD_MS,
  noteThemeMode,
  themePush,
  themeReports,
  xtversionAsked,
  xtversionReply,
  type GroundMode
} from '../lib/termReplies'
import { TERM_CORE_VERSION, XTERM_VERSION } from '../../shared/termVersion'
import { OSC52_MAX, parseOsc52 } from '../lib/termOsc52'
import { followsHostStyle, paintsGround, termApi, termHost } from '../host'
import { findLinks, linkColor } from '../lib/termLinks'
import { announceCopied, copyText } from '../lib/copyNotice'
import { arrowKeys, caretClickAllowed, caretDelta, type ClickGate } from '../lib/termClickCaret'
import {
  linkAt,
  selectionDeleteAllowed,
  selectionDeleteKeys,
  type SelectionGate
} from '../lib/termSelectionEdit'
import { attachLinkPaint, type LinkPainter } from '../lib/termLinkPaint'
import { knownPath, linkRanges, onPathsFound, pathCandidates, takeAsked, type PathHit } from '../lib/termPathLinks'
import {
  initialCaretHold,
  onCaretKey,
  onCaretMove,
  releaseCaretHold,
  type CaretPos
} from '../lib/termCaretHold'
import { cellFrom, cellText, type CellInfo } from '../lib/termCells'
import { bufferRowCells, isWebLink, osc8Target, Osc8Spans, parseOsc8, spanText, type SpanAnchor } from '../lib/termOsc8'
import {
  onTermLookChange,
  termBaseFontPx,
  agentHooksOn,
  termAcrylic,
  termFontStack,
  termThemeId
} from '../lib/termLook'
import {
  forgetSession,
  looksTyped,
  markPrompt,
  markTouched,
  suppressActivity,
  takeResume
} from '../lib/termActivity'
import '@xterm/xterm/css/xterm.css'

// The terminal surface. This module is a lazy chunk (xterm is ~350KB the
// launch path never needs) and it owns the SESSION STORE: one live xterm
// instance per shell, each with its own DOM element, living in module scope
// because their lifetime is the shell's, not any component's. Switching tabs
// reattaches an element instead of repainting, which is what keeps scrollback,
// selection and the alternate screen (vim, htop) intact for free.

interface Session {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  /** Paints the links in the buffer; told when the colours change. */
  links: LinkPainter
  el: HTMLDivElement
  unsub: Array<() => void>
  /** Ctrl+scroll zoom, this session only: never persisted, dies with it. */
  fontOverride?: number
  /** The folder the shell is in: where it started, then what its prompt
   *  last reported. A relative path on screen is relative to it (#99). */
  cwd(): string
  /** The look changed to this mode: tell the program, if it asked (#172). */
  tellTheme(mode: GroundMode): void
  /** The uri of the OSC 8 link over buffer cell (`line`, `x`) of the screen in
   *  front, while it still stands (#169). */
  oscLink(line: number, x: number): string | null
}

const sessions = new Map<string, Session>()

/** The theme on the ground the panel really paints (the host's pick, if any).
 *  A Custom's see-through colours are composited against that ground (#112). */
const groundedTheme = (): ReturnType<typeof resolveTermTheme> => {
  const ground = termHost().terminalGround?.()
  return onGround(resolveTermTheme(termThemeId(), ground), ground)
}

/** What a link wears on the theme in force: blue, moved as far as this
 *  ground (a preset's, or one the user picked) needs for it to read. */
function currentLinkColor(): string {
  const theme = groundedTheme()
  return linkColor(theme.background, theme.foreground)
}

/** The theme as painted, in the form xterm takes (lib/termXterm). */
function currentTermTheme(): XtermTheme {
  return xtermTheme(groundedTheme(), {
    paintsGround: paintsGround(),
    // The HOST paints behind the panel (Prism's dock does), so the canvas
    // carries the ground as it always did there: clear only when the terminal
    // is following an acrylic style, so the window's material shows through.
    clearGround: termThemeId() === 'style' && termAcrylic()
  })
}

/**
 * Resize xterm to its box, carrying the CURSOR LINE across (2026-09-04).
 *
 * ConPTY - node-pty's bundled dll, which Prism must use because the inbox
 * conhost fast-fails the app when a pty dies mid-read - sends NOTHING on a
 * resize. MEASURED: 0 bytes narrower and 0 bytes wider, where the inbox
 * conhost repaints the whole screen (339 bytes). It reflows its own buffer
 * and expects the terminal to do the same; xterm does, for every line
 * EXCEPT the one holding the cursor, on the Unix assumption that the shell
 * redraws its own line on SIGWINCH. Nobody redraws it here, so the prompt
 * was cut at the narrower width and stayed cut once widened again, and a
 * keystroke then landed at ConPTY's idea of the column: "PS C:\" and the
 * tail of the path with blank columns between (owner screenshot; Ctrl+L put
 * it right). So the logical line under the cursor - its wrapped rows joined
 * - is read BEFORE the resize and written back AFTER it through xterm's own
 * parser, which wraps it exactly as ConPTY's buffer does, and the cursor is
 * put back at the same character. Only when that line is the LAST thing in
 * the buffer, which is a prompt; lines below it would be moved by ConPTY
 * too and cannot be followed from here. The alternate screen is left alone:
 * a TUI owns every cell and repaints itself.
 */
function fitKeepingCursorLine(term: Terminal, fit: FitAddon): void {
  const b = term.buffer.active
  if (b.type !== 'normal') {
    fit.fit()
    return
  }
  const oldCols = term.cols
  const y = b.baseY + b.cursorY
  const { first, last, index, text: whole, textEnd } = logicalLine(term, y)
  // Everything up to the last printed cell, and where the cursor is, both in
  // CELLS (#20): the cursor goes back by cells, never by string length.
  const text = whole.slice(0, index[textEnd])
  const offset = (y - first) * oldCols + b.cursorX
  let tail = false
  for (let i = last + 1; i < b.length && !tail; i += 1)
    if ((b.getLine(i)?.translateToString(true) ?? '').length) tail = true
  fit.fit()
  if (term.cols === oldCols || tail || !text.length) return
  const row = first - b.baseY
  if (row < 0 || row >= term.rows) return
  // Home to the line's first row, erase it and everything below, write the
  // line back (xterm wraps it at the new width), then put the cursor on the
  // same character - read after the write lands, since a long line can
  // scroll the buffer while it is being laid out.
  term.write(`\x1b[${row + 1};1H\x1b[J${text}`, () => {
    const nb = term.buffer.active
    const end = nb.baseY + nb.cursorY
    // Walk the cursor back over the wrapped rows just written, or forward
    // when it sat past the last printed cell (a prompt's trailing space).
    const at = cellFrom(end, nb.cursorX, textEnd - offset, term.cols)
    term.write(`\x1b[${Math.max(0, at.row - nb.baseY) + 1};${at.col + 1}H`)
  })
}

/**
 * CLICK TO PUT THE CARET THERE (owner, 2026-09-22). A plain click on the line
 * being edited sends the Left or Right presses that walk the shell's cursor to
 * the cell clicked; every other click (a drag, a double click, a link, a
 * program that owns the mouse, old output, a full-screen program) is left
 * exactly as it was. The rules are `termClickCaret`'s, pure and tested; this
 * only reads the event and the buffer into them. Returns the disposer.
 */
function attachClickCaret(
  term: Terminal,
  el: HTMLElement,
  id: string,
  oscLinkAt: (line: number, x: number) => boolean
): () => void {
  // DECTCEM, followed from the stream: xterm keeps whether the cursor is
  // hidden to itself. Returning false lets xterm apply it as always.
  let cursorHidden = false
  const cursorMode = (hidden: boolean) => (params: (number | number[])[]): boolean => {
    if (params.some((p) => p === 25)) {
      cursorHidden = hidden
      hiddenCursor.set(id, hidden)
    }
    return false
  }
  const show = term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, cursorMode(false))
  const hide = term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, cursorMode(true))
  let down: { x: number; y: number } | null = null
  const onDown = (e: MouseEvent): void => {
    down = { x: e.clientX, y: e.clientY }
  }
  const onUp = (e: MouseEvent): void => {
    const from = down
    down = null
    if (!from) return
    const screen = term.element?.querySelector<HTMLElement>('.xterm-screen')
    if (!screen) return
    const r = screen.getBoundingClientRect()
    const cellW = r.width / term.cols
    const cellH = r.height / term.rows
    // Read after xterm has finished with the same mouseup: a drag's selection
    // is only final once its own handler has run.
    setTimeout(() => {
      const b = term.buffer.active
      const col = Math.max(0, Math.min(term.cols, Math.round((e.clientX - r.left) / cellW)))
      const row = Math.floor((e.clientY - r.top) / cellH)
      const y = b.baseY + b.cursorY
      const { first, last, widths, text, textEnd, index } = logicalLine(term, y)
      const clicked = b.viewportY + row
      let textBelow = false
      for (let i = last + 1; i < b.length && !textBelow; i += 1)
        if ((b.getLine(i)?.translateToString(true) ?? '').length) textBelow = true
      const target = (clicked - first) * term.cols + col
      // The clicked cell's place in the TEXT (#25), where findLinks counts.
      const charAt = index[Math.min(Math.max(0, target), index.length - 1)]
      const gate: ClickGate = {
        button: e.button,
        detail: e.detail,
        modifiers: e.shiftKey || e.altKey || e.ctrlKey || e.metaKey,
        dragged: Math.hypot(e.clientX - from.x, e.clientY - from.y) > cellW / 2 || term.hasSelection(),
        mouseTracking: term.modes.mouseTrackingMode,
        alternate: b.type !== 'normal',
        scrolledBack: b.viewportY !== b.baseY,
        cursorHidden,
        textBelow,
        offLine: clicked < first || clicked > last,
        // An OSC 8 label is a link too, though its text is not one (review
        // 2026-10-11: a click on a prompt's linked git segment opened it AND
        // walked the caret).
        onLink:
          findLinks(text).some((l) => charAt >= l.start && charAt < l.end) ||
          oscLinkAt(clicked, Math.floor((e.clientX - r.left) / cellW))
      }
      if (!caretClickAllowed(gate)) return
      const keys = arrowKeys(
        caretDelta(widths, (y - first) * term.cols + b.cursorX, target, textEnd),
        term.modes.applicationCursorKeysMode
      )
      if (!keys) return
      markTouched(id)
      termApi().termInput(id, keys)
    }, 0)
  }
  el.addEventListener('mousedown', onDown, true)
  el.addEventListener('mouseup', onUp, true)
  return () => {
    show.dispose()
    hide.dispose()
    el.removeEventListener('mousedown', onDown, true)
    el.removeEventListener('mouseup', onUp, true)
  }
}

/** Whether each session's program has hidden the cursor (DECTCEM), followed
 *  by `attachClickCaret` for the selection delete as well. */
const hiddenCursor = new Map<string, boolean>()

/** The LOGICAL line holding buffer row `y`: its first and last rows across
 *  wraps, every cell's width, the joined text, and the cell just past the
 *  last printed one. */
function logicalLine(term: Terminal, y: number): {
  first: number
  last: number
  widths: number[]
  text: string
  /** Cell -> where its text starts in `text` (termCells). */
  index: number[]
  textEnd: number
} {
  const b = term.buffer.active
  let first = y
  while (first > 0 && b.getLine(first)?.isWrapped) first -= 1
  let last = y
  while (last + 1 < b.length && b.getLine(last + 1)?.isWrapped) last += 1
  const cells: CellInfo[] = []
  for (let i = first; i <= last; i += 1) {
    const line = b.getLine(i)
    for (let x = 0; x < term.cols; x += 1) {
      const cell = line?.getCell(x)
      cells.push({ chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 })
    }
  }
  const { text, index, textEnd } = cellText(cells)
  return { first, last, widths: cells.map((c) => c.width), text, index, textEnd }
}

/** The web address SHOWN over an OSC 8 link's cells (xterm's range: 1-based,
 *  one row, the end cell included), read across the whole logical line so a
 *  shown address that wraps still counts. */
function shownLinkOver(term: Terminal, range: IBufferRange): string | null {
  const line = logicalLine(term, range.start.y - 1)
  const charOf = (p: { x: number; y: number }): number =>
    line.index[Math.min(Math.max(0, (p.y - 1 - line.first) * term.cols + p.x - 1), line.index.length - 1)]
  const from = charOf(range.start)
  const to = charOf(range.end)
  const hit = findLinks(line.text).find((l) => l.start <= to && l.end > from)
  return hit ? line.text.slice(hit.start, hit.end) : null
}

/**
 * BACKSPACE (or Delete) OVER A SELECTION deletes it (owner, 2026-09-23), when
 * the selection sits on the line being edited at a quiet prompt; the rules and
 * the presses are `termSelectionEdit`'s. Returns whether it acted, so the key
 * handler knows to swallow the key; anywhere else Backspace is the shell's.
 */
function deleteSelection(term: Terminal, id: string): boolean {
  const range = term.getSelectionPosition()
  if (!range) return false
  const b = term.buffer.active
  const y = b.baseY + b.cursorY
  const line = logicalLine(term, y)
  let textBelow = false
  for (let i = line.last + 1; i < b.length && !textBelow; i += 1)
    if ((b.getLine(i)?.translateToString(true) ?? '').length) textBelow = true
  // xterm reports the range 0-based with the end exclusive, whatever its
  // typings say (MEASURED in the `selectionDelete` e2e).
  const inLine = (row: number): boolean => row >= line.first && row <= line.last
  const gate: SelectionGate = {
    mouseTracking: term.modes.mouseTrackingMode,
    alternate: b.type !== 'normal',
    scrolledBack: b.viewportY !== b.baseY,
    cursorHidden: hiddenCursor.get(id) ?? false,
    textBelow,
    onLine: inLine(range.start.y) && inLine(range.end.y)
  }
  if (!selectionDeleteAllowed(gate)) return false
  const at = (p: { x: number; y: number }): number => (p.y - line.first) * term.cols + p.x
  const keys = selectionDeleteKeys(
    line.widths,
    (y - line.first) * term.cols + b.cursorX,
    at(range.start),
    at(range.end),
    line.textEnd,
    term.modes.applicationCursorKeysMode
  )
  term.clearSelection()
  if (!keys) return true
  markTouched(id)
  termApi().termInput(id, keys)
  return true
}

/**
 * WHAT A RIGHT-CLICK LANDED ON, for the host's menu (owner, 2026-09-23: "if i
 * click it on a link it shows copy link, if i click it with text marked it
 * says copy"): the selection's text, and the link under the point (whole, even
 * when it wraps). Read-only; a host that has no session by that id gets nothing.
 */
// The last rows of a session's screen that hold text, for the question
// indicator, which reads them through termBus rather than importing this
// module. The LAST TEXT, not the bottom of the screen: in a fresh terminal, and
// under Claude's inline renderer, what was drawn last sits above empty rows.
setScreenTail((id, rows) => {
  const s = sessions.get(id)
  if (!s) return []
  const b = s.term.buffer.active
  let last = b.length - 1
  while (last > 0 && !(b.getLine(last)?.translateToString(true) ?? '').trim()) last -= 1
  const out: string[] = []
  for (let y = Math.max(0, last - rows + 1); y <= last; y += 1) out.push(b.getLine(y)?.translateToString(true) ?? '')
  return out
})

export interface TermPathAt extends PathHit {
  /** As written on screen, which is what main resolves again on a click. */
  text: string
}

/** The path, known to exist, that covers character `at` of `text`. */
function pathAt(text: string, at: number, cwd: string): TermPathAt | null {
  for (const c of pathCandidates(text)) {
    if (at < c.start || at >= c.end) continue
    const hit = knownPath(cwd, c.path)
    return hit ? { ...hit, text: c.path } : null
  }
  return null
}

/**
 * OPEN A PATH FROM THE TERMINAL (#99): the host's own way first (Prism opens
 * files inside Prism), else main's: the file's own app, a folder in Explorer,
 * anything runnable only SHOWN in Explorer.
 */
export function openTermPath(id: string, target: TermPathAt, mode: 'open' | 'reveal'): void {
  const s = sessions.get(id)
  if (!s) return
  if (termHost().openPath?.({ abs: target.abs, kind: target.kind, mode })) return
  termApi().termOpenPath?.(s.cwd(), target.text, mode)
}

export function termContextAt(
  id: string,
  clientX: number,
  clientY: number
): { selection: string; link: string | null; path: TermPathAt | null } {
  const s = sessions.get(id)
  if (!s) return { selection: '', link: null, path: null }
  const term = s.term
  const selection = term.hasSelection() ? term.getSelection() : ''
  const screen = term.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!screen) return { selection, link: null, path: null }
  const r = screen.getBoundingClientRect()
  const col = Math.floor((clientX - r.left) / (r.width / term.cols))
  const row = Math.floor((clientY - r.top) / (r.height / term.rows))
  if (col < 0 || col >= term.cols || row < 0 || row >= term.rows) return { selection, link: null, path: null }
  const y = term.buffer.active.viewportY + row
  const line = logicalLine(term, y)
  const target = (y - line.first) * term.cols + col
  const at = line.index[Math.min(target, line.index.length - 1)]
  // An OSC 8 label ("PR #165") is a link though its text is not (#169); where
  // a left click goes (`osc8Target`) is what the menu copies and opens.
  const shown = linkAt(line.text, at)
  const osc = s.oscLink(y, col)
  const link = osc ? osc8Target(osc, shown) : shown
  return { selection, link, path: link ? null : pathAt(line.text, at, s.cwd()) }
}

/** Refit a session and tell the pty its new geometry. */
function refitSession(id: string, s: Session): void {
  if (!s.el.clientWidth || !s.el.clientHeight) return
  suppressActivity(id)
  fitKeepingCursorLine(s.term, s.fit)
  termApi().termResize(id, s.term.cols, s.term.rows)
}

// One restyler for every running shell, driven by the Terminal settings
// changing (theme, acrylic and its opacity, base font size). A session the
// user Ctrl+scrolled keeps its own font; everything else follows the base.
function applyLook(): void {
  const theme = currentTermTheme()
  const base = termBaseFontPx()
  const family = termFontStack()
  // Measured once from the ground as painted (rule 15), told to each program
  // that asked (?2031h) only when it differs from what it was last told.
  const mode = groundMode(groundedTheme().background)
  for (const [id, s] of sessions) {
    s.term.options.theme = theme
    s.tellTheme(mode)
    s.links.repaint() // the link colour is measured against the theme's ground
    const want = s.fontOverride ?? base
    const sizeChanged = s.term.options.fontSize !== want
    const familyChanged = s.term.options.fontFamily !== family
    if (sizeChanged) s.term.options.fontSize = want
    if (familyChanged) s.term.options.fontFamily = family
    if (sizeChanged || familyChanged) refitSession(id, s)
  }
}
onTermLookChange(applyLook)
// A host with styles of its own repaints :root when the style changes, and a
// terminal following it has to follow that too. Armed lazily: the host has
// not been configured yet when this module is first evaluated.
let styleWatch: (() => void) | null = null
function watchHostStyle(): void {
  if (!styleWatch && followsHostStyle()) styleWatch = watchTermTheme(() => applyLook())
  // A host whose picked window colours change the ground: restyle with them.
  if (!chromeWatch) chromeWatch = termHost().onChromeChange?.(() => applyLook()) ?? (() => {})
}
let chromeWatch: (() => void) | null = null

/** Ctrl+scroll: zoom THIS session's text, unpersisted. */
function zoomSession(id: string, delta: number): void {
  const s = sessions.get(id)
  if (!s) return
  // Up to ~500% of the stock 13px: the Settings base caps at 200%, the wheel
  // deliberately goes further - a session zoom is a moment, not a layout.
  const next = Math.max(7, Math.min(64, (s.fontOverride ?? termBaseFontPx()) + delta))
  s.fontOverride = next
  s.term.options.fontSize = next
  refitSession(id, s)
}

/** Wipe a session's screen and scrollback, back to a bare prompt. The shell
 *  itself is untouched: same process, same cwd, same history. */
export function clearTermSession(id: string): void {
  sessions.get(id)?.term.clear()
}

/** Spawn a session WITHOUT waiting for its panel: a restored background tab's
 *  Claude session must resume now, not when the tab is first visited. The
 *  xterm lives against its detached element (the same way hidden tabs keep
 *  theirs) and the panel simply attaches it later, scrollback intact. */
export function ensureTermSession(id: string, root: string, shellId: string | undefined): void {
  if (!sessions.has(id)) createSession(id, root, shellId)
}

/**
 * Is the shell that has the keyboard running a FULL-SCREEN program (its own
 * screen, or it asked for the mouse: vim, less, htop, a TUI)? For a host that
 * takes a chord from the shell only at a prompt (Prism Terminal's Ctrl+F find,
 * owner, 2026-09-23): in vim and less Ctrl+F is page down, and stays theirs.
 * False when no shell has the keyboard.
 */
export function focusedTermFullScreen(): boolean {
  const active = document.activeElement
  for (const s of sessions.values()) {
    if (!active || !s.el.contains(active)) continue
    return s.term.buffer.active.type !== 'normal' || s.term.modes.mouseTrackingMode !== 'none'
  }
  return false
}

/** Give a live session the keyboard back. Used after a tab interaction (a
 *  click, a reorder drag) stole focus from a shell the user never left: the
 *  next keystroke would otherwise go to the strip instead of Claude Code. */
export function focusTermSession(id: string): void {
  sessions.get(id)?.term.focus()
}

/**
 * Paste TEXT THE USER SPOKE into a session (#13), exactly as a Ctrl+V of text
 * would arrive: xterm wraps it in the bracketed-paste escape when the shell
 * asked for that, so an agent's prompt takes it as one paste. NEVER A NEWLINE:
 * `paste` turns one into a carriage return, which is Enter, and dictation must
 * never send a command. The caller cleans the text; this strips what is left
 * anyway, because the rule is worth two locks.
 */
function pasteSpokenText(id: string, text: string): boolean {
  const s = sessions.get(id)
  const flat = text.replace(/[\r\n\u2028\u2029]+/g, ' ')
  if (!s || !flat) return false
  markTouched(id)
  s.term.paste(flat)
  return true
}
setTextPaster(pasteSpokenText)

/** Kill a session's renderer half: the xterm instance and its element. Main's
 *  pty half is killed separately (term:kill) or already exited. */
export function disposeTermSession(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  hiddenCursor.delete(id)
  forgetSession(id)
  s.unsub.forEach((u) => u())
  s.links.dispose()
  s.search.dispose()
  s.term.dispose()
  s.el.remove()
}

/**
 * Find in the scrollback (2026-08-31).
 *
 * The session store is keyed by shell id and outlives every component, so
 * the find bar reaches its terminal the same way `focusTermSession` does
 * rather than threading a ref through the app. The decorations are painted
 * in the LIVE accent - the window chrome is derived from the terminal's theme
 * (lib/chromeTheme), and a highlight in some other colour would be the one
 * part of the panel that ignores it.
 *
 * `matchOverviewRuler` and `activeMatchColorOverviewRuler` are required
 * members of xterm's ISearchDecorationOptions, not optional extras: leave
 * them out and the whole decorations object is a type error.
 */
function findOptions(incremental: boolean): Parameters<SearchAddon['findNext']>[1] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--p-accent-hi').trim()
  // xterm's decorations want #RRGGBB and nothing else: an rgba() or an
  // eight-digit hex paints as transparent-black, which is a match you cannot
  // see. chromeTheme publishes hex today, and this is the guard for the day
  // one of them is not.
  const accent = /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#5b5bd6'
  return {
    incremental,
    decorations: {
      matchBackground: '#4a5160',
      matchBorder: '#6b7482',
      matchOverviewRuler: '#8a93a3',
      activeMatchBackground: accent,
      activeMatchBorder: accent,
      activeMatchColorOverviewRuler: accent
    }
  }
}

/**
 * Step to the next (or previous) match. False when there is no session.
 *
 * `incremental` is for TYPING: it keeps the selection where it is while the
 * query still matches, so the view does not leap down the scrollback one
 * character at a time. Enter and the arrows pass false, which is what makes
 * them step.
 */
export function findInTerm(id: string, query: string, dir: 1 | -1, incremental = false): boolean {
  const s = sessions.get(id)
  if (!s) return false
  if (!query) {
    s.search.clearDecorations()
    return true
  }
  if (dir === 1) s.search.findNext(query, findOptions(incremental))
  else s.search.findPrevious(query, findOptions(false))
  return true
}

/** Drop the highlights: the bar closed, or the query emptied. */
export function clearTermFind(id: string): void {
  sessions.get(id)?.search.clearDecorations()
}

/** Hear the running count. `resultIndex` is -1 past xterm's match threshold,
 *  which the bar reports as "many" rather than as "none". */
export function onTermFindResults(
  id: string,
  cb: (r: { index: number; count: number }) => void
): () => void {
  const s = sessions.get(id)
  if (!s) return () => {}
  const d = s.search.onDidChangeResults((e) => cb({ index: e.resultIndex, count: e.resultCount }))
  return () => d.dispose()
}

function createSession(id: string, root: string, shellId: string | undefined): Session {
  // The quoting a pasted path gets (#5): the shell this session runs.
  const pathShell: PathShell = shellOfShellId(shellId)
  watchHostStyle()
  const term = new Terminal({
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true, // unicode11 needs it
    allowTransparency: true, // an acrylic window paints a see-through canvas
    fontFamily: termFontStack(),
    // The Settings base size; Ctrl+scroll can zoom this one session later.
    fontSize: termBaseFontPx(),
    // The chosen theme. Live switches are handled by applyLook above.
    theme: currentTermTheme(),
    // The pty is ConPTY (2026-09-04): without saying so, xterm reflowed
    // wrapped lines on a resize while ConPTY repainted them from its own
    // buffer, and where the two disagreed the prompt came back with holes -
    // "PS C:\" then blank columns then the tail of the path (owner
    // screenshot), Ctrl+L putting it right. Declared, xterm leaves the
    // reflow to ConPTY and grows the scrollback the way ConPTY expects.
    // The bundled dll is newer than any inbox conhost; to xterm only
    // "21376 or later" matters, which keeps its reflow ON and grows the
    // scrollback the way ConPTY expects when rows are added.
    windowsPty: { backend: 'conpty', buildNumber: 22621 },
    // OSC 8 LINKS OPEN ON A LEFT CLICK (#169). Without a handler xterm 6.0
    // asks confirm() and then opens a blank window, which main denies (only
    // http(s) navigates), on a click of ANY button: the right one belongs to
    // the menu, as for every other link (owner, 2026-09-28). No confirm, ever.
    // Only http(s): xterm drops any other scheme with allowNonHttpProtocols
    // off, and this checks again, as do the preload and main.
    // A label that shows another host's address opens what it shows
    // (`osc8Target`, review 2026-10-11).
    linkHandler: {
      activate: (e, uri, range) => {
        if (e.button !== 0 || !isWebLink(uri)) return
        const to = osc8Target(uri, shownLinkOver(term, range))
        if (isWebLink(to)) termApi().openExternal(to)
      },
      allowNonHttpProtocols: false
    }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  // Ink UIs (Claude Code) draw boxes and spinners whose width math assumes
  // Unicode 11 - without this addon the emoji misalign, which is the tell of
  // a terminal that didn't bother.
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  // A LEFT click opens a link (owner, 2026-09-28: "right clicking a link opens
  // the link instead of showing the right click menu"). The addon hands over a
  // click of ANY button; the right one belongs to the menu, which offers Open
  // link itself.
  term.loadAddon(
    new WebLinksAddon((e, url) => {
      if (e.button === 0) termApi().openExternal(url)
    })
  )
  // The addon makes a link clickable and underlines it under the pointer; this
  // is what makes it LOOK like a link the rest of the time.
  // The folder this shell is in (#99): where it started, then the prompt's
  // own report below. Paths on screen are read against it.
  let cwdNow = root
  // Paths are asked about as THIS session (#167): a found one repaints only
  // this terminal, and only the lines that were waiting for it.
  // The OSC 8 links this session's programs printed (#169), followed from the
  // stream below; the painter colours them on both screens.
  const osc8 = new Osc8Spans()
  const links = attachLinkPaint(term, currentLinkColor, (text) => linkRanges(text, cwdNow, id), {
    asked: () => takeAsked(id),
    spans: (first, last) => osc8.overlapping(first, last, term.buffer.active.type === 'alternate')
  })
  // A PATH IS A LINK TOO, when it exists (#99). The painter colours it; this
  // makes it clickable, with the pointer and the underline of a link. A left
  // click opens it; the right one is the menu's (Open, Show in Explorer, Copy
  // path).
  term.registerLinkProvider({
    provideLinks: (y, done) => {
      if (!termApi().termPathKinds) return done(undefined)
      const line = logicalLine(term, y - 1)
      const out = []
      for (const c of pathCandidates(line.text)) {
        const hit = knownPath(cwdNow, c.path)
        if (!hit) continue
        const from = line.index.indexOf(c.start)
        const to = line.index.indexOf(c.end) - 1
        if (from < 0 || to < from) continue
        const target: TermPathAt = { ...hit, text: c.path }
        out.push({
          range: {
            start: { x: (from % term.cols) + 1, y: line.first + Math.floor(from / term.cols) + 1 },
            end: { x: (to % term.cols) + 1, y: line.first + Math.floor(to / term.cols) + 1 }
          },
          text: c.path,
          decorations: { pointerCursor: true, underline: true },
          activate: (e: MouseEvent) => {
            if (e.button === 0) openTermPath(id, target, 'open')
          }
        })
      }
      done(out.length ? out : undefined)
    }
  })

  const el = document.createElement('div')
  el.className = 'h-full w-full'
  term.open(el)

  // Touched means the USER typed (#99 found the lie): xterm also answers the
  // pty on its own - focus in/out (ESC[I / ESC[O, which pwsh 7.5 switches
  // on), device attributes at spawn (ESC[?1;2c), cursor position - and every
  // one of those went through onData and counted as typing, so a shell
  // nobody had touched read as touched from its first prompt. Keys are
  // heard on onKey, which only fires for a key; the rest of onData counts
  // only when it is plain text (an IME commit), never when it is a reply.
  term.onKey(() => markTouched(id))
  // A key can answer an agent's question where no hook says so (#144).
  term.onKey((e) => reportTermKey(id, e.key))
  // THE CARET FOLLOWS TYPING, NOT A STREAMING AGENT (#101). Magnifiers, screen
  // readers and the IME window follow xterm's helper textarea, which xterm
  // puts on the cursor after every write (`_syncTextArea` on onCursorMove).
  // MEASURED: Claude Code's inline view ends every streaming frame with the
  // cursor on the output row, ABOVE its input line, so that caret left where
  // the user types for as long as an answer streamed. On the normal screen the
  // textarea is held on the caret the last key produced while the program
  // parks the cursor above it (`termCaretHold`); at or below, and on the
  // alternate screen, xterm's placement stands. Registered after term.open, so
  // this runs after xterm's own sync and has the last word.
  let caretHold = initialCaretHold()
  const holdTextarea = (at: CaretPos): void => {
    const ta = term.textarea
    const screen = term.element?.querySelector<HTMLElement>('.xterm-screen')
    const row = at.line - term.buffer.active.baseY
    if (!ta || !screen || row < 0 || row >= term.rows) {
      caretHold = releaseCaretHold()
      return
    }
    ta.style.left = `${(Math.min(at.x, term.cols - 1) * screen.clientWidth) / term.cols}px`
    ta.style.top = `${(row * screen.clientHeight) / term.rows}px`
  }
  term.onKey(() => {
    caretHold = onCaretKey(caretHold, performance.now())
  })
  term.onCursorMove(() => {
    const b = term.buffer.active
    if (b.type !== 'normal' || b.viewportY !== b.baseY) {
      caretHold = releaseCaretHold()
      return
    }
    const r = onCaretMove(caretHold, { line: b.baseY + b.cursorY, x: b.cursorX }, performance.now())
    caretHold = r.state
    if (r.hold) holdTextarea(r.hold)
  })
  term.onResize(() => {
    caretHold = releaseCaretHold()
  })
  term.buffer.onBufferChange(() => {
    caretHold = releaseCaretHold()
  })
  term.onData((d) => {
    if (looksTyped(d)) markTouched(id)
    termApi().termInput(id, d)
  })
  // The prompt's own report of where the shell is (#99): OSC 9;9, the
  // Windows Terminal convention, printed by the hook main put in the
  // bootstrap. Read here rather than in main because xterm already parses
  // the stream; handled (true) so it is never drawn as stray text.
  // The title (OSC 0/2) is where Claude Code writes its working state; App
  // reads the glyph. xterm parses it either way, this only passes it on.
  term.onTitleChange((t) => reportTitle(id, t))
  // Whether an agent runs in this shell right now, and which, for Shift+Enter
  // and an image on Ctrl+V below: a resumed session is its agent from its
  // first moment (set where the resume is taken, below); the title, the poll
  // and the prompt move it (`agentArm`).
  let arm = armAtStart(null)
  // Whether the program in front asked for theme reports (?2031h, below).
  let reports = THEME_REPORTS_OFF
  const moveArm = (s: ArmStep): void => {
    arm = s.arm
    // The agent that asked for theme reports has gone with them.
    if (s.gone) reports = THEME_REPORTS_OFF
    if (s.recheck) termApi().termAgentAgain?.(id)
  }
  term.parser.registerOscHandler(9, (data) => {
    const p = parseOsc9(data)
    if (p) {
      cwdNow = p
      markPrompt(id)
      reportCwd(id, p)
      // THE PROMPT IS BACK: nothing runs in front of the shell (review
      // 2026-10-11). The agent's keys go at once (Ctrl+V's ESC v reached
      // PSReadLine, whose RevertLine wiped the line), and so does a ?2031h
      // whose program died without its ?2031l: a theme push would reach the
      // shell, and PSReadLine read the ESC as RevertLine and typed the rest.
      moveArm(armOnPrompt(arm))
    }
    return true
  })
  // CLAUDE CODE'S OWN WORD, through the bundled plugin's hooks (#131): our
  // OSC 777 payloads only. Anything else answers false, so another OSC 777
  // user is left exactly as before.
  term.parser.registerOscHandler(777, (data) => {
    const signal = parseAgentSignal(data)
    if (!signal) return false
    reportAgentSignal(id, signal)
    return true
  })
  // OSC 8 LINKS, FOLLOWED FROM THE STREAM (#169; termOsc8.ts says why and what
  // was measured). The handler only LOOKS: it returns false, so xterm still
  // records the link and its own provider makes it clickable (linkHandler).
  // The cursor at the open and at the close bracket the label; a marker holds
  // the open's line on the normal screen while the buffer trims under it.
  let osc8Open: { anchor: SpanAnchor; x: number; uri: string; alt: boolean } | null = null
  const osc8Drop = (): void => {
    osc8Open?.anchor.dispose?.()
    osc8Open = null
  }
  const osc8Close = (): void => {
    const open = osc8Open
    osc8Open = null
    if (!open) return
    const b = term.buffer.active
    const alt = b.type === 'alternate'
    const rows = b.baseY + b.cursorY - open.anchor.line
    const endX = Math.min(b.cursorX, term.cols)
    // A label is a few cells on a row or two; anything else (the program
    // moved the cursor between the open and the close) is not a label.
    if (open.alt !== alt || open.anchor.isDisposed || rows < 0 || rows > 16 || (rows === 0 && endX <= open.x)) {
      open.anchor.dispose?.()
      return
    }
    const span = { anchor: open.anchor, x: open.x, rows, endX, uri: open.uri, text: '', alt }
    const text = spanText(span, term.cols, (line) => bufferRowCells(b.getLine(line), term.cols))
    if (!text?.trim()) {
      open.anchor.dispose?.()
      return
    }
    osc8.add({ ...span, text })
    // A row drawn before the close arrived (a write split mid-label) is
    // drawn again, so the alternate screen's inker sees the span.
    if (alt) {
      const top = open.anchor.line - b.viewportY
      term.refresh(Math.max(0, top), Math.min(term.rows - 1, top + rows))
    }
  }
  term.parser.registerOscHandler(8, (data) => {
    const p = parseOsc8(data)
    if (!p) return false
    // An open while one is still open ends the first one there, as OSC 8 has it.
    osc8Close()
    if (!p.uri || !isWebLink(p.uri)) return false
    const b = term.buffer.active
    const alt = b.type === 'alternate'
    let x = b.cursorX
    let down = 0
    // The cursor waits past the last cell (a pending wrap): the label's first
    // character lands at the start of the next row.
    if (x >= term.cols) {
      x = 0
      down = 1
    }
    const anchor: SpanAnchor | undefined = alt
      ? { line: b.baseY + b.cursorY + down }
      : term.registerMarker(down)
    if (anchor) osc8Open = { anchor, x, uri: p.uri, alt }
    return false
  })
  term.buffer.onBufferChange(() => {
    // The alternate screen's links leave with it, and a new one starts bare.
    osc8Drop()
    osc8.clear(true)
  })
  term.onResize(() => {
    // A reflow moves the cells out from under every span.
    osc8Drop()
    osc8.clear()
  })
  // THE PROGRAM IS TOLD THE GROUND IT REALLY SITS ON (#168, #172; rule
  // replies-only-when-asked). MEASURED (Claude Code 2.1.296): xterm answered
  // `ESC]11;?` as rgb:0000/0000/0000, read off the clear canvas the panel
  // paints behind (rule 14), so Claude's "auto" theme was dark on Fawn too.
  // Claude writes ?2031h without a DECRQM probe, and on a pushed ?997;2n asks
  // OSC 11 again and turns light. Every reply goes through term.input(.., false):
  // onData, in stream order with xterm's own replies (a DA1 right after stays
  // after), and starting with ESC so `looksTyped` never counts it as typing.
  // Anything these do not answer returns false and stays xterm's.
  const reply =(r: string): void => term.input(r, false)
  const modeNow = (): GroundMode => groundMode(groundedTheme().background)
  const colourQuery = (ident: 10 | 11) => (data: string): boolean => {
    const theme = groundedTheme()
    const replies = colourQueryReplies(ident, data, { fg: theme.foreground, bg: theme.background })
    if (!replies) return false
    replies.forEach(reply)
    // An answered ground tells the program the mode: no push for it later.
    if (ident === 11 || replies.length > 1) reports = noteThemeMode(reports, groundMode(theme.background))
    return true
  }
  term.parser.registerOscHandler(10, colourQuery(10))
  term.parser.registerOscHandler(11, colourQuery(11))
  // ?2031h / ?2031l, followed from the stream. False: xterm still applies
  // whatever other modes ride the same sequence.
  const trackReports = (on: boolean) => (params: (number | number[])[]): boolean => {
    if (modeParams(params).includes(2031)) reports = themeReports(reports, on, modeNow())
    return false
  }
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, trackReports(true))
  term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, trackReports(false))
  // RIS (ESC c) resets every mode, this one too. False: xterm still resets.
  term.parser.registerEscHandler({ final: 'c' }, () => {
    reports = THEME_REPORTS_OFF
    return false
  })
  // CSI ? 996 n: "which are you now?" xterm keeps every other DSR.
  term.parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) => {
    const p = modeParams(params)
    if (p.length !== 1 || p[0] !== 996) return false
    const mode = modeNow()
    reply(dsrThemeReply(mode))
    reports = noteThemeMode(reports, mode)
    return true
  })
  // DECRQM for 2031, which xterm 6.0 does not know (it would say 0, "not
  // recognised"); every other mode stays xterm's to report.
  term.parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, (params) => {
    const p = modeParams(params)
    if (p.length !== 1 || p[0] !== 2031) return false
    reply(decrqmReply(2031, reports.on))
    return true
  })
  // The redraw nudge after a push (termReplies.ts says why): one column less,
  // then a refit back, through the panel's own resize path so xterm and the pty
  // agree. Several switches in a row give one nudge. The theme is switched in
  // Settings, so the program's tab is usually HIDDEN then (no size): the nudge
  // waits until the tab is shown again, since showing it refits to the same
  // size, which tells the program nothing.
  let nudge: number | undefined
  const nudgeWhenShown = (): void => {
    const s = sessions.get(id)
    if (!s) return
    if (!el.clientWidth || !el.clientHeight) {
      nudge = window.setTimeout(nudgeWhenShown, NUDGE_AFTER_MS)
      return
    }
    const w = nudgeWidths(term.cols)
    if (!w) return
    suppressActivity(id)
    term.resize(w[0], term.rows)
    termApi().termResize(id, w[0], term.rows)
    nudge = window.setTimeout(() => {
      if (sessions.get(id) === s) refitSession(id, s)
    }, NUDGE_HOLD_MS)
  }
  const tellTheme = (mode: GroundMode): void => {
    const r = themePush(reports, mode)
    reports = r.state
    if (!r.send) return
    reply(r.send)
    window.clearTimeout(nudge)
    nudge = window.setTimeout(nudgeWhenShown, NUDGE_AFTER_MS)
  }
  // XTVERSION, `CSI > q` / `CSI > 0 q` (#171; termReplies.ts has the
  // measurement): xterm 6.0.0 has no handler, and without a reply Claude never
  // turns on synchronized output. Any other parameter stays xterm's.
  term.parser.registerCsiHandler({ prefix: '>', final: 'q' }, (params) => {
    if (!xtversionAsked(modeParams(params))) return false
    reply(xtversionReply(TERM_CORE_VERSION, XTERM_VERSION))
    return true
  })
  // OSC 52, WRITE-ONLY (#176; termOsc52.ts says why). Every OSC 52 is handled
  // (true), written or refused, so none is drawn as stray text; a READ is
  // swallowed and NEVER answered. A copy goes through main (a background tab
  // or an unfocused window still copies) and raises the Copied badge only when
  // it landed, so a program's copy is never silent.
  term.parser.registerOscHandler(52, (data) => {
    const p = parseOsc52(data, OSC52_MAX)
    if (p?.kind === 'write') {
      void termApi()
        .writeClipboardFromTerm?.(p.text)
        .then((ok) => {
          if (ok) announceCopied()
        })
        .catch(() => undefined)
    }
    return true
  })
  // THE BELL (#177): at most one a second per tab reaches the host (a `cat` of
  // a binary rings hundreds of times), which flashes the taskbar while the
  // window is unfocused (spec decision 1). Never a sound.
  let lastBell: number | null = null
  term.onBell(() => {
    const now = performance.now()
    if (!bellGate(lastBell, now)) return
    lastBell = now
    termApi().termBell?.(id)
  })
  // A RESUMING TAB WEARS A SKELETON (#106), not a text spinner: the shell's
  // own words (its prompt, the resume command) are cleared the moment the
  // agent takes the console, and the terminal is shown once the agent has
  // drawn itself (`resumeReveal`, which says when). The overlay is the
  // component's; this says which sessions still wear it (termBus).
  const resume = takeResume(id)
  arm = armAtStart(resume ? agentOfResume(resume) : null)
  let reveal: RevealState | null = null
  let revealClock: ReturnType<typeof setInterval> | null = null
  const finishReveal = (): void => {
    if (!reveal) return
    reveal = revealNow(reveal)
    if (revealClock) clearInterval(revealClock)
    revealClock = null
    setResuming(id, false)
  }
  const tickReveal = (): void => {
    if (!reveal || reveal.revealed) return
    reveal = onTick(reveal, performance.now())
    if (reveal.revealed) finishReveal()
  }
  if (resume) {
    markTouched(id) // a claude session from the first moment
    reveal = startReveal(agentOfResume(resume), performance.now())
    setResuming(id, true)
    revealClock = setInterval(tickReveal, 50)
    // A key is the user wanting the terminal: they see what they type.
    term.onKey(() => finishReveal())
    // A full-screen agent (Claude's fullscreen view) draws on the alternate screen.
    term.buffer.onBufferChange((b) => {
      if (reveal && b.type === 'alternate') reveal = onAlternate(reveal, performance.now())
    })
  }
  /** Pty output, with the clear written in front of the agent's own title
   *  while the session is still coming back. */
  const writeOutput = (data: string): void => {
    if (!reveal || reveal.revealed) {
      term.write(data)
      return
    }
    const r = onChunk(reveal, data, performance.now())
    reveal = r.state
    if (r.clearAt < 0) term.write(data)
    else term.write(data.slice(0, r.clearAt) + CLEAR + data.slice(r.clearAt))
  }

  /**
   * The one paste. Bracketed for text - without that framing a multi-line
   * paste reaches the shell as a run of Enter presses, so the first line runs
   * and the rest are typed after it - and, for an image, the agent's own
   * image-paste KEYSTROKE, which lets the TUI read the clipboard itself.
   *
   * Named and registered so a right-click Paste calls THIS rather than
   * growing a second, wrong copy of it.
   */
  const pasteHere = (): void => {
    const decision = decidePaste(termApi().readClipboard(), pathShell)
    if (decision.kind === 'key') {
      markTouched(id)
      // The AGENT's image-paste key, Alt+V to Claude on Windows (#170).
      termApi().termInput(id, imagePasteKey(arm.kind))
    } else if (decision.kind === 'text') {
      markTouched(id) // a paste is typing; bracketed, it starts with ESC
      term.paste(decision.data)
    }
  }

  // The title arms the agent's keys before the poll (#175), and takes back an
  // agent only it vouched for (`agentArm` has the rules).
  term.onTitleChange((t) => moveArm(armOnTitle(arm, t)))
  const unsub = [
    attachClickCaret(term, el, id, (line, x) => oscLink(line, x) !== null),
    // A path this session asked about turned out to exist: paint the lines
    // that asked (#167; it used to be every line of every tab).
    onPathsFound(id, () => links.revisit()),
    termApi().onTermAgent((forId, present, kind) => {
      if (forId === id) moveArm(armOnPoll(arm, present, kind))
    }),
    termApi().onTermData((forId, data) => {
      if (forId === id) writeOutput(data)
    }),
    // The shell ended: whatever it said must be seen.
    termApi().onTermExit((forId) => {
      if (forId === id) finishReveal()
    }),
    finishReveal,
    // A menu reaches this session's paste through lib/termBus while it is
    // alive; dropping the entry is part of disposing the session.
    registerPaste(id, pasteHere)
    // Exit is App's to handle: it owns the tab's term slot and must hear the
    // exit even while this panel is hidden. App disposes us via
    // disposeTermSession, so nothing is subscribed here.
  ]

  // Ctrl+C and Ctrl+V are matched by the PHYSICAL key as well as the letter
  // (code review 2026-09-24, #6): on a Russian or Greek layout the C key's
  // `key` is not 'c', xterm still maps it to ^C, and a copy over a selection
  // interrupted the agent instead. Windows Terminal matches the key the same way.
  const isKey = (e: KeyboardEvent, letter: 'c' | 'v'): boolean =>
    e.key.toLowerCase() === letter || e.code === `Key${letter.toUpperCase()}`
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    // Ctrl+C over a SELECTION copies it, the way Windows Terminal does; with
    // nothing selected it stays the interrupt every shell expects.
    if (
      isKey(e, 'c') &&
      e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      term.hasSelection()
    ) {
      void copyText(term.getSelection()) // and the "Copied" badge, once it landed
      term.clearSelection()
      return false
    }
    // Backspace or Delete over a selection on the line being edited deletes
    // it (owner, 2026-09-23); anywhere else the key is the shell's as ever.
    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      !e.ctrlKey &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      term.hasSelection() &&
      deleteSelection(term, id)
    ) {
      e.preventDefault()
      return false
    }
    // THE HOST'S CHORDS (core/renderer/host). Which keys belong to the app
    // even over a focused shell is the one thing the two apps disagree about
    // (Prism closes a tab on Ctrl+W and toggles the panel on Ctrl+`; Prism
    // Terminal leaves Ctrl+W to the shell as delete-word), so the host says.
    // Returning false keeps xterm from ALSO feeding the bytes to the pty: left
    // to xterm, Ctrl+` became a NUL, which counted as the user typing.
    if (termHost().ownsKey(e)) return false
    if (e.key === 'Enter' && e.shiftKey && arm.here) {
      // Newline-without-submit, in the bytes the agent reads as one
      // (`newlineKey`, measured #175: Ctrl+J for Claude, `\` + Enter
      // otherwise). This is what /terminal-setup exists to configure; here it
      // simply works. ONLY where an agent runs (code review 2026-09-24, #21):
      // at a plain prompt `\` then Enter RAN the line with a backslash on its
      // end, a command nobody wrote. There Shift+Enter is Enter, as xterm sends it.
      markTouched(id) // input like any other: its repaint is echo, not work
      termApi().termInput(id, newlineKey(arm.kind))
      // Returning false only stops xterm's keydown; the browser still fires a
      // keypress for Enter and xterm sent a CR on it, so Claude got Ctrl+J
      // THEN Enter and submitted (MEASURED, e2e imagePaste 2026-10-11:
      // "IN C 0a" then "IN C 0d"). preventDefault cancels that keypress.
      e.preventDefault()
      return false
    }
    // ONE CTRL+V IS ONE PASTE (owner, 2026-09-22: "when I copy text and paste
    // it pastes twice"). Returning false only tells XTERM to leave the key
    // alone; it does not cancel the BROWSER's own action for Ctrl+V, which is
    // a native paste event into xterm's textarea - and xterm pastes on that
    // event too. So every paste arrived twice, once from here and once from
    // there. preventDefault cancels the native one; this handler is the paste,
    // since it is the one that knows about images (Claude Code reads those
    // itself when it gets its image-paste keystroke) and bracketed framing.
    if (isKey(e, 'v') && e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      pasteHere()
      return false
    }
    if (isKey(e, 'v') && e.ctrlKey && e.shiftKey && !e.altKey) {
      e.preventDefault()
      // The escape hatch: plain text paste even when an image rides along.
      const clip = termApi().readClipboard()
      // Sanitised like every paste (#1): no ESC can end the bracketed paste.
      const text = sanitizePaste(clip.text)
      if (text) {
        markTouched(id)
        term.paste(text)
      }
      return false
    }
    return true
  })

  const oscLink = (line: number, x: number): string | null => {
    const sp = osc8.at(line, x, term.buffer.active.type === 'alternate')
    if (!sp) return null
    const now = spanText(sp, term.cols, (l) => bufferRowCells(term.buffer.active.getLine(l), term.cols))
    return now === sp.text ? sp.uri : null
  }
  const session: Session = { term, fit, search, links, el, unsub, cwd: () => cwdNow, tellTheme, oscLink }
  sessions.set(id, session)

  // A session restored over a Claude conversation launches straight into it:
  // the resume id rides the SPAWN (main builds it into the shell's startup
  // command), so nothing is ever visibly typed.
  // The plugin rides the spawn too (#131), while its setting is on.
  void termApi().termSpawn(id, root, shellId, resume ?? undefined, agentHooksOn()).then((ok) => {
    if (!ok && sessions.has(id)) {
      // The resume spinner would go on writing over the error for the tab's
      // whole life (code review 2026-09-24, #24): no pty data will ever stop it.
      finishReveal()
      term.write('\x1b[31mCould not start the shell.\x1b[0m\r\n')
      return
    }
    // The spawn is done: re-assert the real size once. The first fit can race
    // a slow spawn, and a static window will never resize on its own.
    if (sessions.has(id)) termApi().termResize(id, term.cols, term.rows)
  })
  return session
}

/**
 * Mounts (or re-attaches) the session for `sessionId`. Never disposes on
 * unmount: hiding the panel keeps the shell. Disposal is App's, on exit or
 * tab close, through disposeTermSession.
 */
export default function TerminalPanel({
  sessionId,
  root,
  shellId
}: {
  sessionId: string
  root: string
  shellId: string | undefined
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  // Read only when the session is CREATED, so the attach below is keyed on the
  // session alone (code review 2026-09-24, #9 and #23): `root` is the tab's
  // live folder, and every `cd` re-ran the attach, which re-appended the
  // terminal and took the focus from the find bar or the help popup, so the
  // rest of a search was typed into the shell.
  const spawnWith = useRef({ root, shellId })
  useEffect(() => {
    spawnWith.current = { root, shellId }
  }, [root, shellId])

  useEffect(() => {
    const host = box.current
    if (!host) return
    const s =
      sessions.get(sessionId) ?? createSession(sessionId, spawnWith.current.root, spawnWith.current.shellId)
    host.appendChild(s.el)
    s.term.focus()
    const refit = (): void => {
      // A hidden or zero-sized panel would fit to nonsense; the observer fires
      // again when it has real bounds.
      if (!host.clientWidth || !host.clientHeight) return
      // The redraw this resize provokes is us, not the shell working.
      suppressActivity(sessionId)
      fitKeepingCursorLine(s.term, s.fit)
      termApi().termResize(sessionId, s.term.cols, s.term.rows)
    }
    refit()
    // A SECOND PASS ONCE THE RENDERER HAS RESUMED (#174, xterm.js #6117, open
    // in 6.0.0). While the element was detached xterm's renderer was paused
    // (its IntersectionObserver), and the viewport syncs its scroll range in a
    // render callback; a tab resized while hidden could come back with a stale
    // slider until the next scroll. After a frame plus a task the renderer runs
    // again: fit once more (a no-op when the size already matches) and redraw
    // every row, which runs the render callbacks the viewport's sync waits on.
    // Public API only. NOT REPRODUCED before this landed (no e2e in the build
    // group); the `hiddenResize` e2e is the guard either way.
    let resumeTimer: ReturnType<typeof setTimeout> | undefined
    const resumeFrame = requestAnimationFrame(() => {
      resumeTimer = setTimeout(() => {
        if (s.el.parentElement !== host) return
        refit()
        s.term.refresh(0, s.term.rows - 1)
      }, 0)
    })
    const ro = new ResizeObserver(refit)
    ro.observe(host)
    // Ctrl+scroll zooms this session's text - unpersisted, the Settings base
    // size is untouched. Non-passive so the browser's own zoom never fires,
    // and in the CAPTURE phase because a full-screen TUI (Claude Code, codex,
    // vim, less) turns xterm's mouse reporting on: xterm then claims the
    // wheel to forward it to the program as a mouse report, and a listener
    // waiting for the bubble never heard it. Capture runs root-first, so the
    // zoom is decided before xterm sees the event at all - and only for
    // ctrl+wheel, which leaves plain scrolling to the program.
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      zoomSession(sessionId, e.deltaY < 0 ? 1 : -1)
    }
    host.addEventListener('wheel', wheel, { passive: false, capture: true })
    return () => {
      cancelAnimationFrame(resumeFrame)
      if (resumeTimer) clearTimeout(resumeTimer)
      ro.disconnect()
      host.removeEventListener('wheel', wheel, { capture: true })
      // Detach, don't dispose: the shell runs on unseen.
      if (s.el.parentElement === host) host.removeChild(s.el)
    }
  }, [sessionId])

  // Where the panel paints the ground, the 4px frame, the rows and the strip
  // under the last row are one surface in one coat (see currentTermTheme).
  // Where the host paints behind it, the panel adds nothing: a second
  // translucent coat is a visibly darker panel than the rest of the window.
  // The skeleton while this session is coming back (#106), kept a beat
  // longer as it fades, so the agent appears under it rather than after it.
  const resumingNow = useSyncExternalStore(onResumingChange, resumingIds).has(sessionId)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    let was = resumingIds().has(sessionId)
    let t: ReturnType<typeof setTimeout> | undefined
    const off = onResumingChange(() => {
      const now = resumingIds().has(sessionId)
      if (was && !now) {
        setLeaving(true)
        t = setTimeout(() => setLeaving(false), 200)
      }
      was = now
    })
    return () => {
      off()
      if (t) clearTimeout(t)
    }
  }, [sessionId])

  return (
    <div className="relative h-full w-full min-h-0 min-w-0">
      <div
        ref={box}
        data-term-region
        className={`h-full w-full min-h-0 min-w-0 p-1 ${paintsGround() ? 'bg-[var(--p-bg)]' : ''}`}
      />
      {(resumingNow || leaving) && <ResumeSkeleton leaving={!resumingNow} />}
    </div>
  )
}
