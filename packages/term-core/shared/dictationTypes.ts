// What dictation speaks across its seams (#13). Owned by the core, so the two
// apps and the two processes can never disagree about a model or a download.

/** One downloadable thing: a model, or the NVIDIA engine pack. */
export interface CatalogEntry {
  id: string
  label: string
  /** One line for the model manager: who it is for. */
  note: string
  url: string
  /** The size of the download, exactly: progress and the checksum both lean on it. */
  bytes: number
  /** Lowercase hex. A file that does not match is deleted, never loaded or run. */
  sha256: string
  kind: 'model' | 'gpu-pack'
  /** Too slow to use without the GPU pack (measured: Large on a fast CPU, 20 s for 11 s). */
  needsGpu?: boolean
  /** The pick for a machine with (gpu) or without (cpu) the GPU pack. */
  recommended?: 'cpu' | 'gpu'
  /** Catalogued for the e2e only; never shown in the model manager. */
  e2eOnly?: boolean
  /** What runs the model. Absent: Whisper, through the resident whisper-server.
   *  'parakeet': parakeet-cli, one process per pass (#121). */
  engine?: 'whisper' | 'parakeet'
  /** It does not support every language and picks the language itself: the
   *  language picker shows Auto-detect and is disabled while it is in use. */
  limitedLanguages?: boolean
}

export type InstallState = 'absent' | 'downloading' | 'installed'

/** What the model manager draws for one entry. */
export interface ItemStatus {
  id: string
  state: InstallState
  /** Bytes on disk so far while downloading; `bytes` of the entry when installed. */
  received: number
}

export interface DownloadProgress {
  id: string
  received: number
  total: number
}

/** Why a download did not end in an installed file. */
export type DownloadFailure = 'network' | 'checksum' | 'disk' | 'cancelled' | 'unpack'
export type DownloadResult = { ok: true } | { ok: false; reason: DownloadFailure; detail?: string }

/** Which engine answered, so Settings can say when the GPU one was passed over. */
export type EngineKind = 'cpu' | 'gpu'

export interface TranscribeRequest {
  /** A complete 16 kHz mono PCM16 WAV file. Never written to disk. */
  wav: Uint8Array
  modelId: string
  /** 'auto', or an ISO 639-1 code Whisper knows. A model that picks the
   *  language itself is sent 'auto' (see `languageFor`). */
  language: string
  /** A partial may be dropped for a newer one; a final never is. */
  final: boolean
}

export type TranscribeResult =
  | { ok: true; text: string; engine: EngineKind }
  | { ok: false; reason: 'no-model' | 'no-engine' | 'engine-failed' | 'superseded' | 'warming'; detail?: string }

export interface EngineInfo {
  /** An NVIDIA adapter is present, so the GPU pack is worth offering. */
  nvidia: boolean
  gpuPack: InstallState
  /** The GPU engine was tried this session and would not start; CPU is answering. */
  gpuFellBack: boolean
}

/** Opaque: which media sessions THIS pause paused, so resume plays only those. */
export type MediaPauseToken = string

// ---- main-side contracts (the store, the engine, the media helper) ----------

/** Models and the GPU pack on disk, in the folder BOTH apps share. */
export interface DictationStore {
  status(): Promise<ItemStatus[]>
  /** Resolves when the file is verified and in place, or with why it is not. */
  download(id: string, onProgress: (p: DownloadProgress) => void): Promise<DownloadResult>
  cancel(id: string): void
  remove(id: string): Promise<void>
  /** Absolute path of an INSTALLED, verified model file, else null. */
  modelPath(id: string): string | null
  /** The folder holding whisper-server.exe of the installed GPU pack, else null. */
  gpuEngineDir(): string | null
}

/** The resident whisper-server: started on first use, gone when idle or stopped. */
export interface DictationEngine {
  transcribe(req: TranscribeRequest): Promise<TranscribeResult>
  /** Start the server for this model and language and run one silent pass,
   *  so the first real one is fast (2026-09-28). Does nothing when the server
   *  up is already warm for them, or a warm-up is on its way. */
  warm(req: { modelId: string; language: string }): Promise<TranscribeResult>
  /** Kill the server now (dictation switched off, app quitting). */
  stop(): void
  info(): { running: boolean; engine: EngineKind | null; gpuFellBack: boolean }
}

/** Pause what is PLAYING, and later resume exactly that. Never throws. */
export interface MediaPause {
  pausePlaying(): Promise<MediaPauseToken>
  resume(token: MediaPauseToken): Promise<void>
  dispose(): void
}
