import type { DownloadFailure } from '../../../shared/dictationTypes'

// Dictation's words and small helpers, shared by both layouts of its page.

export const GPU_ID = 'gpu-pack'

export const FAILURES: Record<DownloadFailure, string> = {
  network: 'The download failed.',
  checksum: 'The file failed its check and was deleted.',
  disk: 'It could not be written to disk.',
  cancelled: '',
  unpack: 'It could not be unpacked.'
}

/** A copy of a record without one key. */
export function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec }
  delete next[key]
  return next
}

export function size(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`
}
