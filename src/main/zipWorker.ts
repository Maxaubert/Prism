import { runZipJob, type ZipRequest } from './zipOps'

// Every adm-zip call runs here, in a utility process, NOT in the main process
// (owner, 2026-10-12, "zip editing off the main process"; the HEIC worker's
// pattern). adm-zip reads and writes whole archives synchronously: renaming one
// member of a 600MB zip rewrote all of it on the thread that owns the window
// message loop, and the whole app froze until it finished.
//
// ONE JOB AT A TIME, in arrival order. Some jobs await (a stat, a 7-Zip run),
// and two edits of one archive interleaved there would each write back a copy
// that misses the other's change. main sends edits of one path in order
// (zipClient.ts); this chain keeps them in that order.

let chain: Promise<void> = Promise.resolve()

process.parentPort.on('message', (e) => {
  const req = e.data as ZipRequest
  chain = chain
    .then(async () => {
      const reply = await runZipJob(req)
      try {
        process.parentPort.postMessage(reply)
      } catch (err) {
        // An answer that cannot be cloned still answers, or main waits forever.
        process.parentPort.postMessage({ id: req.id, ok: false, error: String(err) })
      }
    })
    // A link that throws must not reject the chain: every later job would be
    // skipped and main would wait on all of them forever.
    .catch(() => undefined)
})
