import { useEffect, useRef, useState, type JSX } from 'react'
import type { DiagApi } from '../../../preload/diagApi'
import { noteDiagVerbose } from '../../lib/diag'
import { ROW_BUTTON, Switch } from '../fields'
import { SettingRow } from '../layout/SettingRow'
import { SettingsSection } from '../layout/SettingsSection'
import { opt } from './opts'

/** What the page needs from the bridge: the host hands it in (props only,
 *  as the update window does), so the page never reaches for a global. */
export type DiagSettingsBridge = Pick<DiagApi, 'diagInfo' | 'diagSetVerbose' | 'diagOpenFolder' | 'diagMark'>

/** How long the Mark button says Marked. */
const MARKED_MS = 1200

/**
 * THE DIAGNOSTICS PAGE (#140): Detailed logging, the log folder, and Mark a
 * problem. The log itself is always on, at a quiet level; this page is how
 * somebody turns the detail up, finds the files, and stamps the moment
 * something went wrong, so "it stalled just now" can be found in the log.
 */
export function DiagnosticsPage({ api }: { api: DiagSettingsBridge }): JSX.Element {
  const [verbose, setVerbose] = useState(false)
  const [dir, setDir] = useState('')
  const [marked, setMarked] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    void api
      .diagInfo()
      .then((i) => {
        if (!live) return
        setVerbose(!!i?.verbose)
        setDir(i?.dir ?? '')
      })
      .catch(() => {})
    return () => {
      live = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [api])

  const flip = (on: boolean): void => {
    setVerbose(on)
    noteDiagVerbose(on)
    void api
      .diagSetVerbose(on)
      .then((v) => {
        setVerbose(v)
        noteDiagVerbose(v)
      })
      .catch(() => {})
  }

  const mark = (): void => {
    api.diagMark()
    setMarked(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMarked(false), MARKED_MS)
  }

  const v = opt('diag-verbose')
  const f = opt('diag-folder')
  const m = opt('diag-mark')
  return (
    <SettingsSection id="diagnostics">
      <SettingRow id="diag-verbose" icon={v.icon} label={v.label} sub={v.sub} tap>
        <Switch on={verbose} onChange={flip} label={v.label} />
      </SettingRow>
      {/* The folder's path is the subtext, whole on its tooltip, so it can be
          read off the page as well as opened. */}
      <SettingRow id="diag-folder" icon={f.icon} label={f.label} sub={dir || f.sub}>
        <button type="button" className={ROW_BUTTON} disabled={!dir} onClick={() => api.diagOpenFolder()}>
          Open folder
        </button>
      </SettingRow>
      <SettingRow id="diag-mark" icon={m.icon} label={m.label} sub={m.sub}>
        {/* Both words in one cell, only one visible: the button never
            changes width as it answers. A grid button puts its one row at
            the top, where a plain one centres its text (the e2e shot showed
            Mark sitting 3px above Open folder's line), so it is centred. */}
        <button type="button" className={`${ROW_BUTTON} grid place-content-center`} onClick={mark} data-diag-mark aria-live="polite">
          <span className={`col-start-1 row-start-1 ${marked ? 'invisible' : ''}`}>Mark</span>
          <span className={`col-start-1 row-start-1 ${marked ? '' : 'invisible'}`}>Marked</span>
        </button>
      </SettingRow>
    </SettingsSection>
  )
}
