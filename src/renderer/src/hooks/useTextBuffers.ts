import { useCallback, useRef, useState } from 'react'
import { baseName } from '@shared/path'

/** Unsaved text, held by App and not by the editor (moved out of App.tsx, #538 item 9).
 * `activeIdRef` is the active tab's id, read when a buffer is first reported so
 * the tab that owns it is known (a torn-off tab takes its buffers along).
 */
export function useTextBuffers(activeIdRef: { readonly current: string | null }) {  const buffers = useRef(new Map<string, { path: string; text: string }>())
  const bufferOwners = useRef(new Map<string, Set<string>>())
  const [dirtyPaths, setDirtyPaths] = useState<ReadonlySet<string>>(new Set())
  // The names as they are actually spelled. dirtyPaths is lowercased for
  // matching, which is no way to address someone's file in a dialog.
  const [unsavedNames, setUnsavedNames] = useState<readonly string[]>([])
  const syncDirty = useCallback(() => {
    setDirtyPaths(new Set(buffers.current.keys()))
    setUnsavedNames([...buffers.current.values()].map((b) => baseName(b.path)))
    // Main needs this too: it is what holds the window open on a close.
    window.prism.setDirty(buffers.current.size > 0)
  }, [])
  /**
   * A file Prism just binned has no unsaved text to save (2026-08-30).
   *
   * `file:write` no longer demands the target exist, which is what lets a
   * file renamed out from under a dirty buffer still be saved. The other side
   * of that coin is this: without dropping the buffer, closing the window and
   * answering "Save all changes" would RECREATE a file the user had put in
   * the Recycle Bin. Prism did the deleting, so Prism knows.
   */
  const dropBuffers = useCallback(
    (paths: readonly string[]) => {
      let hit = false
      for (const gone of paths) {
        const under = gone.toLowerCase()
        for (const key of [...buffers.current.keys()]) {
          // A folder takes its files with it.
          if (key === under || key.startsWith(under + '\\')) {
            buffers.current.delete(key)
            hit = true
          }
        }
      }
      if (hit) syncDirty()
    },
    [syncDirty]
  )

  /**
   * ...and a file Prism RENAMED keeps its unsaved text, under the new name.
   * Dropping it here would throw away the work; leaving it under the old name
   * would recreate the old file on the next save.
   */
  const rekeyBuffer = useCallback(
    (from: string, to: string) => {
      const old = from.toLowerCase()
      const buf = buffers.current.get(old)
      if (!buf) return
      buffers.current.delete(old)
      buffers.current.set(to.toLowerCase(), { path: to, text: buf.text })
      for (const owned of bufferOwners.current.values())
        if (owned.delete(old)) owned.add(to.toLowerCase())
      syncDirty()
    },
    [syncDirty]
  )

  /** What the editor should show for a file: unsaved text if we kept any. */
  const getPending = useCallback((p: string) => buffers.current.get(p.toLowerCase())?.text, [])
  /** The editor reports its buffer as it changes; null once it matches disk. */
  const onBuffer = useCallback(
    (path: string, text: string | null) => {
      const key = path.toLowerCase()
      if (text === null) buffers.current.delete(key)
      else {
        buffers.current.set(key, { path, text })
        if (activeIdRef.current) {
          const owned = bufferOwners.current.get(activeIdRef.current) ?? new Set<string>()
          owned.add(key)
          bufferOwners.current.set(activeIdRef.current, owned)
        }
      }
      syncDirty()
    },
    [activeIdRef, syncDirty]
  )
  /** Write every unsaved buffer. Returns the paths that could not be written,
   *  so a failing disk cancels the close instead of eating the work. */
  const saveAll = useCallback(async (): Promise<string[]> => {
    const failed: string[] = []
    for (const [key, buf] of [...buffers.current]) {
      if ((await window.prism.writeText(buf.path, buf.text)).ok) buffers.current.delete(key)
      else failed.push(buf.path)
    }
    syncDirty()
    return failed
  }, [syncDirty])

  return {
    buffers,
    bufferOwners,
    dirtyPaths,
    unsavedNames,
    syncDirty,
    dropBuffers,
    rekeyBuffer,
    getPending,
    onBuffer,
    saveAll
  }
}
