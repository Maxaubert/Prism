import * as nodeFs from 'fs'
import * as nodeFsp from 'fs/promises'
import * as originalFs from 'original-fs'

/**
 * THE USER'S FILES GO THROUGH THE PLAIN FS (owner, 2026-11-11: "4 of 4 could
 * not be deleted"). Electron patches Node's `fs` in main, in worker threads and
 * in utility processes so a path through an `.asar` file is an archive FOLDER:
 * `stat` calls it a directory of 0 bytes, `rm` and `rename` fail, a copy says
 * "Invalid package", and the first touch opens the archive and holds it open
 * for the life of the process (EBUSY for anything after). The owner's bin held
 * an installed Electron app and two node projects; every folder but the
 * `.asar` inside it was removed, and the four stayed.
 *
 * So every operation on files the USER owns (browse, sizes, copy, move,
 * rename, delete, the bin, archives, viewers) imports from here: Electron's
 * `original-fs`, which is Node's fs without the patch. Prism's OWN code and
 * assets live in its app.asar and keep the patched `fs`: module loading,
 * worker scripts, the renderer files the media protocol and the phone serve.
 * `process.noAsar` is never set, for that reason.
 *
 * Outside Electron (vitest) this is plain `fs` (`original-fs` is aliased to it
 * in vitest.config.ts). The promise API is looked up at CALL time, so a test's
 * `vi.mock('fs/promises')` and `vi.spyOn` still reach the module under test.
 */
const electron = !!process.versions.electron

/** The callback and sync API: Electron's unpatched fs, or Node's own. */
export const userFs: typeof nodeFs = electron ? (originalFs as typeof nodeFs) : nodeFs

function promises(): typeof nodeFsp {
  return electron ? (originalFs as typeof nodeFs).promises : nodeFsp
}

type P = typeof nodeFsp
function fwd<K extends keyof P>(k: K): P[K] {
  return ((...args: unknown[]) => (promises()[k] as (...a: unknown[]) => unknown)(...args)) as P[K]
}

export const access = fwd('access')
export const appendFile = fwd('appendFile')
export const copyFile = fwd('copyFile')
export const cp = fwd('cp')
export const lstat = fwd('lstat')
export const mkdir = fwd('mkdir')
export const mkdtemp = fwd('mkdtemp')
export const open = fwd('open')
export const opendir = fwd('opendir')
export const readdir = fwd('readdir')
export const readFile = fwd('readFile')
export const readlink = fwd('readlink')
export const realpath = fwd('realpath')
export const rename = fwd('rename')
export const rm = fwd('rm')
export const rmdir = fwd('rmdir')
export const stat = fwd('stat')
export const statfs = fwd('statfs')
export const symlink = fwd('symlink')
export const unlink = fwd('unlink')
export const utimes = fwd('utimes')
export const writeFile = fwd('writeFile')

export const constants = nodeFs.constants
export type { Dirent, FSWatcher } from 'fs'
export type { FileHandle } from 'fs/promises'
