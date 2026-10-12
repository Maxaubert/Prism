import { parentPort } from 'worker_threads'
import { convertDoc } from './docConvert'
import { sanitizeDoc } from './docSanitize'

/**
 * A DOCUMENT IS CONVERTED AND SANITISED HERE, ON A WORKER THREAD, NOT ON MAIN
 * (2026-10-12; docClient.ts holds the why). Built as its own entry
 * (`docWorker.js`, electron.vite.config.ts), so mammoth, xlsx, adm-zip and the
 * unified stack are loaded by this thread and never by main's.
 */

interface Request {
  id: number
  path: string
}

parentPort?.on('message', (req: Request) => {
  void (async () => {
    try {
      const html = await convertDoc(req.path)
      parentPort?.postMessage({ id: req.id, html: html === null ? null : await sanitizeDoc(html) })
    } catch (err) {
      parentPort?.postMessage({ id: req.id, error: String((err as Error)?.message ?? err) })
    }
  })()
})
