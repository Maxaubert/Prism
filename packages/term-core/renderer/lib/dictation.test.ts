import { beforeEach, describe, expect, it, vi } from 'vitest'

// The controller against fakes (code review 2026-09-24, #4): a key that only
// says "start" on down and "stop" on up, a microphone that always has a clip,
// and an engine whose answer the test releases by hand.
const pasted: string[] = []
let answer: (text: string) => void = () => {}

vi.mock('./dictationKey', () => ({
  initialKeyState: () => ({}),
  reduceKey: (_s: unknown, evt: { type: string }) => ({
    state: {},
    swallow: false,
    action: evt.type === 'down' ? 'start' : evt.type === 'up' ? 'stop' : null
  })
}))
vi.mock('./micCapture', () => ({
  TARGET_RATE: 16000,
  startCapture: async () => ({
    seconds: () => 2,
    snapshot: () => new Float32Array(16000 * 2),
    stop: () => {}
  })
}))
vi.mock('./dictationSounds', () => ({ startCue: async () => {}, stopCue: async () => {}, cancelCue: () => {} }))
vi.mock('./termBus', () => ({
  pasteTextInto: (_id: string, text: string) => {
    pasted.push(text)
    return true
  }
}))
vi.mock('./dictationPrefs', () => ({
  dictationEnabled: () => true,
  dictationHotkey: () => 'AltRight',
  dictationLanguage: () => 'en',
  dictationMic: () => '',
  dictationMode: () => 'hold',
  dictationModel: () => 'tiny',
  dictationPauseMedia: () => false,
  dictationSounds: () => false,
  onDictationPrefs: () => () => {}
}))
vi.mock('../host', () => ({
  dictationHost: () => ({
    canDictate: () => true,
    api: {
      dictationStop: () => {},
      dictationTranscribe: (req: { final: boolean }) =>
        req.final ? new Promise((done) => (answer = (text) => done({ ok: true, text }))) : new Promise(() => {})
    }
  })
}))

// A window that holds listeners, which is all the controller asks of one.
const listeners = new Map<string, Set<(e: unknown) => void>>()
Object.assign(globalThis, {
  window: {
    addEventListener: (t: string, l: (e: unknown) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set())
      listeners.get(t)!.add(l)
    },
    removeEventListener: (t: string, l: (e: unknown) => void) => listeners.get(t)?.delete(l),
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    setInterval: () => 0
  }
})
const key = (type: 'keydown' | 'keyup'): void =>
  listeners.get(type)?.forEach((l) => l({ type, code: 'AltRight', preventDefault() {}, stopPropagation() {} }))
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const { armDictation, dictationView } = await import('./dictation')

beforeEach(() => {
  pasted.length = 0
})

describe('a second hold while the last clip is transcribing (#4)', () => {
  it('pastes the clip once, not twice', async () => {
    const off = armDictation(() => 'tab-1')
    key('keydown')
    await settle()
    key('keyup')
    await settle()
    expect(dictationView().phase).toBe('transcribing')
    const first = answer
    // The next sentence, while the first is still being heard.
    key('keydown')
    await settle()
    key('keyup')
    await settle()
    first('hello there')
    await settle()
    answer('hello there') // a second final, if one had been asked for
    await settle()
    expect(pasted).toEqual(['hello there '])
    off()
  })

  it('Escape while transcribing drops the clip', async () => {
    const off = armDictation(() => 'tab-1')
    key('keydown')
    await settle()
    key('keyup')
    await settle()
    off() // disarming cancels, as Escape does
    answer('never pasted')
    await settle()
    expect(pasted).toEqual([])
    expect(dictationView().phase).toBe('idle')
  })
})
