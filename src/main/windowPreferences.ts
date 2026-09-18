import { createHash, randomUUID } from 'crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, watch, writeFileSync } from 'fs'
import { join } from 'path'
import {
  validWindowPreferenceKey,
  type WindowPreferencesSnapshot
} from '../shared/windowPreferences'

/** One atomic file per key: concurrent windows cannot overwrite unrelated settings. */
export function createWindowPreferences(
  owner: string,
  shared: boolean
): {
  load: () => WindowPreferencesSnapshot
  seed: (values: unknown) => WindowPreferencesSnapshot
  set: (change: unknown) => boolean
  watch: (changed: (snapshot: WindowPreferencesSnapshot) => void) => () => void
} {
  const root = join(owner, 'window-preferences')
  const file = (key: string): string =>
    join(root, `${createHash('sha256').update(key).digest('hex')}.json`)
  const validValue = (value: unknown): value is string | null =>
    value === null || (typeof value === 'string' && value.length <= 1024 * 1024)
  const write = (key: string, value: string | null, seed = false): void => {
    mkdirSync(root, { recursive: true })
    const text = JSON.stringify({ key, value })
    if (seed) {
      try {
        writeFileSync(file(key), text, { flag: 'wx' })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    } else {
      const tmp = join(root, `${randomUUID()}.tmp`)
      writeFileSync(tmp, text)
      renameSync(tmp, file(key))
    }
  }
  const load = (): WindowPreferencesSnapshot => {
    const values: Record<string, string> = Object.create(null)
    const removed: string[] = []
    let files: string[] = []
    try {
      files = readdirSync(root)
    } catch {
      /* Fresh profile. */
    }
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      try {
        const { key, value } = JSON.parse(readFileSync(join(root, name), 'utf8'))
        if (!validWindowPreferenceKey(key) || !validValue(value) || file(key) !== join(root, name))
          continue
        if (value === null) removed.push(key)
        else values[key] = value
      } catch {
        /* A damaged preference must not prevent opening a window. */
      }
    }
    return { values, removed, shared }
  }
  return {
    load,
    watch(changed) {
      try {
        mkdirSync(root, { recursive: true })
        let timer: ReturnType<typeof setTimeout> | undefined
        const watcher = watch(root, (_event, name) => {
          if (!name?.endsWith('.json')) return
          clearTimeout(timer)
          timer = setTimeout(() => changed(load()), 25)
          timer.unref()
        })
        watcher.on('error', () => watcher.close())
        return () => {
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
          if (validWindowPreferenceKey(key) && typeof value === 'string' && validValue(value))
            write(key, value, true)
      return load()
    },
    set(change) {
      if (!change || typeof change !== 'object') return false
      const { key, value } = change as { key: unknown; value: unknown }
      if (!validWindowPreferenceKey(key) || !validValue(value)) return false
      try {
        write(key, value)
        return true
      } catch {
        return false
      }
    }
  }
}
