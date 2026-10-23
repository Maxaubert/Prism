/**
 * The dictation hotkey (#13): which key events start, stop and cancel a
 * recording. A pure reducer, because the hard part of this key cannot be tried
 * by machine (AltGr on a physical Norwegian keyboard is on the owner's hands-on
 * list) and so every rule has to be provable from a written sequence of events.
 *
 * WHY IT IS NOT A PLAIN KEYDOWN. The default key is Right Alt, and on Norwegian
 * and most European layouts Right Alt is AltGr, the key that types @ { } [ ] \ | ~.
 * Windows reports AltGr as ControlLeft DOWN immediately followed by AltRight
 * DOWN, so the AltRight event arrives carrying ctrl AND alt, and the user then
 * presses Digit2 for an @. A hotkey that fired on the down would start a
 * recording every time somebody typed an e-mail address. So a BARE MODIFIER is
 * read as a SOLO HOLD (hold mode) or a SOLO TAP (toggle mode): the key alone,
 * with nothing else pressed while it decides. A chord or a plain key (Ctrl+Shift+D,
 * F9) has no such ambiguity and acts on its down.
 *
 * The reducer keeps no clock of its own: every event carries `at`, and the host
 * sends a 'tick' when the hold time is up (one setTimeout at holdMs is enough).
 */

export interface Hotkey {
  /** KeyboardEvent.code, the PHYSICAL key: the binding must not move with the layout. */
  code: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export const DEFAULT_HOTKEY: Hotkey = { code: 'AltRight', ctrl: false, alt: false, shift: false, meta: false }

export type DictMode = 'hold' | 'toggle'

export type KeyEvt =
  | {
      type: 'down' | 'up'
      code: string
      ctrl: boolean
      alt: boolean
      shift: boolean
      meta: boolean
      repeat?: boolean
      at: number
    }
  | { type: 'tick'; at: number }
  | { type: 'blur'; at: number }

/** A key and the modifiers held with it, with or without the rest of an event. */
export type KeyChord = Pick<Hotkey, 'code' | 'ctrl' | 'alt' | 'shift' | 'meta'> & { type?: 'down' | 'up' }

export interface KeyState {
  /**
   * idle: nothing is recording. arming: the bare-modifier hotkey is down and
   * still alone, and nothing has been started yet (hold mode is waiting out
   * holdMs, toggle mode is waiting for the up that makes it a tap). listening:
   * 'start' has been given and neither 'stop' nor 'cancel' has.
   */
  phase: 'idle' | 'arming' | 'listening'
  /**
   * The hotkey is physically down as far as the reducer knows. It outlives the
   * phase on purpose: after an Escape or an AltGr cancel the key is still held,
   * its auto-repeat must not arm a second press, and its up is still swallowed.
   */
  held: boolean
  /** When the press that set `held` went down. Meaningless while not held. */
  downAt: number
  /** Another key went down during this press, so it is not a solo tap. */
  polluted: boolean
  /** This press arrived carrying Ctrl, which is how AltGr arrives: its ControlLeft is its own. */
  altGr: boolean
  /** The Escape that cancelled is still down; its up is swallowed with it. */
  escHeld: boolean
}

export type KeyAction = 'start' | 'stop' | 'cancel' | null

export interface KeyConfig {
  hotkey: Hotkey
  mode: DictMode
  /** How long a bare modifier must be held alone before it records. Default 200. */
  holdMs?: number
}

export interface KeyResult {
  state: KeyState
  action: KeyAction
  /** The host must preventDefault AND stop the event reaching xterm. */
  swallow: boolean
}

/** The spec's figure, not yet tried on a physical AltGr keyboard (owner's
 *  hands-on list): meant to be longer than the gap between AltGr and the key
 *  typed with it, and short enough not to feel like a wait. */
const DEFAULT_HOLD_MS = 200
/** A tap is a tap up to here; past it the key was held for some other reason. */
const TAP_MAX_MS = 1000
/** Windows sends AltGr's ControlLeft and AltRight back to back, out of the one
 *  physical key press; 50 leaves room for a busy renderer and is still far
 *  under the time a person needs to press a second key on purpose. */
const ALTGR_PAIR_MS = 50

const MODIFIER_FLAG: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ControlLeft: 'ctrl',
  ControlRight: 'ctrl',
  AltLeft: 'alt',
  AltRight: 'alt',
  ShiftLeft: 'shift',
  ShiftRight: 'shift',
  MetaLeft: 'meta',
  MetaRight: 'meta'
}
const FLAGS = ['ctrl', 'alt', 'shift', 'meta'] as const

export function initialKeyState(): KeyState {
  return { phase: 'idle', held: false, downAt: 0, polluted: false, altGr: false, escHeld: false }
}

/** A modifier bound on its own, which is what the solo rules apply to. */
function isBareModifier(h: Hotkey): boolean {
  return h.code in MODIFIER_FLAG && !h.ctrl && !h.alt && !h.shift && !h.meta
}

/**
 * Is this event the hotkey?
 *
 * An UP matches on the code alone: by the time the main key of a chord comes
 * up its modifiers may already have, and the up must still be recognised.
 *
 * A DOWN of a bare modifier ignores the flag the key sets for itself (Right Alt
 * arrives with alt already true) and wants every OTHER modifier up, since Shift
 * held first is a chord, not the solo key. The one exception is Ctrl on
 * AltRight, which is AltGr. It is forgiven without checking that a ControlLeft
 * was seen first, deliberately: the strict reading would make the default key
 * dead on the owner's own keyboard if that event ever went missing, while the
 * loose reading costs only that a real Ctrl+Right Alt, held alone, dictates.
 *
 * A DOWN of a chord or a plain key matches its modifiers exactly.
 */
export function isHotkeyEvent(evt: KeyEvt | KeyChord, hotkey: Hotkey): boolean {
  if (evt.type === 'tick' || evt.type === 'blur') return false
  if (evt.code !== hotkey.code) return false
  if (evt.type === 'up') return true
  if (!isBareModifier(hotkey)) return FLAGS.every((f) => evt[f] === hotkey[f])
  const own = MODIFIER_FLAG[hotkey.code]
  return FLAGS.every((f) => f === own || !evt[f] || (f === 'ctrl' && hotkey.code === 'AltRight'))
}

/**
 * One event in, the next state out, plus what the host must DO about it.
 *
 * What the host owes the reducer: every keydown and keyup of the window (capture
 * phase, before xterm), a 'blur' when the window loses focus, and one 'tick' at
 * downAt + holdMs while the phase is 'arming'. Hold mode starts ONLY on an event
 * at or after holdMs while the key is still down; a release that no tick came
 * before is only a release, since a 'start' and a 'stop' cannot both ride on one
 * event and a recording that would already be over is not worth starting.
 */
export function reduceKey(state: KeyState, evt: KeyEvt, cfg: KeyConfig): KeyResult {
  const holdMs = cfg.holdMs ?? DEFAULT_HOLD_MS
  const bare = isBareModifier(cfg.hotkey)
  const stay = (swallow = false): KeyResult => ({ state, action: null, swallow })
  /** Hold mode's wait is over: the key has been down, alone, for holdMs. */
  const ripe = bare && cfg.mode === 'hold' && state.phase === 'arming' && evt.at - state.downAt >= holdMs

  if (evt.type === 'blur') {
    // The up will never arrive in a window that is not looking, so nothing may
    // be left held. A recording that loses its window is cancelled rather than
    // pasted: the text would land in a shell the user has walked away from.
    return { state: initialKeyState(), action: state.phase === 'listening' ? 'cancel' : null, swallow: false }
  }

  if (evt.type === 'tick') {
    if (ripe) return { state: { ...state, phase: 'listening' }, action: 'start', swallow: false }
    // Toggle mode: held past a tap is not a tap. The key stays `held`, so its up is still ours.
    if (state.phase === 'arming' && cfg.mode === 'toggle' && evt.at - state.downAt >= TAP_MAX_MS) {
      return { state: { ...state, phase: 'idle', polluted: true }, action: null, swallow: false }
    }
    return stay()
  }

  const own = evt.code === cfg.hotkey.code

  if (evt.type === 'up') {
    if (own && state.held) return release(state, evt.at, cfg.mode, bare)
    if (evt.code === 'Escape' && state.escHeld) return { state: { ...state, escHeld: false }, action: null, swallow: true }
    // Any other up, the synthetic ControlLeft's included, says nothing: only a
    // DOWN is somebody pressing a second key.
    return stay()
  }

  // ---- a key going down ----

  if (own && state.held) {
    // Auto-repeat of the hotkey (or a down with the repeat flag lost): part of
    // the same press. It never arms again, but it is an event like any other
    // and can carry the start if the host's tick is late.
    if (ripe) return { state: { ...state, phase: 'listening' }, action: 'start', swallow: true }
    return stay(true)
  }

  if (!evt.repeat && isHotkeyEvent(evt, cfg.hotkey)) return press(state, evt, cfg.mode, bare)

  if (evt.code === 'Escape' && state.phase === 'listening') {
    // `polluted` so that in toggle mode an Escape pressed MID-TAP does not let
    // the tap's own up start a fresh recording a moment after the cancel.
    return { state: { ...state, phase: 'idle', polluted: true, escHeld: true }, action: 'cancel', swallow: true }
  }

  if (state.held && bare) {
    // AltGr's other half is not a second key. On those layouts it precedes
    // AltRight, repeats beside it for as long as the pair is held, and is
    // forgiven a moment after the down as well in case the order ever flips.
    const altGrCtrl =
      cfg.hotkey.code === 'AltRight' &&
      evt.code === 'ControlLeft' &&
      (state.altGr || evt.at - state.downAt <= ALTGR_PAIR_MS)
    if (altGrCtrl) return stay()
    if (state.phase === 'arming') {
      // Escape means "no" wherever it lands: a late tick must not turn it into a start.
      if (evt.code === 'Escape') return { state: { ...state, phase: 'idle', polluted: true }, action: null, swallow: false }
      // Held alone for the whole of holdMs, THEN a key: that is dictation that
      // began, not AltGr typing. Before it: AltGr typing, cancelled without a
      // word, and the key that gave it away goes on to the shell untouched.
      if (ripe) return { state: { ...state, phase: 'listening', polluted: true }, action: 'start', swallow: false }
      return { state: { ...state, phase: 'idle', polluted: true }, action: null, swallow: false }
    }
    // While LISTENING a brushed key cancels nothing (owner's rule: the user may
    // shift in their seat). It only spoils a toggle tap that is in progress.
    if (!state.polluted) return { state: { ...state, polluted: true }, action: null, swallow: false }
  }

  return stay()
}

/** A fresh, matching, non-repeat down of the hotkey. */
function press(state: KeyState, evt: Extract<KeyEvt, { type: 'down' | 'up' }>, mode: DictMode, bare: boolean): KeyResult {
  const held: KeyState = {
    ...state,
    held: true,
    downAt: evt.at,
    polluted: false,
    altGr: bare && evt.code === 'AltRight' && evt.ctrl
  }
  if (bare) {
    // Nothing is decided yet in either mode. From idle the press is 'arming';
    // while listening (a toggle's second tap) the phase holds until the up.
    return { state: { ...held, phase: state.phase === 'idle' ? 'arming' : state.phase }, action: null, swallow: true }
  }
  if (state.phase === 'listening') {
    // Toggle: the second press stops. Hold: a press while already listening can
    // only follow an up that was never seen; keep listening and let this up stop it.
    if (mode === 'toggle') return { state: { ...held, phase: 'idle' }, action: 'stop', swallow: true }
    return { state: held, action: null, swallow: true }
  }
  return { state: { ...held, phase: 'listening' }, action: 'start', swallow: true }
}

/** The up of a hotkey the reducer saw go down. Always swallowed: an unswallowed
 *  Alt keyup is what opens the window's system menu. */
function release(state: KeyState, at: number, mode: DictMode, bare: boolean): KeyResult {
  const next: KeyState = { ...state, held: false, polluted: false, altGr: false }
  if (mode === 'hold') {
    // Arming: let go before holdMs (or before any tick said otherwise). Idle:
    // the press was cancelled by Escape or by AltGr typing. Neither stops anything.
    if (state.phase === 'listening') return { state: { ...next, phase: 'idle' }, action: 'stop', swallow: true }
    return { state: { ...next, phase: 'idle' }, action: null, swallow: true }
  }
  if (!bare) return { state: next, action: null, swallow: true }
  const tap = !state.polluted && at - state.downAt < TAP_MAX_MS
  if (state.phase === 'arming') {
    return tap
      ? { state: { ...next, phase: 'listening' }, action: 'start', swallow: true }
      : { state: { ...next, phase: 'idle' }, action: null, swallow: true }
  }
  if (state.phase === 'listening' && tap) return { state: { ...next, phase: 'idle' }, action: 'stop', swallow: true }
  return { state: next, action: null, swallow: true }
}

// ---- naming and binding ------------------------------------------------------

const SIDE_NAMES: Record<string, string> = {
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  MetaLeft: 'Left Win',
  MetaRight: 'Right Win'
}

const KEY_NAMES: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  PrintScreen: 'Print Screen',
  ScrollLock: 'Scroll Lock',
  CapsLock: 'Caps Lock',
  NumLock: 'Num Lock',
  ContextMenu: 'Menu',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  NumpadEnter: 'Num Enter'
}

/** The key's name by POSITION (a US legend), since the binding is by position:
 *  it cannot know what the user's layout prints on that cap, and must not guess. */
function keyName(code: string): string {
  if (code in SIDE_NAMES) return SIDE_NAMES[code]
  if (code in KEY_NAMES) return KEY_NAMES[code]
  const m = /^(Key|Digit|Numpad)(.+)$/.exec(code)
  if (m) return m[1] === 'Numpad' ? `Num ${m[2]}` : m[2]
  return code
}

/** 'Right Alt', 'Ctrl+Shift+D': what Settings shows for a binding. */
export function formatHotkey(h: Hotkey): string {
  const parts: string[] = []
  if (h.ctrl) parts.push('Ctrl')
  if (h.alt) parts.push('Alt')
  if (h.shift) parts.push('Shift')
  if (h.meta) parts.push('Win')
  parts.push(keyName(h.code))
  return parts.join('+')
}

/**
 * What this key event would be as a binding, for the rebind control.
 *
 * A modifier's own event is that modifier BARE, its flags dropped: its own flag
 * is the key itself, and the Ctrl that rides on AltRight is AltGr, so the
 * Norwegian Right Alt binds as Right Alt rather than as Ctrl+Right Alt. That
 * means the control sees 'Left Ctrl' on the way to Ctrl+Shift+D; it should
 * commit a bare modifier on that key's UP and a chord on the main key's down.
 * Escape is null: it is how the user leaves the control, and as a binding it
 * would take away the one key that cancels a recording.
 *
 * Takes the reducer's own event OR a DOM KeyboardEvent as it comes: the rebind
 * control lives in Settings, has no reducer running, and should not have to
 * build a KeyEvt only to ask what was pressed.
 */
export function parseHotkeyFromEvent(evt: KeyEvt | KeyChord | DomKeyLike): Hotkey | null {
  if ('ctrlKey' in evt) return parseHotkeyFromEvent(keyEvtFromDom('down', evt, 0))
  if (evt.type === 'tick' || evt.type === 'blur') return null
  if (!evt.code || evt.code === 'Unidentified' || evt.code === 'Escape') return null
  if (evt.code in MODIFIER_FLAG) return { code: evt.code, ctrl: false, alt: false, shift: false, meta: false }
  return { code: evt.code, ctrl: evt.ctrl, alt: evt.alt, shift: evt.shift, meta: evt.meta }
}

/**
 * Whether a key may be the dictation key at all (code review 2026-09-24, #27).
 * Dictation swallows its key in every shell, so a key that TYPES (a letter,
 * Enter, Space, a Shift+letter) would stop the terminal from typing it until
 * somebody found Reset, and a chord the terminal owns (Ctrl+C, Ctrl+V, the tab
 * chords) would take that job away. Allowed: a bare modifier (the default is
 * Right Alt), a function key or Pause / Scroll Lock alone, or a chord with Ctrl,
 * Alt or Win that the terminal does not already use.
 */
export function usableHotkey(h: Hotkey): boolean {
  if (isBareModifier(h)) return true
  if (!h.ctrl && !h.alt && !h.meta)
    return /^F([1-9]|1[0-9]|2[0-4])$/.test(h.code) || h.code === 'Pause' || h.code === 'ScrollLock'
  if (h.ctrl && !h.alt && !h.meta && /^(Key[CVWTF]|Tab|Digit[1-9]|Comma)$/.test(h.code)) return false
  return true
}

/** The fields of a DOM KeyboardEvent the reducer reads, named structurally so
 *  this file stays free of the DOM. */
export interface DomKeyLike {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat?: boolean
}

/** A keyboard event as the reducer takes it. `at` is the host's clock
 *  (performance.now()), the same one its tick is measured on. */
export function keyEvtFromDom(type: 'down' | 'up', e: DomKeyLike, at: number): KeyEvt {
  return {
    type,
    code: e.code,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    repeat: e.repeat ?? false,
    at
  }
}
