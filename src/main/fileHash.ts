import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'

/**
 * A file's SHA-256, streamed, for the Properties window's Checksum row
 * (owner, 2026-10-12; spec
 * `docs/superpowers/specs/2026-10-12-properties-window-design.md`).
 *
 * Streamed in main so a 40 GB film never sits in memory, with progress as it
 * goes and an AbortSignal for the row's Stop. Answers null when the file
 * could not be read or the hash was stopped: the row says so, never a hash of
 * part of a file.
 */
export async function hashFile(
  path: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) return null
  let total: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    total = info.size
  } catch {
    return null
  }
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path, { highWaterMark: 1 << 20 })
    let done = 0
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', stop)
      resolve(value)
    }
    const stop = (): void => {
      stream.destroy()
      finish(null)
    }
    signal?.addEventListener('abort', stop, { once: true })
    stream.on('data', (chunk: Buffer | string) => {
      hash.update(chunk)
      done += chunk.length
      onProgress(done, total)
    })
    stream.on('error', () => finish(null))
    stream.on('end', () => finish(hash.digest('hex')))
  })
}
