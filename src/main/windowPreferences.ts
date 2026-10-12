import { createHash, randomUUID } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, watch, writeFileSync } from 'fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  validWindowPreferenceKey,
  type WindowPreferencesSnapshot
} from '../shared/windowPreferences'

/**
 * One atomic file per key: concurrent windows cannot overwrite unrelated settings.
 *
 * NEVER ON THE DISK WHILE THE USER WORKS (owner, 2026-10-12, after the 3.9 s
 * tabs.json freeze): the page asks through `sendSync` (load on every focus,
 * set on every shared localStorage write), so the answer comes from an
 * in-memory snapshot, read from disk once when the store is made (startup).
 * A set changes memory at once and is written behind it, atomically and one
 * write per key at a time, the newest last. The folder watch refreshes the
 * snapshot asynchronously, which is how another window's change arrives; a
 * key with a write of ours still pending keeps our value over the disk's.
 */
export function createWindowPreferences(
  owner: string,
  shared: boolean
): {
  load: () => WindowPreferencesSnapshot
  seed: (values: unknown) => WindowPreferencesSnapshot
  set: (change: unknown) => boolean
  watch: (changed: (snapshot: WindowPreferencesSnapshot) => void) => () => void
  refresh: () => Promise<WindowPreferencesSnapshot>
  flush: () => void
  idle: () => Promise<void>
} {
  const root = join(owner, 'window-preferences')
  const file = (key: string): string =>
    join(root, `${createHash('sha256').update(key).digest('hex')}.json`)
  const validValue = (value: unknown): value is string | null =>
    value === null || (typeof value === 'string' && value.length <= 1024 * 1024)

  /** What the disk held at the last read, plus every change made here since. */
  let memory = new Map<string, string | null>()
  /** Changes not yet on disk, newest per key; `seed` writes only if absent. */
  interface Pending {
    value: string | null
    seed: boolean
  }
  const pending = new Map<string, Pending>()
  const running = new Map<string, Promise<void>>()
  /** Bumped by every local change, so a disk read that began before one
   *  cannot put the older value back. */
  let stamp = 0
  const touched = new Map<string, number>()
  /** Bumped by the quit flush: an async write in flight must not land over it. */
  let flushes = 0

  const snapshot = (): WindowPreferencesSnapshot => {
    const values: Record<string, string> = Object.create(null)
    const removed: string[] = []
    for (const [key, value] of memory) {
      if (value === null) removed.push(key)
      else values[key] = value
    }
    return { values, removed, shared }
  }
  /** One preference file's contents, or undefined for a damaged or foreign one. */
  const parse = (name: string, text: string): [string, string | null] | undefined => {
    try {
      const { key, value } = JSON.parse(text)
      if (!validWindowPreferenceKey(key) || !validValue(value) || file(key) !== join(root, name))
        return undefined
      return [key, value]
    } catch {
      /* A damaged preference must not prevent opening a window. */
      return undefined
    }
  }
  const wanted = (name: string): boolean => /^[a-f0-9]{64}\.json$/.test(name)

  const readAllSync = (): Map<string, string | null> => {
    const read = new Map<string, string | null>()
    let files: string[] = []
    try {
      files = readdirSync(root) // sync-ok: startup, before the first window
    } catch {
      /* Fresh profile. */
    }
    for (const name of files) {
      if (!wanted(name)) continue
      let text: string
      try {
        text = readFileSync(join(root, name), 'utf8') // sync-ok: startup, before the first window
      } catch {
        continue
      }
      const entry = parse(name, text)
      if (entry) read.set(entry[0], entry[1])
    }
    return read
  }
  // sync-ok: startup, the store is made before the first window and answers sendSync from memory
  memory = readAllSync()

  /** Re-read the folder without blocking, keeping local changes made since. */
  let refreshing: Promise<WindowPreferencesSnapshot> | null = null
  let refreshAgain = false
  const refresh = (): Promise<WindowPreferencesSnapshot> => {
    if (refreshing) {
      // A change arrived while reading: read once more after this one.
      refreshAgain = true
      return refreshing
    }
    const run = (async (): Promise<WindowPreferencesSnapshot> => {
      do {
        refreshAgain = false
        const since = stamp
        const read = new Map<string, string | null>()
        let files: string[] = []
        try {
          files = await readdir(root)
        } catch {
          /* Fresh profile. */
        }
        const texts = await Promise.all(
          files.filter(wanted).map((name) =>
            readFile(join(root, name), 'utf8').then(
              (text) => [name, text] as const,
              () => null
            )
          )
        )
        for (const got of texts) {
          const entry = got && parse(got[0], got[1])
          if (entry) read.set(entry[0], entry[1])
        }
        // Ours wins where it is newer than the read or not yet on disk.
        for (const [key, value] of memory)
          if (pending.has(key) || (touched.get(key) ?? 0) > since) read.set(key, value)
        memory = read
      } while (refreshAgain)
      return snapshot()
    })()
    refreshing = run.finally(() => {
      refreshing = null
    })
    return refreshing
  }

  /** Write one key's newest pending value, then any newer one behind it. */
  const persist = (key: string): void => {
    if (running.has(key)) return
    const run = (async (): Promise<void> => {
      for (let next = pending.get(key); next; next = pending.get(key)) {
        const flushedAt = flushes
        const text = JSON.stringify({ key, value: next.value })
        const tmp = join(root, `${randomUUID()}.tmp`)
        try {
          await mkdir(root, { recursive: true })
          if (next.seed) {
            try {
              await writeFile(file(key), text, { flag: 'wx' })
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
              // Another window has it: its value, not the seed, is the truth.
              if (pending.get(key) === next) pending.delete(key)
              void refresh()
              continue
            }
          } else {
            await writeFile(tmp, text)
            if (flushedAt === flushes) await rename(tmp, file(key))
          }
        } catch {
          /* Unwritten: memory keeps it for this run; the disk wins at the next read. */
        } finally {
          await rm(tmp, { force: true }).catch(() => {})
        }
        if (pending.get(key) === next) pending.delete(key)
      }
    })()
    running.set(
      key,
      run.finally(() => running.delete(key))
    )
  }
  const remember = (key: string, value: string | null, seed = false): void => {
    memory.set(key, value)
    touched.set(key, ++stamp)
    pending.set(key, { value, seed })
    persist(key)
  }

  return {
    load: snapshot,
    refresh,
    watch(changed) {
      try {
        mkdirSync(root, { recursive: true }) // sync-ok: startup, the watch starts in app.whenReady
        let timer: ReturnType<typeof setTimeout> | undefined
        let stopped = false
        const watcher = watch(root, (_event, name) => {
          if (!name?.endsWith('.json')) return
          clearTimeout(timer)
          timer = setTimeout(() => {
            void refresh().then((next) => {
              if (!stopped) changed(next)
            })
          }, 25)
          timer.unref()
        })
        watcher.on('error', () => watcher.close())
        return () => {
          stopped = true
          clearTimeout(timer)
          watcher.close()
        }
      } catch {
        return () => {}
      }
    },
    seed(values) {
      if (!shared && values && typeof values === 'object' && !Array.isArray(values))
        for (const [key, value] of Object.entries(values))
          if (
            validWindowPreferenceKey(key) &&
            typeof value === 'string' &&
            validValue(value) &&
            !memory.has(key)
          )
            remember(key, value, true)
      return snapshot()
    },
    set(change) {
      if (!change || typeof change !== 'object') return false
      const { key, value } = change as { key: unknown; value: unknown }
      if (!validWindowPreferenceKey(key) || !validValue(value)) return false
      remember(key, value)
      return true
    },
    /** Quit: what is still pending goes to disk now. */
    flush() {
      flushes += 1
      for (const [key, next] of pending) {
        try {
          mkdirSync(root, { recursive: true }) // sync-ok: quit flush
          const text = JSON.stringify({ key, value: next.value })
          if (next.seed) writeFileSync(file(key), text, { flag: 'wx' }) // sync-ok: quit flush
          else {
            const tmp = join(root, `${randomUUID()}.tmp`)
            writeFileSync(tmp, text) // sync-ok: quit flush
            renameSync(tmp, file(key)) // sync-ok: quit flush
          }
        } catch {
          /* an existing file wins over a seed; anything else is lost with the run */
        }
      }
      pending.clear()
    },
    /** For tests: every pending write and the refresh in flight have finished. */
    async idle() {
      while (running.size || refreshing) {
        await Promise.all([...running.values()])
        if (refreshing) await refreshing
      }
    }
  }
}
