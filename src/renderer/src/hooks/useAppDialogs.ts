import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { baseName } from '@shared/path'
import type { AskAnswers } from '../dialogs/AskDialogs'
import type { Ask } from '../dialogs/asks'
import { setFolderIcons, type FolderIconChoice } from '../lib/folderIcons'
import { keptFolderIconFile } from '../lib/folderIconFiles'
import { folderIconFromFile, ICON_REFUSED } from '../lib/iconFromFile'
import type { useBinOps } from './useBinOps'
import type { FileOps } from './useFileOps'

// The questions the window asks (audit #8, 2026-11-21): the one `ask` state,
// the unsaved-text "save all" step, the external-change answer and the folder
// icon picker's answers. Moved out of App.tsx unchanged.

export interface AppDialogs {
  ask: Ask | null
  setAsk: Dispatch<SetStateAction<Ask | null>>
  reloadAnswer: { path: string; reload: boolean } | null
  setReloadAnswer: Dispatch<SetStateAction<{ path: string; reload: boolean } | null>>
  onExternalChange: (path: string) => void
  saveAllThen: (then: () => void) => void
  changeFolderIcon: (paths: string[], name: string) => void
  setFolderIcon: (paths: string[], icon: FolderIconChoice | null) => void
  folderIconFromFileAnswer: (ask: Extract<Ask, { kind: 'folder-icon' }>) => void
}

export function useAppDialogs(saveAll: () => Promise<string[]>): AppDialogs {
  const [ask, setAsk] = useState<Ask | null>(null)
  /**
   * Something outside Prism rewrote a file that holds unsaved edits
   * (2026-08-31). The editor swaps a CLEAN file silently - taking the new
   * version costs nothing and asking would be noise - and reports a dirty one
   * here, because Prism has no diff and no merge: it is keep mine or take
   * theirs, and only the user can pick.
   */
  const [reloadAnswer, setReloadAnswer] = useState<{ path: string; reload: boolean } | null>(null)
  const onExternalChange = useCallback((path: string) => {
    setAsk({ kind: 'file-changed', path, name: baseName(path) })
  }, [])
  /** "Save all changes" in an unsaved-changes question: write everything,
   *  then go on. A failed write must not close anything over the top of the
   *  text it failed to keep: we stay put and say which file. */
  const saveAllThen = useCallback(
    (then: () => void): void =>
      void saveAll().then((failed) => {
        if (failed.length) {
          setAsk({ kind: 'failed', message: `Couldn't save ${failed.map(baseName).join(', ')}.`, op: 'save-text' })
          return
        }
        setAsk(null)
        then()
      }),
    [saveAll]
  )
  /** Change icon... (folder icons, 2026-10-31): the picker for these paths. */
  const changeFolderIcon = (paths: string[], name: string): void =>
    setAsk({ kind: 'folder-icon', paths, name })
  /** Set (or reset); the store has main remove a picture no folder uses now. */
  const setFolderIcon = (paths: string[], icon: FolderIconChoice | null): void => setFolderIcons(paths, icon)
  /** "From a file..." (2026-10-31): main's dialog, the 64 px copy kept, then
   *  the picker closes; a cancel leaves it up, a refusal says why. */
  const iconFileBusy = useRef(false)
  const folderIconFromFileAnswer = (ask: Extract<Ask, { kind: 'folder-icon' }>): void => {
    if (iconFileBusy.current) return
    iconFileBusy.current = true
    const settle = (next: Ask | null): void => setAsk((cur) => (cur === ask ? next : cur))
    void folderIconFromFile(window.prism, keptFolderIconFile)
      .then((r) => {
        if (!r) return
        if ('refused' in r) return settle({ kind: 'failed', message: r.refused, op: 'folder-icon' })
        setFolderIcon(ask.paths, { file: r.file })
        settle(null)
      })
      .catch(() => settle({ kind: 'failed', message: ICON_REFUSED.unreadable, op: 'folder-icon' }))
      .finally(() => {
        iconFileBusy.current = false
      })
  }
  return {
    ask,
    setAsk,
    reloadAnswer,
    setReloadAnswer,
    onExternalChange,
    saveAllThen,
    changeFolderIcon,
    setFolderIcon,
    folderIconFromFileAnswer
  }
}

export interface AskAnswerSources {
  dialogs: AppDialogs
  unsavedNames: readonly string[]
  fileOps: Pick<FileOps, 'runDelete' | 'runDeleteMany' | 'runPurge' | 'runMove' | 'runRename'>
  binOps: Pick<ReturnType<typeof useBinOps>, 'runRestore' | 'runDelete' | 'runEmpty'>
  leave: AskAnswers['leave']
  discardAll: () => void
  discardTabBuffers: AskAnswers['discardTabBuffers']
  forceCloseTab: AskAnswers['forceCloseTab']
  runInstall: AskAnswers['runInstall']
}

/** What the answers of every question do (dialogs/AskDialogs): built each
 *  render from the jobs the window already has, as App always did. */
export function askAnswersFor(p: AskAnswerSources): AskAnswers {
  const { dialogs, fileOps, binOps } = p
  return {
    dismiss: () => dialogs.setAsk(null),
    unsavedNames: p.unsavedNames,
    runDelete: (path) => void fileOps.runDelete(path),
    runDeleteMany: (paths) => void fileOps.runDeleteMany(paths),
    askPermanent: (paths) => dialogs.setAsk({ kind: 'delete-permanent', paths }),
    runPurge: (paths) => void fileOps.runPurge(paths),
    runMove: (paths, dest, mode) => void fileOps.runMove(paths, dest, mode),
    runRename: (path, name, onClash) => void fileOps.runRename(path, name, onClash),
    leave: p.leave,
    discardAll: p.discardAll,
    saveAllThen: dialogs.saveAllThen,
    discardTabBuffers: p.discardTabBuffers,
    forceCloseTab: p.forceCloseTab,
    answerReload: (path, reload) => dialogs.setReloadAnswer({ path, reload }),
    runInstall: p.runInstall,
    setFolderIcon: dialogs.setFolderIcon,
    folderIconFromFile: dialogs.folderIconFromFileAnswer,
    runBinRestore: (paths, mode) => void binOps.runRestore(paths, mode),
    runBinDelete: (paths) => void binOps.runDelete(paths),
    runBinEmpty: () => void binOps.runEmpty()
  }
}
