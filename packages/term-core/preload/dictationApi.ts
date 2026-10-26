import { DCH } from '../shared/channels'
import type {
  DownloadProgress,
  DownloadResult,
  EngineInfo,
  ItemStatus,
  MediaPauseToken,
  TranscribeRequest,
  TranscribeResult
} from '../shared/dictationTypes'
import { subscribe } from './api'
import type { IpcRendererLike } from './ipcLike'

/**
 * The preload half of DICTATION's bridge (#13), for both hosts. Separate from
 * `createTermApi` because dictation is optional: a host that wires it spreads
 * this in beside the terminal's, and `registerDictationIpc` is its other half.
 */
export interface DictationApi {
  /** Is there an NVIDIA adapter, is the GPU pack in, did the GPU engine fall back. */
  dictationInfo(): Promise<EngineInfo>
  /** Every catalogued model and the GPU pack: absent, downloading or installed. */
  dictationStatus(): Promise<ItemStatus[]>
  /** Resolves when the file is verified and in place, or with why it is not. */
  dictationDownload(id: string): Promise<DownloadResult>
  dictationCancel(id: string): void
  dictationRemove(id: string): Promise<void>
  onDictationProgress(cb: (p: DownloadProgress) => void): () => void
  /** The WAV goes to the local engine and nowhere else; nothing is written to disk. */
  dictationTranscribe(req: TranscribeRequest): Promise<TranscribeResult>
  /** Dictation was switched off: no server process may remain. */
  dictationStop(): void
  /** Start the engine for this model and language and warm it, so the first
   *  press is fast (2026-09-28). Fire and forget. */
  dictationWarm(req: { modelId: string; language: string }): void
  dictationMediaPause(): Promise<MediaPauseToken>
  dictationMediaResume(token: MediaPauseToken): void
}

export function createDictationApi(ipc: IpcRendererLike): DictationApi {
  return {
    dictationInfo: () => ipc.invoke(DCH.info) as Promise<EngineInfo>,
    dictationStatus: () => ipc.invoke(DCH.status) as Promise<ItemStatus[]>,
    dictationDownload: (id) => ipc.invoke(DCH.download, id) as Promise<DownloadResult>,
    dictationCancel: (id) => ipc.send(DCH.cancel, id),
    dictationRemove: (id) => ipc.invoke(DCH.remove, id) as Promise<void>,
    onDictationProgress: (cb) => subscribe(ipc, DCH.progress, (p: DownloadProgress) => cb(p)),
    dictationTranscribe: (req) => ipc.invoke(DCH.transcribe, req) as Promise<TranscribeResult>,
    dictationStop: () => ipc.send(DCH.stop),
    dictationWarm: (req) => ipc.send(DCH.warm, req),
    dictationMediaPause: () => ipc.invoke(DCH.mediaPause) as Promise<MediaPauseToken>,
    dictationMediaResume: (token) => ipc.send(DCH.mediaResume, token)
  }
}
