import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOTKEY,
  usableHotkey,
  formatHotkey,
  initialKeyState,
  isHotkeyEvent,
  keyEvtFromDom,
  parseHotkeyFromEvent,
  reduceKey,
  type DictMode,
  type Hotkey,
  type KeyAction,
  type KeyEvt,
  type KeyState
} from './dictationKey'

type Mods = Partial<Pick<Hotkey, 'ctrl' | 'alt' | 'shift' | 'meta'>> & { repeat?: boolean }

const key = (type: 'down' | 'up', code: string, at: number, m: Mods = {}): KeyEvt => ({
  type,
  code,
  at,
  ctrl: m.ctrl ?? false,
  alt: m.alt ?? false,
  shift: m.shift ?? false,
  meta: m.meta ?? false,
  repeat: m.repeat
})
const down = (code: string, at: number, m?: Mods): KeyEvt => key('down', code, at, m)
const up = (code: string, at: number, m?: Mods): KeyEvt => key('up', code, at, m)
const tick = (at: number): KeyEvt => ({ type: 'tick', at })
const blur = (at: number): KeyEvt => ({ type: 'blur', at })

/** Right Alt as a US layout reports it: the key carries its own alt flag. */
const raltDown = (at: number, m: Mods = {}): KeyEvt => down('AltRight', at, { alt: true, ...m })
const raltUp = (at: number): KeyEvt => up('AltRight', at)

interface Step {
  action: KeyAction
  swallow: boolean
  phase: KeyState['phase']
}

/** Feed a whole sequence through the reducer and keep what each event answered. */
function run(
  events: KeyEvt[],
  mode: DictMode,
  hotkey: Hotkey = DEFAULT_HOTKEY,
  holdMs?: number
): { steps: Step[]; actions: KeyAction[]; state: KeyState } {
  let state = initialKeyState()
  const steps: Step[] = []
  for (const evt of events) {
    const r = reduceKey(state, evt, { hotkey, mode, holdMs })
    state = r.state
    steps.push({ action: r.action, swallow: r.swallow, phase: r.state.phase })
  }
  return { steps, actions: steps.map((s) => s.action).filter((a) => a !== null), state }
}

const CHORD: Hotkey = { code: 'KeyD', ctrl: true, alt: false, shift: true, meta: false }
const F9: Hotkey = { code: 'F9', ctrl: false, alt: false, shift: false, meta: false }

describe('the default', () => {
  it('is a bare Right Alt', () => {
    expect(DEFAULT_HOTKEY).toEqual({ code: 'AltRight', ctrl: false, alt: false, shift: false, meta: false })
  })
  it('starts idle', () => {
    expect(initialKeyState().phase).toBe('idle')
  })
})

describe('hold mode, bare modifier', () => {
  it('a clean 250 ms hold starts, then stops on release', () => {
    const r = run([raltDown(0), tick(100), tick(200), raltUp(250)], 'hold')
    expect(r.steps.map((s) => s.phase)).toEqual(['arming', 'arming', 'listening', 'idle'])
    expect(r.actions).toEqual(['start', 'stop'])
  })

  it('starts on the tick at exactly holdMs, and not one millisecond sooner', () => {
    const r = run([raltDown(1000), tick(1199), tick(1200)], 'hold')
    expect(r.steps.map((s) => s.action)).toEqual([null, null, 'start'])
  })

  it('honours a holdMs of its own', () => {
    const r = run([raltDown(0), tick(200), tick(350)], 'hold', DEFAULT_HOTKEY, 350)
    expect(r.steps.map((s) => s.action)).toEqual([null, null, 'start'])
  })

  it('the Norwegian AltGr sequence types an @ and never starts', () => {
    // Windows reports AltGr as ControlLeft then AltRight, both flags up on the second.
    const t = 5000
    const r = run(
      [
        down('ControlLeft', t, { ctrl: true }),
        down('AltRight', t + 1, { ctrl: true, alt: true }),
        tick(t + 50),
        down('Digit2', t + 80, { ctrl: true, alt: true }),
        up('Digit2', t + 140, { ctrl: true, alt: true }),
        tick(t + 300),
        up('ControlLeft', t + 320, { alt: true }),
        up('AltRight', t + 321),
        tick(t + 600)
      ],
      'hold'
    )
    expect(r.actions).toEqual([])
    expect(r.state.phase).toBe('idle')
    // The @ itself must reach the shell: neither half of Digit2 is swallowed.
    expect(r.steps[3].swallow).toBe(false)
    expect(r.steps[4].swallow).toBe(false)
    // The synthetic Ctrl is not the hotkey either.
    expect(r.steps[0].swallow).toBe(false)
  })

  it('AltGr held ALONE on that layout still dictates: its own Ctrl is not another key', () => {
    const r = run(
      [
        down('ControlLeft', 0, { ctrl: true }),
        down('AltRight', 1, { ctrl: true, alt: true }),
        // Auto-repeat of the pair while it is held.
        down('ControlLeft', 40, { ctrl: true, alt: true, repeat: true }),
        down('AltRight', 41, { ctrl: true, alt: true, repeat: true }),
        down('ControlLeft', 120, { ctrl: true, alt: true, repeat: true }),
        tick(201),
        up('ControlLeft', 900, { alt: true }),
        up('AltRight', 901)
      ],
      'hold'
    )
    expect(r.actions).toEqual(['start', 'stop'])
  })

  it('a synthetic Ctrl landing just AFTER Right Alt is forgiven too', () => {
    const r = run([raltDown(0), down('ControlLeft', 3, { ctrl: true, alt: true }), tick(200)], 'hold')
    expect(r.actions).toEqual(['start'])
  })

  it('a real Left Ctrl pressed well into the arming cancels it', () => {
    const r = run([raltDown(0), down('ControlLeft', 120, { ctrl: true, alt: true }), tick(200), tick(400)], 'hold')
    expect(r.actions).toEqual([])
    expect(r.state.phase).toBe('idle')
  })

  it('another key during arming cancels silently, and that key is not swallowed', () => {
    const r = run([raltDown(0), down('KeyQ', 90, { alt: true }), tick(200), tick(500), raltUp(600)], 'hold')
    expect(r.actions).toEqual([])
    expect(r.steps[1]).toEqual({ action: null, swallow: false, phase: 'idle' })
    // The hotkey's own up is still ours, cancelled or not.
    expect(r.steps[4].swallow).toBe(true)
  })

  it('does not re-arm from the auto-repeat of a press that was cancelled', () => {
    const r = run(
      [raltDown(0), down('KeyQ', 50, { alt: true }), raltDown(80, { repeat: true }), raltDown(110), tick(400)],
      'hold'
    )
    expect(r.actions).toEqual([])
    expect(r.state.phase).toBe('idle')
    expect(r.steps[2].swallow).toBe(true)
  })

  it('release during arming goes back to idle with no action', () => {
    const r = run([raltDown(0), raltUp(120), tick(300)], 'hold')
    expect(r.actions).toEqual([])
    expect(r.steps[1]).toEqual({ action: null, swallow: true, phase: 'idle' })
  })

  it('a release nobody ticked before is still only a release', () => {
    // The host's timer never fired, so nothing was started and nothing may stop.
    const r = run([raltDown(0), raltUp(400)], 'hold')
    expect(r.actions).toEqual([])
  })

  it('auto-repeat of the hotkey is swallowed, changes nothing, and can carry the start', () => {
    const r = run([raltDown(0), raltDown(30, { repeat: true }), raltDown(230, { repeat: true }), raltUp(500)], 'hold')
    expect(r.steps.map((s) => s.action)).toEqual([null, null, 'start', 'stop'])
    expect(r.steps.every((s) => s.swallow)).toBe(true)
  })

  it('another key while LISTENING does not cancel, and is not swallowed', () => {
    const r = run([raltDown(0), tick(200), down('KeyJ', 900, { alt: true }), up('KeyJ', 950), raltUp(1500)], 'hold')
    expect(r.actions).toEqual(['start', 'stop'])
    expect(r.steps[2]).toEqual({ action: null, swallow: false, phase: 'listening' })
  })

  it('Escape while listening cancels and is swallowed, down and up', () => {
    const r = run([raltDown(0), tick(200), down('Escape', 700, { alt: true }), up('Escape', 760), raltUp(900)], 'hold')
    expect(r.actions).toEqual(['start', 'cancel'])
    expect(r.steps[2]).toEqual({ action: 'cancel', swallow: true, phase: 'idle' })
    expect(r.steps[3].swallow).toBe(true)
    // The key is still down after the cancel: its up is ours and stops nothing.
    expect(r.steps[4]).toEqual({ action: null, swallow: true, phase: 'idle' })
  })

  it('Escape when nothing is listening is an ordinary key', () => {
    const r = run([down('Escape', 0), up('Escape', 50)], 'hold')
    expect(r.steps.every((s) => !s.swallow && s.action === null)).toBe(true)
  })

  it('blur while listening cancels', () => {
    const r = run([raltDown(0), tick(200), blur(800)], 'hold')
    expect(r.actions).toEqual(['start', 'cancel'])
    expect(r.state.phase).toBe('idle')
  })

  it('blur while arming goes to idle without a word', () => {
    const r = run([raltDown(0), blur(100), tick(300)], 'hold')
    expect(r.actions).toEqual([])
    expect(r.state.phase).toBe('idle')
  })

  it('an up the reducer never saw the down of is not swallowed', () => {
    const r = run([raltUp(10)], 'hold')
    expect(r.steps[0]).toEqual({ action: null, swallow: false, phase: 'idle' })
  })

  it('Shift already down means it is not the solo hotkey', () => {
    const r = run([down('ShiftLeft', 0, { shift: true }), raltDown(20, { shift: true }), tick(400)], 'hold')
    expect(r.actions).toEqual([])
    expect(r.steps[1].swallow).toBe(false)
  })

  it('ticks while idle do nothing', () => {
    const r = run([tick(0), tick(1000)], 'hold')
    expect(r.steps.every((s) => s.action === null && !s.swallow && s.phase === 'idle')).toBe(true)
  })
})

describe('toggle mode, bare modifier', () => {
  it('a solo tap starts and the next solo tap stops', () => {
    const r = run([raltDown(0), raltUp(90), down('KeyA', 500), up('KeyA', 560), raltDown(3000), raltUp(3120)], 'toggle')
    expect(r.steps.map((s) => s.action)).toEqual([null, 'start', null, null, null, 'stop'])
    expect(r.steps.map((s) => s.phase)).toEqual(['arming', 'listening', 'listening', 'listening', 'listening', 'idle'])
    // Typing while it listens goes to the shell.
    expect(r.steps[2].swallow).toBe(false)
    expect([0, 1, 4, 5].every((i) => r.steps[i].swallow)).toBe(true)
  })

  it('a slow tap still counts, up to a second', () => {
    expect(run([raltDown(0), raltUp(999)], 'toggle').actions).toEqual(['start'])
    expect(run([raltDown(0), raltUp(1000)], 'toggle').actions).toEqual([])
  })

  it('a tap polluted by another key does nothing (AltGr typing)', () => {
    const r = run(
      [
        down('ControlLeft', 0, { ctrl: true }),
        down('AltRight', 1, { ctrl: true, alt: true }),
        down('Digit2', 60, { ctrl: true, alt: true }),
        up('Digit2', 110, { ctrl: true, alt: true }),
        up('ControlLeft', 150, { alt: true }),
        up('AltRight', 151)
      ],
      'toggle'
    )
    expect(r.actions).toEqual([])
    expect(r.state.phase).toBe('idle')
  })

  it('a solo AltGr tap on that layout is a tap', () => {
    const r = run(
      [
        down('ControlLeft', 0, { ctrl: true }),
        down('AltRight', 1, { ctrl: true, alt: true }),
        up('ControlLeft', 80, { alt: true }),
        up('AltRight', 81)
      ],
      'toggle'
    )
    expect(r.actions).toEqual(['start'])
  })

  it('a polluted tap while listening does not stop it', () => {
    const r = run(
      [raltDown(0), raltUp(80), raltDown(1000), down('KeyQ', 1050, { alt: true }), up('KeyQ', 1100), raltUp(1150)],
      'toggle'
    )
    expect(r.actions).toEqual(['start'])
    expect(r.state.phase).toBe('listening')
  })

  it('never starts from holding the key down', () => {
    const r = run([raltDown(0), tick(200), tick(800), tick(1200), raltUp(1500)], 'toggle')
    expect(r.actions).toEqual([])
    expect(r.state.phase).toBe('idle')
  })

  it('Escape cancels, and an Escape pressed mid-tap does not let the tap start again', () => {
    const r = run([raltDown(0), raltUp(50), raltDown(900), down('Escape', 950, { alt: true }), raltUp(1000)], 'toggle')
    expect(r.actions).toEqual(['start', 'cancel'])
    expect(r.state.phase).toBe('idle')
  })

  it('blur cancels a listening toggle', () => {
    const r = run([raltDown(0), raltUp(50), blur(400)], 'toggle')
    expect(r.actions).toEqual(['start', 'cancel'])
  })
})

describe('a chord or a plain key', () => {
  it('hold: starts on the down at once and stops on the up of the main key', () => {
    const r = run(
      [
        down('ControlLeft', 0, { ctrl: true }),
        down('ShiftLeft', 10, { ctrl: true, shift: true }),
        down('KeyD', 20, { ctrl: true, shift: true }),
        down('KeyD', 60, { ctrl: true, shift: true, repeat: true }),
        // The modifiers may let go first: the main key is what is being held.
        up('ShiftLeft', 400, { ctrl: true }),
        down('KeyD', 420, { ctrl: true, repeat: true }),
        up('KeyD', 900, { ctrl: true }),
        up('ControlLeft', 950)
      ],
      'hold',
      CHORD
    )
    expect(r.steps.map((s) => s.action)).toEqual([null, null, 'start', null, null, null, 'stop', null])
    expect(r.steps.map((s) => s.swallow)).toEqual([false, false, true, true, false, true, true, false])
  })

  it('hold: a plain F9 needs no holdMs and no solo rule', () => {
    const r = run([down('F9', 0), down('KeyA', 5), up('F9', 40)], 'hold', F9)
    expect(r.actions).toEqual(['start', 'stop'])
  })

  it('toggle: each non-repeat down toggles, repeats and ups do nothing', () => {
    const r = run(
      [down('F9', 0), down('F9', 40, { repeat: true }), up('F9', 90), down('F9', 2000), up('F9', 2050)],
      'toggle',
      F9
    )
    expect(r.steps.map((s) => s.action)).toEqual(['start', null, null, 'stop', null])
    expect(r.steps.every((s) => s.swallow)).toBe(true)
  })

  it('the main key with the wrong modifiers is somebody else\'s key', () => {
    const r = run([down('KeyD', 0, { ctrl: true }), down('F9', 10, { shift: true })], 'hold', CHORD)
    expect(r.steps.every((s) => s.action === null && !s.swallow)).toBe(true)
  })

  it('Escape and blur cancel here too', () => {
    expect(run([down('F9', 0), down('Escape', 300)], 'hold', F9).actions).toEqual(['start', 'cancel'])
    expect(run([down('F9', 0), up('F9', 40), blur(300)], 'toggle', F9).actions).toEqual(['start', 'cancel'])
  })

  it('hold: after an Escape the still-held key stops nothing on its way up', () => {
    const r = run([down('F9', 0), down('Escape', 300), down('F9', 330, { repeat: true }), up('F9', 600)], 'hold', F9)
    expect(r.actions).toEqual(['start', 'cancel'])
    expect(r.steps[3]).toEqual({ action: null, swallow: true, phase: 'idle' })
  })
})

describe('isHotkeyEvent', () => {
  it('a bare modifier matches itself, its own flag notwithstanding', () => {
    expect(isHotkeyEvent(raltDown(0), DEFAULT_HOTKEY)).toBe(true)
    expect(isHotkeyEvent(down('AltRight', 0, { ctrl: true, alt: true }), DEFAULT_HOTKEY)).toBe(true)
    expect(isHotkeyEvent(down('AltLeft', 0, { alt: true }), DEFAULT_HOTKEY)).toBe(false)
    expect(isHotkeyEvent(raltDown(0, { shift: true }), DEFAULT_HOTKEY)).toBe(false)
  })
  it('only Right Alt is forgiven a Ctrl: that is AltGr, and no other key has one', () => {
    const lalt: Hotkey = { ...DEFAULT_HOTKEY, code: 'AltLeft' }
    expect(isHotkeyEvent(down('AltLeft', 0, { ctrl: true, alt: true }), lalt)).toBe(false)
  })
  it('an up matches on the code alone, whatever is still held', () => {
    expect(isHotkeyEvent(up('AltRight', 0, { ctrl: true }), DEFAULT_HOTKEY)).toBe(true)
    expect(isHotkeyEvent(up('KeyD', 0), CHORD)).toBe(true)
  })
  it('a chord matches its modifiers exactly', () => {
    expect(isHotkeyEvent(down('KeyD', 0, { ctrl: true, shift: true }), CHORD)).toBe(true)
    expect(isHotkeyEvent(down('KeyD', 0, { ctrl: true }), CHORD)).toBe(false)
    expect(isHotkeyEvent(down('KeyD', 0, { ctrl: true, shift: true, alt: true }), CHORD)).toBe(false)
  })
  it('a tick and a blur are nobody\'s key', () => {
    expect(isHotkeyEvent(tick(0), DEFAULT_HOTKEY)).toBe(false)
    expect(isHotkeyEvent(blur(0), DEFAULT_HOTKEY)).toBe(false)
  })
})

describe('formatHotkey', () => {
  const h = (code: string, m: Mods = {}): Hotkey => ({
    code,
    ctrl: m.ctrl ?? false,
    alt: m.alt ?? false,
    shift: m.shift ?? false,
    meta: m.meta ?? false
  })
  it('names a bare modifier by its side', () => {
    expect(formatHotkey(DEFAULT_HOTKEY)).toBe('Right Alt')
    expect(formatHotkey(h('ControlLeft'))).toBe('Left Ctrl')
    expect(formatHotkey(h('ShiftRight'))).toBe('Right Shift')
    expect(formatHotkey(h('MetaLeft'))).toBe('Left Win')
  })
  it('writes a chord the way Windows does', () => {
    expect(formatHotkey(CHORD)).toBe('Ctrl+Shift+D')
    expect(formatHotkey(h('Digit2', { ctrl: true, alt: true }))).toBe('Ctrl+Alt+2')
    expect(formatHotkey(h('F9', { meta: true }))).toBe('Win+F9')
  })
  it('names the keys that are not letters', () => {
    expect(formatHotkey(F9)).toBe('F9')
    expect(formatHotkey(h('Space', { ctrl: true }))).toBe('Ctrl+Space')
    expect(formatHotkey(h('Backquote', { ctrl: true }))).toBe('Ctrl+`')
    expect(formatHotkey(h('ArrowUp'))).toBe('Up')
    expect(formatHotkey(h('Numpad5'))).toBe('Num 5')
    expect(formatHotkey(h('NumpadAdd'))).toBe('Num +')
    expect(formatHotkey(h('Pause'))).toBe('Pause')
  })
})

describe('parseHotkeyFromEvent', () => {
  it('a bare modifier press is that modifier, with its own flag dropped', () => {
    expect(parseHotkeyFromEvent(raltDown(0))).toEqual(DEFAULT_HOTKEY)
    expect(parseHotkeyFromEvent(down('ControlLeft', 0, { ctrl: true }))).toEqual({
      code: 'ControlLeft',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false
    })
  })
  it('AltGr is read as Right Alt, not as Ctrl+Right Alt', () => {
    expect(parseHotkeyFromEvent(down('AltRight', 0, { ctrl: true, alt: true }))).toEqual(DEFAULT_HOTKEY)
  })
  it('a chord keeps its modifiers', () => {
    expect(parseHotkeyFromEvent(down('KeyD', 0, { ctrl: true, shift: true }))).toEqual(CHORD)
    expect(parseHotkeyFromEvent(down('F9', 0))).toEqual(F9)
  })
  it('Escape is the way out of the rebind control, never a binding', () => {
    expect(parseHotkeyFromEvent(down('Escape', 0))).toBeNull()
    expect(parseHotkeyFromEvent(down('Escape', 0, { ctrl: true }))).toBeNull()
  })
  it('a key the browser could not name is no binding', () => {
    expect(parseHotkeyFromEvent(down('', 0))).toBeNull()
    expect(parseHotkeyFromEvent(down('Unidentified', 0))).toBeNull()
  })
  it('takes a DOM keyboard event as it comes', () => {
    const dom = { type: 'keydown', code: 'KeyD', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }
    expect(parseHotkeyFromEvent(dom)).toEqual(CHORD)
    const altGr = { type: 'keydown', code: 'AltRight', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }
    expect(parseHotkeyFromEvent(altGr)).toEqual(DEFAULT_HOTKEY)
    expect(parseHotkeyFromEvent({ ...dom, code: 'Escape' })).toBeNull()
  })
  it('round-trips through the reducer: what was bound is what is recognised', () => {
    const bound = parseHotkeyFromEvent(down('KeyD', 0, { ctrl: true, shift: true }))
    expect(bound).not.toBeNull()
    expect(run([down('KeyD', 0, { ctrl: true, shift: true })], 'toggle', bound as Hotkey).actions).toEqual(['start'])
  })
})

describe('keyEvtFromDom', () => {
  it('copies what the reducer reads off a keyboard event', () => {
    const dom = { code: 'AltRight', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false, repeat: true }
    expect(keyEvtFromDom('down', dom, 42)).toEqual({
      type: 'down',
      code: 'AltRight',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
      repeat: true,
      at: 42
    })
  })
})

// Code review 2026-09-24, #27: the dictation key is swallowed in every shell,
// so it may never be a key that types or a chord the terminal owns.
describe('usableHotkey', () => {
  const hk = (code: string, mods: Partial<Record<'ctrl' | 'alt' | 'shift' | 'meta', boolean>> = {}) => ({
    code,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
    ...mods
  })
  it('takes the default, a bare modifier, a function key and a free chord', () => {
    expect(usableHotkey(DEFAULT_HOTKEY)).toBe(true)
    expect(usableHotkey(hk('ControlLeft'))).toBe(true)
    expect(usableHotkey(hk('F9'))).toBe(true)
    expect(usableHotkey(hk('Pause'))).toBe(true)
    expect(usableHotkey(hk('KeyD', { ctrl: true, shift: true }))).toBe(true)
    expect(usableHotkey(hk('Space', { alt: true }))).toBe(true)
  })
  it('refuses a key that types, with or without Shift', () => {
    for (const code of ['KeyA', 'Enter', 'Space', 'Tab', 'Backspace', 'Digit1'])
      expect(usableHotkey(hk(code))).toBe(false)
    expect(usableHotkey(hk('KeyA', { shift: true }))).toBe(false)
  })
  it('refuses the chords the terminal owns', () => {
    for (const code of ['KeyC', 'KeyV', 'KeyW', 'KeyT', 'KeyF', 'Tab', 'Digit2', 'Comma'])
      expect(usableHotkey(hk(code, { ctrl: true }))).toBe(false)
    expect(usableHotkey(hk('KeyC', { ctrl: true, shift: true }))).toBe(false)
  })
})
