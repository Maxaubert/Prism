import { useEffect, useMemo, useState } from 'react'
import type { BinUsage } from '@shared/ipcTypes'
import { useFolderSizes } from '../hooks/useFolderSizes'
import { archivePassword } from '../lib/archivePass'
import { archiveBytes, sumDeleteSize, type DeleteSize } from './deleteCopy'

/** Files read at once while the question is open. */
const STAT_AT_ONCE = 8

interface Stats {
  files: number[]
  folders: string[]
  /** A path Prism could not read (gone, outside the open folders). */
  failed: boolean
}

/**
 * HOW BIG WHAT GOES IS (#503). The question has already opened; this fills the
 * line in and the buttons never wait for it. A file's size is read once
 * (`file:stat`, eight at a time), a folder's is COUNTED by the same counter the
 * Properties window uses (`useFolderSizes`: cached, cancellable, and a size
 * already seen in the Explorer is there at once). Until every part is known the
 * answer is `counting`, and the dialog shows a quiet ellipsis.
 */
export function useDeleteSize(paths: readonly string[], known?: number): DeleteSize {
  const key = paths.join('\n')
  const [stats, setStats] = useState<{ key: string; value: Stats } | null>(null)
  const skip = known !== undefined
  useEffect(() => {
    if (skip) return
    let alive = true
    const list = key ? key.split('\n') : []
    const files: number[] = []
    const folders: string[] = []
    let failed = false
    let next = 0
    const worker = async (): Promise<void> => {
      while (alive && next < list.length) {
        const path = list[next++]
        const st = await window.prism.statFile(path).catch(() => null)
        if (!st) failed = true
        else if (st.isFolder) folders.push(path)
        else files.push(st.size)
      }
    }
    void Promise.all(Array.from({ length: Math.min(STAT_AT_ONCE, list.length) }, worker)).then(() => {
      if (alive) setStats({ key, value: { files, folders, failed } })
    })
    return () => {
      alive = false
    }
  }, [key, skip])
  const mine = stats?.key === key ? stats.value : undefined
  const folders = useMemo(() => mine?.folders ?? [], [mine])
  const sizes = useFolderSizes(folders, !skip && !!mine && folders.length > 0)
  if (skip) return { state: 'known', bytes: known }
  if (mine?.failed) return { state: 'none' }
  return sumDeleteSize({ files: mine?.files, folders, sizes })
}

/** How big the zip members that go are: the archive's own listing, summed. */
export function useArchiveSize(container: string, inners: readonly string[]): DeleteSize {
  const key = `${container}\n${inners.join('\n')}`
  const [done, setDone] = useState<{ key: string; size: DeleteSize }>()
  useEffect(() => {
    let alive = true
    void window.prism
      .archiveList(container, archivePassword(container))
      .then((r) => {
        const size: DeleteSize = r.ok
          ? { state: 'known', bytes: archiveBytes(r.entries, inners) }
          : { state: 'none' }
        if (alive) setDone({ key, size })
      })
      .catch(() => alive && setDone({ key, size: { state: 'none' } }))
    return () => {
      alive = false
    }
    // `key` carries the container and the inners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return done?.key === key ? done.size : { state: 'counting' }
}

/** What Empty Recycle Bin frees, asked of main when the question opens. */
export function useBinUsage(): BinUsage | undefined {
  const [usage, setUsage] = useState<BinUsage>()
  useEffect(() => {
    let alive = true
    void window.prism
      .binUsage()
      .then((u) => alive && setUsage(u))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  return usage
}
