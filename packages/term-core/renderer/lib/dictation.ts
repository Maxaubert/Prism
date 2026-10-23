import { engineFor, languageFor } from '../../shared/dictationCatalog'
import { dictationHost } from '../host'
import { crumb } from './diag'
import { cleanTranscript } from './dictationClean'
import { initialKeyState, reduceKey, type KeyEvt, type KeyState } from './dictationKey'
import {
  dictationEnabled,
  dictationHotkey,
  dictationLanguage,
  dictationMic,
  dictationMode,
  dictationModel,
  dictationPauseMedia,
  dictationSounds,
  onDictationPrefs
} from './dictationPrefs'
import { cancelCue, startCue, stopCue } from './dictationSounds'
import { startCapture, TARGET_RATE, type Capture, type CaptureFailure } from './micCapture'
import { pasteTextInto } from './termBus'
import { encodeWav, tailSamples } from './wav'

/**
 * DICTATION'S CONTROLLER (#13): key -> microphone -> local engine -> paste.
 *
 * Outside React on purpose. The level meter moves at frame rate and the hook
 * that arms this is mounted in each host's App: state held in React there
 * would re-render the whole app thirty times a second while someone speaks.
 * So this is a small store (`dictationView` + `onDictationView`) for the few
 * things that change rarely, and a plain callback (`onDictationLevel`) for the
 * one that changes constantly, which the pill writes straight to the DOM.
 *
 * THE RULES IT KEEPS:
 * - Off means off: `armDictation` adds no listener until the setting is on,
 *   removes them when it goes off, and tells main to kill the server.
 * - Live text is PROVISIONAL and only ever shown; the one thing pasted is the
 *   final pass over the whole clip. Text typed into a prompt cannot be taken
 *   back, and a partial heard wrong at 6 s is corrected by 8 s (measured).
 * - The paste goes to the session that was in front when the recording
 *   STARTED: switching tabs mid-sentence must not drop your words into
 *   another agent's prompt.
 * - Never Enter, never a newline (see the panel's `pasteSpokenText` and `cleanTranscript`).
 */
export type DictPhase = 'idle' | 'listening' | 'transcribing'

export interface DictationView {
  phase: DictPhase
  /** The provisional text while listening. Shown, never pasted. */
  liveText: string
  /** A short line for the pill when something needs saying; null otherwise. */
  message: string | null
  /** The session being dictated into, for the mic mark on its tab. */
  sessionId: string | null
  /** The speech engine is still starting (model loading, and on the GPU the
   *  first compile), so there is no live text yet and a final waits for it. */
  starting: boolean
}

const IDLE: DictationView = { phase: 'idle', liveText: '', message: null, sessionId: null, starting: false }

/** Ask main to have the engine ready for the current model and language
 *  (2026-09-28): the first pass after a cold start compiled GPU kernels for
 *  half a minute, MEASURED, while the pill said "Transcribing". Idempotent in
 *  main, so it is asked freely. */
function warmEngine(): void {
  const host = dictationHost()
  const modelId = dictationModel()
  if (!host || !modelId) return
  host.api.dictationWarm?.({ modelId, language: languageFor(modelId, dictationLanguage()) })
}
let view: DictationView = IDLE
const viewListeners = new Set<() => void>()
const levelListeners = new Set<(level: number) => void>()

export const dictationView = (): DictationView => view
export function onDictationView(l: () => void): () => void {
  viewListeners.add(l)
  return () => {
    viewListeners.delete(l)
  }
}
/** 0..1, many times a second while listening. Write it to the DOM, not to state. */
export function onDictationLevel(l: (level: number) => void): () => void {
  levelListeners.add(l)
  return () => {
    levelListeners.delete(l)
  }
}
function setView(patch: Partial<DictationView>): void {
  // The timeline (#140): listening is a start, transcribing the stop, idle
  // the end of the pass. Never the text.
  if (patch.phase && patch.phase !== view.phase) crumb('dictation', { phase: patch.phase })
  view = { ...view, ...patch }
  viewListeners.forEach((l) => l())
}

/** A recording is capped (spec): nobody dictates for five minutes on purpose,
 *  and a key held down by a book must not fill memory. */
const MAX_SECONDS = 300
/** Whisper's window. A partial only ever needs the newest of it. */
const PARTIAL_WINDOW_S = 28
/** Below this there is nothing to transcribe: a brush of the key. */
const MIN_SECONDS = 0.35
const PARTIAL_EVERY_MS = 350
/** The least new audio between two partials. A Parakeet partial is a fresh
 *  process (0.7 to 0.9 s a pass, MEASURED), so it is asked at most about once
 *  a second (#121); the resident Whisper server can take one every 0.6 s. */
const PARTIAL_GAP_S = { whisper: 0.6, parakeet: 1 } as const
const MESSAGE_MS = 2600

const FAILURE_TEXT: Record<CaptureFailure, string> = {
  'no-device': 'No microphone found',
  denied: 'Microphone access was refused',
  unsupported: 'The microphone could not be opened',
  failed: 'The microphone could not be opened'
}

interface Recording {
  sessionId: string
  capture: Capture | null
  /** Set when stop or cancel arrives, before the mic has opened or after.
   *  Once set, a second stop is not heard (code review 2026-09-24, #4): a
   *  hold released while the last clip is still transcribing used to finish
   *  THAT clip again, and it was pasted twice. */
  ended: 'stop' | 'cancel' | null
  partialTimer: number | null
  partialBusy: boolean
  lastPartialAt: number
  mediaToken: Promise<string> | null
}

let rec: Recording | null = null
let messageTimer: number | null = null

function say(message: string): void {
  if (messageTimer !== null) clearTimeout(messageTimer)
  setView({ ...IDLE, message })
  messageTimer = window.setTimeout(() => {
    messageTimer = null
    if (view.phase === 'idle') setView({ message: null })
  }, MESSAGE_MS)
}

function resumeMedia(r: Recording): void {
  const api = dictationHost()?.api
  if (!api || !r.mediaToken) return
  void r.mediaToken.then((t) => {
    if (t) api.dictationMediaResume(t)
  })
}

function endCapture(r: Recording): Float32Array {
  if (r.partialTimer !== null) clearInterval(r.partialTimer)
  r.partialTimer = null
  const samples = r.capture?.snapshot() ?? new Float32Array(0)
  r.capture?.stop()
  levelListeners.forEach((l) => l(0))
  return samples
}

async function begin(sessionId: string): Promise<void> {
  const host = dictationHost()
  if (!host || rec) return
  const modelId = dictationModel()
  if (!modelId) {
    say('Choose a model in Settings')
    return
  }
  const r: Recording = {
    sessionId,
    capture: null,
    ended: null,
    partialTimer: null,
    partialBusy: false,
    lastPartialAt: 0,
    mediaToken: dictationPauseMedia() ? host.api.dictationMediaPause().catch(() => '') : null
  }
  rec = r
  if (messageTimer !== null) clearTimeout(messageTimer)
  setView({ phase: 'listening', liveText: '', message: null, sessionId, starting: false })
  // The engine may have stood down after its idle minutes: it warms while you
  // speak, so the words are not waiting on it when you let go.
  warmEngine()
  if (dictationSounds()) void startCue()

  try {
    r.capture = await startCapture({
      deviceId: dictationMic() || undefined,
      onLevel: (level) => levelListeners.forEach((l) => l(level))
    })
  } catch (err) {
    rec = null
    resumeMedia(r)
    say(FAILURE_TEXT[(typeof err === 'string' ? err : 'failed') as CaptureFailure] ?? FAILURE_TEXT.failed)
    return
  }
  // The key was released (or Escape pressed) while the mic was still opening.
  if (r.ended === 'cancel') return void finishCancel(r)
  if (r.ended === 'stop') return void finishStop(r)

  r.partialTimer = window.setInterval(() => {
    const cap = r.capture
    if (!cap || rec !== r) return
    if (cap.seconds() >= MAX_SECONDS) return void stop()
    if (r.partialBusy || cap.seconds() < 1 || cap.seconds() - r.lastPartialAt < PARTIAL_GAP_S[engineFor(modelId)]) return
    r.partialBusy = true
    r.lastPartialAt = cap.seconds()
    const wav = encodeWav(tailSamples(cap.snapshot(), TARGET_RATE, PARTIAL_WINDOW_S), TARGET_RATE)
    void host.api
      .dictationTranscribe({ wav, modelId, language: languageFor(modelId, dictationLanguage()), final: false })
      .then((res) => {
        // Only while THIS recording is still listening: a partial that lands
        // after the final would overwrite the pill with older words.
        if (rec !== r || view.phase !== 'listening') return
        if (res.ok) setView({ liveText: cleanTranscript(res.text), starting: false })
        else if (res.reason === 'warming') setView({ starting: true })
      })
      .catch(() => {})
      .finally(() => {
        r.partialBusy = false
      })
  }, PARTIAL_EVERY_MS)
}

function finishCancel(r: Recording): void {
  endCapture(r)
  if (rec === r) rec = null
  resumeMedia(r)
  if (dictationSounds()) cancelCue()
  setView(IDLE)
}

async function finishStop(r: Recording): Promise<void> {
  const host = dictationHost()
  const samples = endCapture(r)
  if (dictationSounds()) void stopCue()
  if (!host || samples.length < MIN_SECONDS * TARGET_RATE) {
    if (rec === r) rec = null
    resumeMedia(r)
    setView(IDLE)
    return
  }
  setView({ phase: 'transcribing' })
  let res
  try {
    res = await host.api.dictationTranscribe({
      wav: encodeWav(samples, TARGET_RATE),
      modelId: dictationModel(),
      language: languageFor(dictationModel(), dictationLanguage()),
      final: true
    })
  } catch {
    res = { ok: false as const, reason: 'engine-failed' as const }
  }
  // Escape while it transcribed: the cancel has already put everything away,
  // and what was heard is dropped, not pasted.
  if (r.ended === 'cancel') return
  if (rec === r) rec = null
  resumeMedia(r)
  if (!res.ok) {
    say(
      res.reason === 'no-model'
        ? 'Choose a model in Settings'
        : res.reason === 'no-engine'
          ? 'The speech engine is missing. Reinstall the app.'
          : 'The speech engine stopped. Try again.'
    )
    return
  }
  const text = cleanTranscript(res.text)
  if (!text) return say('Heard nothing')
  // A trailing space, so the next dictation (or the next typed word) does not
  // run into this one. Never a newline: that is Enter.
  if (!pasteTextInto(r.sessionId, text + ' ')) return say('That tab has closed')
  setView(IDLE)
}

function stop(): void {
  const r = rec
  if (!r || r.ended) return
  r.ended = 'stop'
  // Without a capture the mic is still opening, and `begin` finishes it.
  if (r.capture) void finishStop(r)
}

function cancel(): void {
  const r = rec
  if (!r || r.ended === 'cancel') return
  r.ended = 'cancel'
  if (r.capture) finishCancel(r)
}

/**
 * Arm dictation for this window. `activeSession` answers, at the moment of a
 * press, which shell is in front (null: none, so the press does nothing).
 * Returns the disposer. Safe to call with dictation off: it then only watches
 * the setting.
 */
export function armDictation(activeSession: () => string | null): () => void {
  let keyState: KeyState = initialKeyState()
  let tick: number | null = null
  let armed = false

  const feed = (evt: KeyEvt, dom?: KeyboardEvent): void => {
    const out = reduceKey(keyState, evt, { hotkey: dictationHotkey(), mode: dictationMode() })
    keyState = out.state
    if (out.swallow && dom) {
      // Capture phase, before xterm: the shell never sees the chord, and the
      // Alt keyup never reaches the window's system menu.
      dom.preventDefault()
      dom.stopPropagation()
    }
    if (tick !== null) {
      clearTimeout(tick)
      tick = null
    }
    // The solo-hold rule needs a clock: nothing else happens while a key is
    // simply held down.
    if (keyState.phase === 'arming') tick = window.setTimeout(() => feed({ type: 'tick', at: performance.now() }), 210)
    if (out.action === 'start') {
      const host = dictationHost()
      const id = host?.canDictate() ? activeSession() : null
      if (id) void begin(id)
    } else if (out.action === 'stop') stop()
    else if (out.action === 'cancel') cancel()
  }

  const onKey = (e: KeyboardEvent): void =>
    feed(
      {
        type: e.type === 'keydown' ? 'down' : 'up',
        code: e.code,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey,
        repeat: e.repeat,
        at: performance.now()
      },
      e
    )
  const onBlur = (): void => feed({ type: 'blur', at: performance.now() })

  let warmTimer: number | null = null
  const sync = (): void => {
    const want = dictationEnabled() && dictationHost() !== null
    // Warm the engine a moment after dictation is armed (the app has just
    // opened), and again when its model or language changes; off means off,
    // so nothing is warmed while it is off.
    if (warmTimer !== null) clearTimeout(warmTimer)
    warmTimer = want ? window.setTimeout(() => {
      warmTimer = null
      warmEngine()
    }, armed ? 500 : 3000) : null
    if (want === armed) return
    armed = want
    if (want) {
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
      window.addEventListener('blur', onBlur)
    } else {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', onBlur)
      keyState = initialKeyState()
      cancel()
      // Off means off: no server process may remain.
      dictationHost()?.api.dictationStop()
    }
  }
  sync()
  const unsub = onDictationPrefs(sync)
  return () => {
    unsub()
    if (tick !== null) clearTimeout(tick)
    if (warmTimer !== null) clearTimeout(warmTimer)
    if (armed) {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', onBlur)
      cancel()
    }
  }
}
