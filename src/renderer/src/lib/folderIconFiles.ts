import { useSyncExternalStore } from 'react'
import type { IconList } from '@shared/folderIconFiles'

/**
 * THE KEPT ICON PICTURES, AS DATA URLS (folder icons from a file, 2026-10-31).
 * Main keeps each picture as a 64 px PNG under userData and hands them all
 * over in one call (`folder-icons:custom`); this caches them for every row,
 * the way `sysIcon.ts` caches association icons. Nothing is asked for until
 * some folder has a picture (`preloadFolderIconFiles`).
 *
 * A picture another window kept after this one loaded is fetched again once
 * (`wantFolderIconFile`). After the first COMPLETE load, the caller learns
 * which ids main has, so an entry whose copy is gone (userData cleared) is
 * dropped. A list main could not read in full (a copy an antivirus held,
 * review M1) never drops anything: it draws what it has and waits for a
 * complete one.
 */

export type IconFileMap = ReadonlyMap<string, string>

type Api = { folderIconFiles: () => Promise<IconList> }

let files: IconFileMap | null = null
/** Main's list has landed at least once (a kept picture alone is not that). */
let loaded = false
/** A COMPLETE list has landed, and the first-load callers were told. */
let told = false
let loading: Promise<IconFileMap> | null = null
const asked = new Set<string>()
const listeners = new Set<() => void>()
const firstLoad: Array<(have: IconFileMap) => void> = []

const emit = (): void => {
  for (const l of [...listeners]) l()
}

const api = (): Api | undefined => (globalThis as { window?: { prism?: Api } }).window?.prism

function fetchAll(): Promise<IconFileMap> {
  const bridge = api()
  if (!bridge) return Promise.resolve(files ?? new Map())
  loading = bridge.folderIconFiles().then(
    (list) => {
      loaded = true
      // Keep what this window kept meanwhile (`keptFolderIconFile`).
      files = new Map([...(files ?? []), ...Object.entries(list.files)])
      loading = null
      if (list.complete && !told) {
        told = true
        for (const cb of firstLoad.splice(0)) cb(files)
      }
      emit()
      return files
    },
    (err: unknown) => {
      loading = null
      throw err
    }
  )
  return loading
}

/** Load the kept pictures once (a later call is a no-op). */
export function preloadFolderIconFiles(): void {
  if (loaded || loading) return
  void fetchAll().catch(() => {})
}

/** A row wants `id` and the cache does not have it: ask main again, once per id. */
export function wantFolderIconFile(id: string): void {
  if (!loaded || !files || loading || files.has(id) || asked.has(id)) return
  asked.add(id)
  void fetchAll().catch(() => {})
}

/** This window just kept `id`: no round trip to draw it. */
export function keptFolderIconFile(id: string, url: string): void {
  files = new Map(files ?? []).set(id, url)
  emit()
}

/** Called once, with the ids main has, when the first complete list lands. */
export function onFirstFolderIconFiles(cb: (have: IconFileMap) => void): void {
  if (told) return
  firstLoad.push(cb)
}

export const folderIconFilesNow = (): IconFileMap | null => files

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The kept pictures, or null until loaded; renders again as they arrive. */
export function useFolderIconFiles(): IconFileMap | null {
  return useSyncExternalStore(subscribe, folderIconFilesNow, folderIconFilesNow)
}

/** Tests only: forget everything. */
export function resetFolderIconFilesForTest(): void {
  files = null
  loaded = false
  told = false
  loading = null
  asked.clear()
  firstLoad.length = 0
  listeners.clear()
}
