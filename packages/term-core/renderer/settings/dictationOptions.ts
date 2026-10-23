import { DICTATION_KEYS } from '../lib/dictationPrefs'
import type { SettingsSectionId } from './sectionIds'

/**
 * EVERY DICTATION OPTION, BY ID (#13): the same deal as `options.ts` makes for
 * the terminal's. The Dictation page renders these rows as `data-pref="<id>"`
 * and each app's e2e asserts that its page shows this list, so an option can
 * never exist in one app and not the other.
 *
 * A list of its own rather than more rows in `TERMINAL_OPTIONS`: each app's
 * terminal parity check reads that file as TEXT, and dictation lives on a page
 * of its own in both apps.
 */
export interface DictationOption {
  id: string
  label: string
  type: 'switch' | 'choice' | 'key' | 'manager'
  /** The localStorage key behind it; null where the row manages only FILES,
   *  which both apps share: GPU acceleration is on when its engine is on disk. */
  key: string | null
  /** Absent = every PC. */
  onlyWhere?: 'an NVIDIA adapter is present'
  /** The section that draws it, its tile, its subtext at rest and its hidden
   *  search words, as in `options.ts`. */
  section: SettingsSectionId
  icon: string
  sub: string
  keywords?: string
}

export const DICTATION_OPTIONS: readonly DictationOption[] = [
  { id: 'dictation-enabled', label: 'Use dictation', type: 'switch', key: DICTATION_KEYS.enabled, section: 'dictation', icon: 'mic', sub: 'Speech to text on this PC, never sent.', keywords: 'voice speech whisper talk dictate' },
  { id: 'dictation-mode', label: 'Key behaviour', type: 'choice', key: DICTATION_KEYS.mode, section: 'listening', icon: 'hand', sub: 'Runs while the key is held.', keywords: 'push talk hold toggle trigger' },
  { id: 'dictation-hotkey', label: 'Dictation key', type: 'key', key: DICTATION_KEYS.hotkey, section: 'listening', icon: 'key', sub: 'Text is pasted at the cursor.', keywords: 'hotkey shortcut right alt' },
  { id: 'dictation-mic', label: 'Microphone', type: 'choice', key: DICTATION_KEYS.mic, section: 'listening', icon: 'mic', sub: 'Test it to see the level.', keywords: 'input device level headset' },
  { id: 'dictation-language', label: 'Spoken language', type: 'choice', key: DICTATION_KEYS.language, section: 'listening', icon: 'globe', sub: 'The language you speak.', keywords: 'locale english norwegian auto detect' },
  { id: 'dictation-pause-media', label: 'Pause media while dictating', type: 'switch', key: DICTATION_KEYS.pauseMedia, section: 'while', icon: 'pause', sub: 'Resumes when you stop.', keywords: 'music video audio' },
  { id: 'dictation-sounds', label: 'Play start and stop sounds', type: 'switch', key: DICTATION_KEYS.sounds, section: 'while', icon: 'sound', sub: 'A short sound as the microphone opens.', keywords: 'beep chime audio' },
  { id: 'dictation-model', label: 'Speech models', type: 'manager', key: DICTATION_KEYS.model, section: 'models', icon: 'download', sub: 'Shared by both apps on this PC.', keywords: 'whisper parakeet download model' },
  // The official GPU engine is NVIDIA's: the row is offered only where it can work.
  { id: 'dictation-gpu', label: 'GPU acceleration', type: 'manager', key: null, onlyWhere: 'an NVIDIA adapter is present', section: 'gpu', icon: 'chip', sub: 'Large models answer in under a second.', keywords: 'cuda nvidia graphics card fast' }
]

/** The option ids a PC should be showing. */
export function dictationOptionIds(pc: { nvidia: boolean }): string[] {
  return DICTATION_OPTIONS.filter((o) => !o.onlyWhere || pc.nvidia).map((o) => o.id)
}
