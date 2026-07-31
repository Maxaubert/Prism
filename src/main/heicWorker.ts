import { readFile } from 'fs/promises'
import convert from 'heic-convert'

// HEIC/HEIF decoding runs here, in a utility process, NOT in the main process.
// libheif is pure JS/WASM and CPU-bound: measured ~2s for a 3MB iPhone photo. Doing
// that on the main process pegs the thread that owns the window message loop, so the
// whole app freezes (no repaint, no spinner) until it finishes. Out here it costs the
// UI nothing.

interface Request {
  id: number
  path: string
}

process.parentPort.on('message', (e) => {
  const { id, path } = e.data as Request
  void (async () => {
    try {
      const buffer = await readFile(path)
      const out = await convert({ buffer, format: 'JPEG', quality: 0.92 })
      const data = new Uint8Array(out)
      process.parentPort.postMessage({ id, ok: true, data })
    } catch (err) {
      process.parentPort.postMessage({ id, ok: false, error: String(err) })
    }
  })()
})
