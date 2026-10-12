import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { withImpliedFolders } from '@shared/archiveTree'
import { rememberArchivePassword } from '../../lib/archivePass'
import type { Entry } from './entry'

// THE ARCHIVE PANEL'S LISTING (out of ArchiveView.tsx, structure cleanup
// 2026-10-12, unchanged): every member of the container, whether the
// container can be written, and the reload (with a password once one is
// asked for). Re-read whenever App bumps `refreshKey`.

export type Listing = Entry[] | null | 'error' | 'locked'

export function useArchiveListing(
  path: string,
  refreshKey: number
): {
  entries: Listing
  setEntries: Dispatch<SetStateAction<Listing>>
  readOnly: boolean
  load: (password?: string) => void
} {
  // 'locked' is its own state (2026-08-30): a 7z or rar written with encrypted
  // file NAMES cannot be listed at all without the password, which is not the
  // same thing as a broken archive and must not read as one.
  const [entries, setEntries] = useState<Listing>(null)
  // 7z, rar, tar and the rest are read through 7-Zip and never written, so the
  // panel offers no verbs that would fail. zip keeps all of its.
  const [readOnly, setReadOnly] = useState(false)
  useEffect(() => {
    void window.prism.archiveStat(path).then((st) => setReadOnly(!!st?.readOnly))
  }, [path])

  const load = useCallback(
    (password?: string) => {
      void window.prism.archiveList(path, password).then((r) => {
        if (r.ok) {
          // A password that got us in belongs to the renderer's own store too,
          // so dragging a member out to a folder does not ask again.
          if (password) rememberArchivePassword(path, password)
          // A zip's directory records are OPTIONAL and plenty of writers
          // leave them out, which used to make such an archive read as
          // EMPTY: every member's parent was two levels down and the
          // folders those names imply did not exist to be listed.
          setEntries(withImpliedFolders(r.entries))
          return
        }
        setEntries(r.reason === 'password' ? 'locked' : 'error')
      })
    },
    [path]
  )
  useEffect(() => load(), [load, refreshKey])
  return { entries, setEntries, readOnly, load }
}
