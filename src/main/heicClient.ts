import { utilityProcess } from 'electron'
import { extname, join } from 'path'
import { createLru } from './lru'
import { createWorkerPool, type PoolProc } from './workerClient'

// HEIC/HEIF stills are not decodable by Chromium, so we transcode them to JPEG
// (pure-JS libheif, no native binary) and serve that instead. A small cache
// keeps us from re-decoding on every request (preloads + the renderer image
// cache both hit this). Keyed by path + mtime so an edited file re-decodes.
//
// The decode itself happens in a utility process (see heicWorker.ts). Measured:
// a 3MB iPhone HEIC takes ~2s, and doing that inline froze the entire window,
// since the main process owns the window message loop on Windows. The worker's
// lifecycle (kept warm between decodes, killed after a minute idle, a dead one
// failing what it held) is workerClient.ts's.

const HEIC_EXTS = new Set(['.heic', '.heif'])

/** Is this a still only the HEIC decoder can draw. */
export const isHeic = (p: string): boolean => HEIC_EXTS.has(extname(p).toLowerCase())

const HEIC_IDLE_MS = 60_000
const cache = createLru<string, Buffer>(6)

interface Reply {
  id: number
  ok: boolean
  data?: Uint8Array
  error?: string
}

const pool = createWorkerPool<Reply>({
  start: () => utilityProcess.fork(join(__dirname, 'heicWorker.js')) as PoolProc<Reply>,
  settle: (m) => {
    if (m.ok && m.data) return Buffer.from(m.data)
    throw new Error(m.error ?? 'heic decode failed')
  },
  exitError: 'heic worker exited',
  idleMs: HEIC_IDLE_MS
})

export async function heicToJpeg(filePath: string, mtimeMs: number): Promise<Buffer> {
  const key = `${filePath}|${mtimeMs}`
  const hit = cache.get(key) // a hit is a use: the newest again
  if (hit) return hit
  const buf = await pool.call<Buffer>({ path: filePath })
  cache.set(key, buf)
  return buf
}
