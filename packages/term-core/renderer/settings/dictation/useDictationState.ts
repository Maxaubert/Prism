import { useCallback, useEffect, useState } from 'react'
import { dictationHost } from '../../host'
import { catalogEntry, limitedLanguages, recommendedModel } from '../../../shared/dictationCatalog'
import type { CatalogEntry, DownloadFailure, EngineInfo, ItemStatus } from '../../../shared/dictationTypes'
import {
  dictationModel,
  setDictationModel,
  useDictationEnabled,
  useDictationHotkey,
  useDictationLanguage,
  useDictationMic,
  useDictationMode,
  useDictationModel,
  useDictationPauseMedia,
  useDictationSounds
} from '../../lib/dictationPrefs'
import { GPU_ID, without } from './items'

/**
 * WHAT DICTATION'S PAGE KNOWS AND DOES, once for both layouts of it
 * (2026-10-05; moved out of Dictation.tsx unchanged): the stored settings, the
 * model files main reports, the downloads in flight and their failures, and
 * the one-line question before a model that does not support every language.
 *
 * NOTHING HERE STARTS ANYTHING BY ITSELF: reading the status opens no
 * microphone and downloads nothing; every download is a click.
 */
export function useDictationState() {
  const host = dictationHost()
  const enabled = useDictationEnabled()
  const mode = useDictationMode()
  const hotkey = useDictationHotkey()
  const mic = useDictationMic()
  const language = useDictationLanguage()
  const pauseMedia = useDictationPauseMedia()
  const sounds = useDictationSounds()
  const model = useDictationModel()

  const [status, setStatus] = useState<ItemStatus[]>([])
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [failures, setFailures] = useState<Record<string, DownloadFailure>>({})
  /** The model whose download waits on the one-line question, if any. */
  const [asking, setAsking] = useState<string | null>(null)

  const api = host?.api
  const refresh = useCallback(() => {
    if (!api) return
    void api.dictationStatus().then(setStatus)
    void api.dictationInfo().then(setInfo)
  }, [api])
  useEffect(() => {
    if (!api) return
    refresh()
    return api.onDictationProgress((p) => setProgress((prev) => ({ ...prev, [p.id]: p.received })))
  }, [api, refresh])

  const stateOf = (id: string): ItemStatus | undefined => status.find((s) => s.id === id)
  const installed = (id: string): boolean => stateOf(id)?.state === 'installed'
  /** GPU acceleration is ON exactly when its engine is on disk. */
  const gpuOn = installed(GPU_ID)

  const download = (id: string): void => {
    if (!api) return
    setFailures((prev) => without(prev, id))
    setStatus((prev) => [...prev.filter((s) => s.id !== id), { id, state: 'downloading', received: 0 }])
    void api.dictationDownload(id).then(async (res) => {
      setProgress((prev) => without(prev, id))
      if (!res.ok) setFailures((prev) => ({ ...prev, [id]: res.reason }))
      else if (catalogEntry(id)?.kind === 'model') {
        // The first model anyone downloads is the one they meant to use. Read
        // NOW, not from the render the click came from (code review
        // 2026-09-24, #30): a second download finishing after the first had
        // become the model, or after a pick with Use, replaced it unasked.
        const current = dictationModel()
        const on = await api.dictationStatus()
        if (!on.some((s) => s.id === current && s.state === 'installed')) setDictationModel(id)
      }
      refresh()
    })
  }
  const remove = (id: string): void => {
    if (!api) return
    void api.dictationRemove(id).then(() => {
      if (id === model) setDictationModel('')
      refresh()
    })
  }
  const cancel = (id: string): void => {
    void api?.dictationCancel(id)
  }

  /** A model that does not support every language says so once, before its
   *  download (#121). A Retry after a failed one has already been asked. */
  const fetchModel = (id: string): void => {
    const failed = failures[id]
    if (catalogEntry(id)?.limitedLanguages && (!failed || failed === 'cancelled')) setAsking(id)
    else download(id)
  }

  return {
    host,
    api,
    enabled,
    mode,
    hotkey,
    mic,
    language,
    pauseMedia,
    sounds,
    model,
    info,
    progress,
    failures,
    asking,
    setAsking,
    stateOf,
    installed,
    gpuOn,
    download,
    remove,
    cancel,
    fetchModel,
    /** The active model picks its own language: the picker shows Auto-detect,
     *  cannot be changed, and the user's own choice waits, stored, for the
     *  next Whisper model. */
    ownLanguage: limitedLanguages(model),
    recommended: recommendedModel(gpuOn) as CatalogEntry | undefined,
    noModel: !installed(model),
    gpu: catalogEntry(GPU_ID)
  }
}

export type DictationState = ReturnType<typeof useDictationState>
