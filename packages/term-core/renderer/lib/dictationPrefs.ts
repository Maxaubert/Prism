import { useSyncExternalStore } from 'react'
import { DEFAULT_HOTKEY, usableHotkey, type DictMode, type Hotkey } from './dictationKey'
import { readPref, writePref } from './prefStore'
import { dictationHost } from '../host'

/**
 * Dictation's settings (#13). VALUES ARE PER APP: each app has its own
 * localStorage, so switching it on in Prism Terminal switches nothing on in
 * Prism. Only the big files (models, the GPU pack) are shared, by main.
 *
 * OFF BY DEFAULT, and every reader treats a missing key as off: nothing
 * listens, nothing downloads and no server runs until the user says so.
 */
const K = {
  enabled: 'prism.dictation.enabled',
  mode: 'prism.dictation.mode',
  hotkey: 'prism.dictation.hotkey',
  mic: 'prism.dictation.mic',
  language: 'prism.dictation.language',
  pauseMedia: 'prism.dictation.pauseMedia',
  sounds: 'prism.dictation.sounds',
  model: 'prism.dictation.model'
} as const

export const DICTATION_KEYS = K

const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())
const sub = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const read = readPref
const write = (key: string, value: string): void => {
  writePref(key, value)
  notify()
}

export const dictationEnabled = (): boolean => read(K.enabled) === '1'
export const setDictationEnabled = (on: boolean): void => write(K.enabled, on ? '1' : '0')

/** Hold-to-talk is the default (owner, 2026-09-19). */
export const dictationMode = (): DictMode => (read(K.mode) === 'toggle' ? 'toggle' : 'hold')
export const setDictationMode = (m: DictMode): void => write(K.mode, m)

/** What "nothing saved" means: the host's declared key, else the core's
 *  Ctrl+Win (see `dictation.defaultHotkey` in host.ts). */
export const defaultDictationHotkey = (): Hotkey => dictationHost()?.defaultHotkey ?? DEFAULT_HOTKEY

// Parsed once per stored string AND default: useSyncExternalStore needs a
// STABLE snapshot, and a fresh object per read would re-render for ever. The
// default is part of the key because a read can come before the host speaks.
let hotkeyRaw: string | null = null
let hotkeyDefault: Hotkey | null = null
let hotkeyParsed: Hotkey = DEFAULT_HOTKEY
export function dictationHotkey(): Hotkey {
  const raw = read(K.hotkey)
  const fallback = defaultDictationHotkey()
  if (raw === hotkeyRaw && fallback === hotkeyDefault) return hotkeyParsed
  hotkeyRaw = raw
  hotkeyDefault = fallback
  hotkeyParsed = fallback
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<Hotkey>
      const hk = typeof v.code === 'string' && v.code
        ? { code: v.code, ctrl: !!v.ctrl, alt: !!v.alt, shift: !!v.shift, meta: !!v.meta }
        : null
      // A key that types, saved before the rule existed, reads as the default.
      if (hk && usableHotkey(hk)) hotkeyParsed = hk
    } catch {
      /* a damaged value reads as the default */
    }
  }
  return hotkeyParsed
}
export const setDictationHotkey = (h: Hotkey): void => write(K.hotkey, JSON.stringify(h))

/** '' is the system default input. */
export const dictationMic = (): string => read(K.mic) ?? ''
export const setDictationMic = (id: string): void => write(K.mic, id)

/** 'auto', or a language code Whisper knows. */
export const dictationLanguage = (): string => {
  const v = read(K.language)
  return v && /^[a-z]{2,4}$/.test(v) ? v : 'auto'
}
export const setDictationLanguage = (code: string): void => write(K.language, code)

export const dictationPauseMedia = (): boolean => read(K.pauseMedia) === '1'
export const setDictationPauseMedia = (on: boolean): void => write(K.pauseMedia, on ? '1' : '0')

/** On unless switched off: the cue is how you know the mic opened without looking. */
export const dictationSounds = (): boolean => read(K.sounds) !== '0'
export const setDictationSounds = (on: boolean): void => write(K.sounds, on ? '1' : '0')

/** The ACTIVE model's catalog id, '' when none was ever chosen. */
export const dictationModel = (): string => read(K.model) ?? ''
export const setDictationModel = (id: string): void => write(K.model, id)

export const useDictationEnabled = (): boolean => useSyncExternalStore(sub, dictationEnabled)
export const useDictationMode = (): DictMode => useSyncExternalStore(sub, dictationMode)
export const useDictationHotkey = (): Hotkey => useSyncExternalStore(sub, dictationHotkey)
export const useDictationMic = (): string => useSyncExternalStore(sub, dictationMic)
export const useDictationLanguage = (): string => useSyncExternalStore(sub, dictationLanguage)
export const useDictationPauseMedia = (): boolean => useSyncExternalStore(sub, dictationPauseMedia)
export const useDictationSounds = (): boolean => useSyncExternalStore(sub, dictationSounds)
export const useDictationModel = (): string => useSyncExternalStore(sub, dictationModel)
export const onDictationPrefs = sub
