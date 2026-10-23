import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { mkdir, open, readdir, rename, rm, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { SYS } from './sysTools'
import { writeAtomic } from './atomicWrite'
import type {
  CatalogEntry,
  DictationStore,
  DownloadProgress,
  DownloadResult,
  ItemStatus
} from '../shared/dictationTypes'

/**
 * The dictation models and the NVIDIA engine pack on disk (#13), in the one
 * folder Prism and Prism Terminal share (`%LOCALAPPDATA%\PrismDictation`; the
 * host passes it in as `root`, and the tests pass a temp folder).
 *
 *   <root>/models/<id>.bin                 a model
 *   <root>/engines/<id>-<sha256[0..12]>/   the GPU pack, unzipped
 *
 * THE ONE PROMISE this file makes: nothing unverified is ever loaded or run. A
 * download streams into `<final>.part` while it is hashed and counted, and only
 * a file whose byte count AND sha256 both match the catalog is renamed into
 * place. So a file under its final name was verified by construction, and the
 * cheap question asked afterwards (is it there, is it the catalogued size) is
 * enough to call it installed without hashing 2.9 GB on every look.
 *
 * The pack is a zip, so "in place" takes three more steps: the verified zip is
 * unzipped into its folder, the zip is deleted, and a small marker file is
 * written LAST. A folder without its marker is a crash half way through an
 * unzip and never reads as installed. The folder carries the hash in its name
 * so a pack the catalog has moved on from can never be mistaken for the new one.
 *
 * Nothing here retries: a failure is reported with its reason and the row in
 * the model manager offers Retry. Redirects are fetch's own business (the
 * model host answers every download with one).
 */

/** Written last into the pack's folder; its presence IS "the unzip finished". */
export const PACK_MARKER = 'prism-installed.json'

/**
 * How long a `.part` file must have sat untouched before status() calls it a
 * leftover and deletes it. The folder is SHARED by two apps: with no such
 * pause, opening the Dictation page in Prism would delete the part file Prism
 * Terminal was busy writing, and that download would end in a rename of a file
 * that is gone. A part file being written was modified a moment ago; one left
 * by a crash was not. A download this store starts itself clears the way at
 * once, whatever the age.
 */
export const STALE_PART_MS = 60_000

/** How long `modelPath` and `gpuEngineDir` believe an installed answer. */
export const INSTALLED_MEMO_MS = 30_000

/** "at most about 10 times a second": a 2.9 GB model is about 50 000 chunks. */
const PROGRESS_EVERY_MS = 100

const SERVER_EXE = 'whisper-server.exe'

/** An id becomes a file name, so it is held to what cannot leave the folder. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type Unzip = (zip: string, outDir: string, signal?: AbortSignal) => Promise<void>

export interface DictationStoreDeps {
  /** The shared folder. It need not exist: every folder is made on demand. */
  root: string
  /** Handed in, never imported: the integrator owns which catalog this is. */
  catalog: readonly CatalogEntry[]
  fetchImpl?: typeof fetch
  /** The signal is the cancel button's; an unzip that ignores it is only slower to stop. */
  unzip?: Unzip
  now?: () => number
}

const EXPAND_COMMAND =
  "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; " +
  'Expand-Archive -LiteralPath $env:PRISM_DICTATION_ZIP -DestinationPath $env:PRISM_DICTATION_OUT -Force'

/**
 * The default unzip: Windows PowerShell's own Expand-Archive, which every
 * Windows 10 and 11 has, so the pack needs no unzip library of ours.
 *
 * The two paths travel in the ENVIRONMENT, not in the command: after
 * `-Command` PowerShell joins its remaining arguments into one string and
 * parses it again, so a path with a space or a quote in it (a user folder
 * named "Ole Hansen") would need quoting that is easy to get wrong. The
 * command text is a constant and `-LiteralPath` keeps [ and ] from being read
 * as wildcards. The progress bar is switched off because Windows PowerShell
 * 5.1 spends most of an Expand-Archive drawing it, even with nobody watching.
 * Found by its full path so a stray powershell.exe earlier on PATH is never run.
 */
export const expandArchive: Unzip = (zip, outDir, signal) =>
  new Promise<void>((resolve, reject) => {
    execFile(
      SYS.powershell,
      ['-NoProfile', '-NonInteractive', '-Command', EXPAND_COMMAND],
      {
        windowsHide: true,
        signal,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PRISM_DICTATION_ZIP: zip, PRISM_DICTATION_OUT: outDir }
      },
      (err, _stdout, stderr) => {
        if (!err) return resolve()
        const said = String(stderr).split(/\r?\n/).find((l) => l.trim())
        reject(new Error(said?.trim() || err.message))
      }
    )
  })

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** A folder can be held for a moment by a virus scanner reading what was just unzipped. */
const gone = (path: string): Promise<void> => rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })

interface Flight {
  promise: Promise<DownloadResult>
  controller: AbortController
  received: number
  cancelled: boolean
  listeners: Set<(p: DownloadProgress) => void>
}

export function createDictationStore(deps: DictationStoreDeps): DictationStore {
  const { root, catalog } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const unzip = deps.unzip ?? expandArchive
  const now = deps.now ?? (() => Date.now())
  for (const e of catalog) {
    if (!SAFE_ID.test(e.id)) throw new Error(`dictation catalog: "${e.id}" cannot be a file name`)
  }
  const flights = new Map<string, Flight>()
  /** Where the server was last found, so the engine's every ask is not a folder walk. */
  let engineDirMemo: string | null = null

  // The catalog is read on every call rather than indexed once: it is four or
  // five entries, and a host that swaps an entry is then simply believed.
  const find = (id: string): CatalogEntry | undefined => catalog.find((e) => e.id === id)
  const isPack = (e: CatalogEntry): boolean => e.kind === 'gpu-pack'
  /** The model itself, or the pack's zip: what `.part` is renamed to. */
  const finalPath = (e: CatalogEntry): string =>
    isPack(e) ? join(root, 'engines', `${e.id}.zip`) : join(root, 'models', `${e.id}.bin`)
  const partPath = (e: CatalogEntry): string => finalPath(e) + '.part'
  const packDir = (e: CatalogEntry): string => join(root, 'engines', `${e.id}-${e.sha256.slice(0, 12).toLowerCase()}`)

  /**
   * Synchronous on purpose: `modelPath` and `gpuEngineDir` are synchronous in
   * the contract, and what is read is one stat, or a marker of under 200 bytes.
   * A marker counts only when it was written for THIS catalog entry, so the
   * size and hash are in it, not just its existence.
   */
  function installedSync(e: CatalogEntry): boolean {
    try {
      if (!isPack(e)) {
        // sync-ok: modelPath and gpuEngineDir are sync in the contract; one stat, remembered for INSTALLED_MEMO_MS
        const s = statSync(finalPath(e))
        return s.isFile() && s.size === e.bytes
      }
      // sync-ok: modelPath and gpuEngineDir are sync in the contract; a marker under 200 bytes, remembered for INSTALLED_MEMO_MS
      const m = JSON.parse(readFileSync(join(packDir(e), PACK_MARKER), 'utf8')) as Partial<CatalogEntry>
      return m.bytes === e.bytes && m.sha256 === e.sha256
    } catch {
      return false
    }
  }

  /**
   * A "yes" is believed for `INSTALLED_MEMO_MS` (perf review 2026-10-16): the
   * engine asks `modelPath` and `gpuEngineDir` on every pass, 0.6 to 1 s apart
   * while a key is held, and each was a stat or a marker read on main's
   * thread, which waits like a write does on a starved disk. A "no" is never
   * kept, so a model the other app (Prism shares the folder) downloads is
   * seen at once; this store's own download, remove and status() forget it.
   */
  const installedUntil = new Map<string, number>()
  function installed(e: CatalogEntry): boolean {
    const until = installedUntil.get(e.id)
    if (until !== undefined && now() < until) return true
    // sync-ok: the sync contract, remembered for INSTALLED_MEMO_MS
    const ok = installedSync(e)
    if (ok) installedUntil.set(e.id, now() + INSTALLED_MEMO_MS)
    else installedUntil.delete(e.id)
    return ok
  }

  /**
   * The folder that actually holds whisper-server.exe: the official zip nests
   * everything under Release/, and a later release may not. Two levels down
   * and no further, so a pack that has no server is a quick "no" rather than
   * a walk of whatever was in the zip.
   */
  function findServer(dir: string, depth = 0): string | null {
    // sync-ok: the sync contract of gpuEngineDir, remembered with engineDirMemo
    if (existsSync(join(dir, SERVER_EXE))) return dir
    if (depth >= 2) return null
    let names: string[]
    try {
      // sync-ok: two levels down at most, remembered with engineDirMemo
      names = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return null
    }
    for (const name of names) {
      const hit = findServer(join(dir, name), depth + 1)
      if (hit) return hit
    }
    return null
  }

  /** Folders of this pack under another hash: a pack the catalog has replaced. 643 MB each. */
  async function sweepPacks(e: CatalogEntry, keep: string | null): Promise<void> {
    const engines = join(root, 'engines')
    const ours = new RegExp(`^${e.id.replace(/[.]/g, '\\.')}-[0-9a-f]{12}$`)
    const names = await readdir(engines).catch(() => [] as string[])
    for (const name of names) {
      const path = join(engines, name)
      if (ours.test(name) && path !== keep) await gone(path)
    }
  }

  function report(e: CatalogEntry, flight: Flight): void {
    const p: DownloadProgress = { id: e.id, received: flight.received, total: e.bytes }
    for (const listen of flight.listeners) {
      // A listener is a window that may have closed; the download is not its hostage.
      try {
        listen(p)
      } catch {
        /* nothing to tell it */
      }
    }
  }

  /** One download, start to finish. Never rejects: every way out is a DownloadResult. */
  async function run(e: CatalogEntry, flight: Flight): Promise<DownloadResult> {
    const final = finalPath(e)
    const part = partPath(e)
    const signal = flight.controller.signal
    const cancelled: DownloadResult = { ok: false, reason: 'cancelled' }
    try {
      // sync-ok: the first line of a download, off the hot path
      if (installedSync(e)) return { ok: true }
      // Clear the way: a part file from a crash, and for the pack the zip and
      // the half-unzipped folder a crash during the unzip leaves behind.
      try {
        await mkdir(dirname(final), { recursive: true })
        await gone(part)
        if (isPack(e)) {
          await gone(final)
          await gone(packDir(e))
        }
      } catch (err) {
        return { ok: false, reason: 'disk', detail: message(err) }
      }

      let res: Response
      try {
        res = await fetchImpl(e.url, { signal })
      } catch (err) {
        return flight.cancelled ? cancelled : { ok: false, reason: 'network', detail: message(err) }
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => {})
        return { ok: false, reason: 'network', detail: `HTTP ${res.status}` }
      }

      // A FileHandle rather than a write stream: each write is awaited, which
      // is the backpressure, and a full disk is a rejected promise on the line
      // that caused it rather than an 'error' event somewhere else.
      const hash = createHash('sha256')
      const reader = res.body.getReader()
      let failed: DownloadResult | null = null
      let file
      try {
        file = await open(part, 'w')
      } catch (err) {
        await reader.cancel().catch(() => {})
        return { ok: false, reason: 'disk', detail: message(err) }
      }
      let lastReport = -Infinity
      let lastReported = -1
      try {
        for (;;) {
          let chunk: Uint8Array
          try {
            const step = await reader.read()
            if (step.done) break
            chunk = step.value
          } catch (err) {
            failed = flight.cancelled ? cancelled : { ok: false, reason: 'network', detail: message(err) }
            break
          }
          flight.received += chunk.byteLength
          // More than the catalog promised can never verify, so it is not
          // written to the end first: a wrong url must not be able to fill the disk.
          if (flight.received > e.bytes) {
            flight.controller.abort()
            failed = { ok: false, reason: 'checksum', detail: `more than the expected ${e.bytes} bytes` }
            break
          }
          hash.update(chunk)
          try {
            await file.write(chunk)
          } catch (err) {
            flight.controller.abort()
            failed = { ok: false, reason: 'disk', detail: message(err) }
            break
          }
          const t = now()
          if (t - lastReport >= PROGRESS_EVERY_MS) {
            lastReport = t
            lastReported = flight.received
            report(e, flight)
          }
        }
      } finally {
        await file.close().catch(() => {})
      }
      // The final word, whatever the clock says, unless the last chunk already said it.
      if (!failed && lastReported !== flight.received) report(e, flight)

      if (!failed && flight.cancelled) failed = cancelled
      if (!failed) {
        const got = hash.digest('hex')
        if (flight.received !== e.bytes) {
          failed = { ok: false, reason: 'checksum', detail: `${flight.received} bytes, expected ${e.bytes}` }
        } else if (got !== e.sha256.toLowerCase()) {
          failed = { ok: false, reason: 'checksum', detail: `sha256 ${got}` }
        }
      }
      if (failed) {
        await gone(part).catch(() => {})
        return failed
      }

      try {
        await rename(part, final)
      } catch (err) {
        await gone(part).catch(() => {})
        return { ok: false, reason: 'disk', detail: message(err) }
      }
      if (!isPack(e)) return { ok: true }

      // The pack: verified, THEN unzipped. `final` is the zip, and it keeps
      // the .zip name because Expand-Archive refuses any other extension.
      const dir = packDir(e)
      const undo = async (): Promise<void> => {
        await gone(final).catch(() => {})
        await gone(dir).catch(() => {})
      }
      try {
        await unzip(final, dir, signal)
      } catch (err) {
        await undo()
        return flight.cancelled ? cancelled : { ok: false, reason: 'unpack', detail: message(err) }
      }
      if (flight.cancelled) {
        await undo()
        return cancelled
      }
      const server = findServer(dir)
      if (!server) {
        await undo()
        return { ok: false, reason: 'unpack', detail: `no ${SERVER_EXE} in the pack` }
      }
      try {
        await gone(final)
        // LAST: from here on, and not a moment before, the folder reads as installed.
        // Whole or not at all (writeAtomic): a half-written marker would read
        // as a pack that is not there, or one that is.
        writeAtomic(join(dir, PACK_MARKER), JSON.stringify({ id: e.id, bytes: e.bytes, sha256: e.sha256 }))
      } catch (err) {
        await undo()
        return { ok: false, reason: 'disk', detail: message(err) }
      }
      engineDirMemo = server
      await sweepPacks(e, dir).catch(() => {})
      return { ok: true }
    } catch (err) {
      // Nothing above is meant to reach here; if it does, it is still an answer.
      await gone(part).catch(() => {})
      return { ok: false, reason: 'disk', detail: message(err) }
    }
  }

  function download(id: string, onProgress: (p: DownloadProgress) => void): Promise<DownloadResult> {
    const e = find(id)
    // The contract has no reason for "no such thing"; nothing can be fetched, so network it is.
    if (!e) return Promise.resolve({ ok: false, reason: 'network', detail: `not in the catalog: ${id}` })
    installedUntil.delete(id)
    const running = flights.get(id)
    if (running) {
      // Cancel and then Retry, quicker than the cancelled flight can tidy up:
      // the answer owed is a new download, not the old one's 'cancelled'.
      if (running.cancelled) return running.promise.then(() => download(id, onProgress))
      // Two windows, one download: both hear the progress, both get the same promise.
      running.listeners.add(onProgress)
      return running.promise
    }
    const flight: Flight = {
      promise: Promise.resolve({ ok: true }),
      controller: new AbortController(),
      received: 0,
      cancelled: false,
      listeners: new Set([onProgress])
    }
    flight.promise = run(e, flight).finally(() => {
      if (flights.get(id) === flight) flights.delete(id)
    })
    flights.set(id, flight)
    return flight.promise
  }

  function cancel(id: string): void {
    const flight = flights.get(id)
    if (!flight || flight.cancelled) return
    flight.cancelled = true
    // run() is what removes the part file, once the handle on it is closed.
    flight.controller.abort()
  }

  async function status(): Promise<ItemStatus[]> {
    const out: ItemStatus[] = []
    for (const e of catalog) {
      const flight = flights.get(e.id)
      if (flight) {
        // Through the unzip too: the row stays busy until the pack can be used.
        out.push({ id: e.id, state: 'downloading', received: flight.received })
        continue
      }
      const part = partPath(e)
      const left = await stat(part).catch(() => null)
      if (left && now() - left.mtimeMs > STALE_PART_MS) await gone(part).catch(() => {})
      installedUntil.delete(e.id)
      const here = installed(e)
      out.push({ id: e.id, state: here ? 'installed' : 'absent', received: here ? e.bytes : 0 })
    }
    return out
  }

  async function remove(id: string): Promise<void> {
    const e = find(id)
    if (!e) return
    const flight = flights.get(id)
    if (flight) {
      cancel(id)
      await flight.promise
    }
    installedUntil.delete(e.id)
    try {
      await gone(partPath(e))
      await gone(finalPath(e))
      if (isPack(e)) {
        engineDirMemo = null
        await gone(packDir(e))
        await sweepPacks(e, null)
      }
    } finally {
      // Again once the files are gone: an ask made while they went may have
      // found them still there.
      installedUntil.delete(e.id)
    }
  }

  function modelPath(id: string): string | null {
    const e = find(id)
    return e && !isPack(e) && installed(e) ? finalPath(e) : null
  }

  function gpuEngineDir(): string | null {
    const e = catalog.find(isPack)
    if (!e) return null
    // Believed with the marker: the folder was looked in when the "yes" was.
    const believed = (installedUntil.get(e.id) ?? 0) > now()
    if (!installed(e)) return null
    const dir = packDir(e)
    if (believed && engineDirMemo && engineDirMemo.startsWith(dir)) return engineDirMemo
    // sync-ok: the sync contract of gpuEngineDir: one stat on a remembered folder
    if (engineDirMemo && engineDirMemo.startsWith(dir) && existsSync(join(engineDirMemo, SERVER_EXE))) return engineDirMemo
    engineDirMemo = findServer(dir)
    return engineDirMemo
  }

  return { status, download, cancel, remove, modelPath, gpuEngineDir }
}
