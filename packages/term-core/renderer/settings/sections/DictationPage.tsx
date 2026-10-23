import { useState, type JSX, type ReactNode } from 'react'
import ModelDownloadAsk from '../../components/ModelDownloadAsk'
import { LANGUAGES, LIMITED_LANGUAGES_TEXT, visibleModels } from '../../../shared/dictationCatalog'
import type { CatalogEntry, DownloadFailure, ItemStatus } from '../../../shared/dictationTypes'
import {
  setDictationEnabled,
  setDictationLanguage,
  setDictationMode,
  setDictationModel,
  setDictationPauseMedia,
  setDictationSounds
} from '../../lib/dictationPrefs'
import { ROW_BUTTON, Segmented, Select, Switch } from '../fields'
import { VendorMark } from '../VendorMark'
import { HotkeyField, LimitedMark, MicField, Uninstall } from '../dictation/parts'
import { FAILURES, GPU_ID, size } from '../dictation/items'
import { useDictationState } from '../dictation/useDictationState'
import { ROW_SCOPE, SettingRow, Subtext } from '../layout/SettingRow'
import { SectionTag, SettingsSection } from '../layout/SettingsSection'
import { opt, sectionTitle } from './opts'

/**
 * DICTATION'S PAGE, on the grouped cards (2026-10-05); the same in both apps.
 * Values are per app; the model files it manages are shared by both apps,
 * which is why a model downloaded in one shows as installed in the other.
 *
 * NOTHING HERE STARTS ANYTHING BY ITSELF. Opening the page does not open the
 * microphone (the meter is behind a Test button: a mic that lights up because
 * you looked at a settings page is a privacy bug), and nothing downloads
 * without a click. Off means off: every row under the switch is dimmed and
 * disabled while dictation is off.
 *
 * Live state is said in the row's SUBTEXT, so a sighted user and a screen
 * reader get the same words: no model yet, a refused microphone, a model that
 * picks its own language, a failed download, a large model with no GPU.
 */

const MODE_SUB = { hold: 'Runs while the key is held.', toggle: 'One press starts, the next stops.' } as const
const SLOW = 'Slow without GPU acceleration.'

/** One downloadable thing: a model, or the GPU engine. The vendor's mark
 *  leads, then the full name, its size, the badges, and its note; what is in
 *  use is marked by a badge and a faint fill, so the list reads as a state. */
function ModelRow({
  entry,
  status,
  progress,
  failure,
  badge,
  recommended,
  warn,
  getLabel,
  onDownload,
  onCancel,
  installed,
  note
}: {
  entry: CatalogEntry
  status: ItemStatus | undefined
  progress: number | undefined
  failure: DownloadFailure | undefined
  badge: string | null
  recommended: boolean
  warn: boolean
  getLabel: string
  onDownload: () => void
  onCancel: () => void
  installed: ReactNode
  /** The subtext in place of the catalogue's note (the GPU fall-back). */
  note?: string
}): JSX.Element {
  const state = status?.state ?? 'absent'
  const received = progress ?? status?.received ?? 0
  const pct = Math.min(100, Math.round((received / entry.bytes) * 100))
  const failed = failure ? FAILURES[failure] : ''
  const sub = failed || (warn ? SLOW : (note ?? entry.note))
  return (
    <div
      data-dictation-item={entry.id}
      data-state={state}
      data-active={badge ? '' : undefined}
      className={`relative grid min-h-16 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-x-3.5 py-3 pl-3.5 pr-4 first:rounded-t-[inherit] last:rounded-b-[inherit] before:pointer-events-none before:absolute before:left-16 before:right-0 before:top-0 before:h-px before:bg-[var(--p-line)] before:content-[''] first:before:hidden ${ROW_SCOPE} ${
        // A whisper of a fill (owner, 2026-09-19): the badge says which row
        // is in use; this only lets the eye find it.
        badge ? 'bg-[color-mix(in_srgb,var(--p-text)_2.5%,transparent)]' : ''
      }`}
    >
      <VendorMark vendor={entry.kind === 'gpu-pack' || entry.engine === 'parakeet' ? 'nvidia' : 'openai'} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span data-item-name className="truncate text-[13px] font-semibold leading-[1.3] text-[var(--p-text)]">
            {entry.label}
          </span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--p-dim)]">{size(entry.bytes)}</span>
          {recommended && (
            <span className="shrink-0 rounded-full border border-[color:var(--p-accent-hi)] px-[7px] text-[9.5px] font-bold uppercase leading-[14px] tracking-[0.04em] text-[var(--p-accent-hi)]">
              Recommended
            </span>
          )}
          {badge && (
            <span
              data-item-badge
              className="shrink-0 rounded-full border border-transparent bg-[var(--p-accent)] px-[7px] text-[9.5px] font-bold uppercase leading-[14px] tracking-[0.04em] text-[var(--p-on-accent)]"
            >
              {badge}
            </span>
          )}
        </div>
        <Subtext text={sub} warn={!failed && warn} />
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2.5">
        {state === 'downloading' ? (
          <>
            <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-[var(--p-dim)]">
              <span className="block h-1.5 w-28 overflow-hidden rounded-full bg-[var(--p-track)]">
                <span className="block h-full origin-left rounded-full bg-[var(--p-accent-hi)]" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-9 text-right">{pct}%</span>
            </span>
            <button className={ROW_BUTTON} onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : state === 'installed' ? (
          installed
        ) : (
          <button className={ROW_BUTTON} onClick={onDownload}>
            {failure && failure !== 'cancelled' ? 'Retry' : getLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function DictationPage(): JSX.Element | null {
  const d = useDictationState()
  const [micProblem, setMicProblem] = useState<string | null>(null)
  if (!d.host || !d.api) return null
  const off = !d.enabled
  const use = opt('dictation-enabled')
  const mode = opt('dictation-mode')
  const key = opt('dictation-hotkey')
  const mic = opt('dictation-mic')
  const lang = opt('dictation-language')
  const pause = opt('dictation-pause-media')
  const sounds = opt('dictation-sounds')
  const noModelYet = d.enabled && d.noModel
  return (
    <div data-dictation-settings>
      <SettingsSection id="dictation">
        <SettingRow
          id="dictation-enabled"
          icon={use.icon}
          label={use.label}
          sub={noModelYet ? 'Needs a speech model before it works.' : use.sub}
          warn={noModelYet}
          tap
        >
          <Switch on={d.enabled} onChange={setDictationEnabled} label={use.label} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="listening" title={sectionTitle('listening')}>
        <SettingRow id="dictation-mode" icon={mode.icon} label={mode.label} sub={MODE_SUB[d.mode]} off={off}>
          <Segmented
            value={d.mode}
            onChange={setDictationMode}
            options={[
              { id: 'hold', name: 'Hold' },
              { id: 'toggle', name: 'Toggle' }
            ]}
          />
        </SettingRow>
        <SettingRow id="dictation-hotkey" icon={key.icon} label={key.label} sub={key.sub} off={off}>
          <HotkeyField value={d.hotkey} disabled={off} look={ROW_BUTTON} />
        </SettingRow>
        <SettingRow id="dictation-mic" icon={mic.icon} label={mic.label} sub={micProblem ?? mic.sub} off={off}>
          <MicField value={d.mic} disabled={off} onProblem={setMicProblem} look={ROW_BUTTON} idleTrack />
        </SettingRow>
        <SettingRow
          id="dictation-language"
          icon={lang.icon}
          label={lang.label}
          sub={d.ownLanguage ? 'This model detects the language itself.' : lang.sub}
          off={off}
        >
          {d.ownLanguage && <LimitedMark />}
          <Select
            id="dictation-language"
            value={d.ownLanguage ? 'auto' : d.language}
            onChange={setDictationLanguage}
            options={LANGUAGES.map((l) => ({ id: l.code, name: l.name }))}
            disabled={d.ownLanguage}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="while" title={sectionTitle('while')}>
        <SettingRow id="dictation-pause-media" icon={pause.icon} label={pause.label} sub={pause.sub} off={off} tap>
          <Switch on={d.pauseMedia} onChange={setDictationPauseMedia} label={pause.label} disabled={off} />
        </SettingRow>
        <SettingRow id="dictation-sounds" icon={sounds.icon} label={sounds.label} sub={sounds.sub} off={off} tap>
          <Switch on={d.sounds} onChange={setDictationSounds} label={sounds.label} disabled={off} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection id="models" title={sectionTitle('models')} action={<SectionTag>Shared by both apps</SectionTag>}>
        <div data-pref="dictation-model" className="rounded-[inherit]">
          {visibleModels().map((m) => {
            const active = m.id === d.model && d.installed(m.id)
            return (
              <ModelRow
                key={m.id}
                entry={m}
                status={d.stateOf(m.id)}
                progress={d.progress[m.id]}
                failure={d.failures[m.id]}
                badge={active ? 'Active' : null}
                recommended={m.id === d.recommended?.id}
                warn={!!m.needsGpu && !d.gpuOn}
                getLabel="Download"
                onDownload={() => d.fetchModel(m.id)}
                onCancel={() => d.cancel(m.id)}
                installed={
                  <>
                    {!active && (
                      <button className={ROW_BUTTON} onClick={() => setDictationModel(m.id)}>
                        Use
                      </button>
                    )}
                    <Uninstall what={m.label} onClick={() => d.remove(m.id)} look={ROW_BUTTON} />
                  </>
                }
              />
            )
          })}
        </div>
      </SettingsSection>

      {/* Offered only where it can work: the official GPU engine is NVIDIA's.
          Everyone else runs the bundled CPU engine, which needs no setup.
          ENABLE downloads it and DISABLE uninstalls it (owner, 2026-09-19):
          one control with one meaning. */}
      {d.gpu && d.info?.nvidia && (
        <SettingsSection id="gpu" title={sectionTitle('gpu')}>
          <div data-pref="dictation-gpu" className="rounded-[inherit]">
            <ModelRow
              entry={d.gpu}
              status={d.stateOf(GPU_ID)}
              progress={d.progress[GPU_ID]}
              failure={d.failures[GPU_ID]}
              badge={d.gpuOn ? 'Enabled' : null}
              recommended={false}
              warn={false}
              note={d.info.gpuFellBack ? 'It could not start, the CPU is used.' : undefined}
              getLabel="Enable"
              onDownload={() => d.download(GPU_ID)}
              onCancel={() => d.cancel(GPU_ID)}
              installed={
                <button
                  data-gpu-toggle
                  className={ROW_BUTTON}
                  title="Turns GPU acceleration off and frees 675 MB of disk space."
                  onClick={() => d.remove(GPU_ID)}
                >
                  Disable
                </button>
              }
            />
          </div>
        </SettingsSection>
      )}
      {d.asking && (
        <ModelDownloadAsk
          text={LIMITED_LANGUAGES_TEXT}
          onCancel={() => d.setAsking(null)}
          onDownload={() => {
            const id = d.asking!
            d.setAsking(null)
            d.download(id)
          }}
        />
      )}
    </div>
  )
}
