import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

/**
 * THE USER'S FILES GO THROUGH userFs (owner, 2026-11-11: four binned folders
 * holding an .asar "could not be deleted"). Electron's patched fs reads an
 * .asar file as a folder and holds it open, so every module that acts on the
 * user's files imports from `./userFs` (Electron's `original-fs`). This list
 * is those modules: none may import Node's fs directly again. The e2e
 * scenarios `binAsar` and `asarFiles` hold the behaviour in the real app.
 */
const USER_FILE_MODULES = [
  'archive', 'archiveBrowse', 'argv', 'audioSidecar', 'binList', 'binOps', 'binRestore', 'binRoots',
  'binTrash', 'binWatch', 'browse', 'browseSearch', 'browseWatch', 'comic', 'copyCounted', 'copyJobs',
  'dirList', 'docConvert', 'explorerListing', 'extractJob', 'fileOps', 'fileHash', 'fileTail',
  'folderIconFiles', 'folderSize', 'folderSizeCache', 'fsUtil', 'heicWorker', 'heifExif', 'imageDecode',
  'imageEncode', 'ipc/archive', 'ipc/drag', 'ipc/files', 'ipc/props', 'liveVideo', 'midi', 'moveOps',
  'pasteCopy', 'pathWall', 'peaks', 'phone/phoneAccess', 'propsMedia', 'rawPreview', 'replaceFile',
  'sevenZip', 'subtitles', 'thumbs', 'videoConvert', 'zipOps', 'zipStage'
]

/**
 * A value import (or dynamic import) of Node's fs; `import type` is fine, and
 * so is a line marked `// own-fs: <reason>` (Prism's OWN files, such as the
 * bundled 7z.exe, which keep Electron's fs).
 */
const NODE_FS = /^(?!.*\/\/ own-fs: ).*(?:^[ \t]*(?:import\s+(?!type\b)[^'"]*|\}[ \t]*)from\s+'(?:node:)?fs(?:\/promises)?'|import\(\s*'(?:node:)?fs(?:\/promises)?'\s*\))/m

vi.mock('fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs/promises')>())
}))

describe('userFs', () => {
  it.each(USER_FILE_MODULES)('%s reads and writes the user\'s files through userFs, not Node\'s fs', (name) => {
    const src = readFileSync(join(__dirname, `${name}.ts`), 'utf8')
    expect(NODE_FS.test(src), `${name}.ts imports Node's fs: use ./userFs (an .asar is a file)`).toBe(false)
    expect(src).toMatch(/from '\.\.?\/userFs'|import\('\.\.?\/userFs'\)/)
  })

  it('the rule catches a direct import', () => {
    expect(NODE_FS.test("import { rm } from 'fs/promises'")).toBe(true)
    expect(NODE_FS.test("import { statSync } from 'node:fs'")).toBe(true)
    expect(NODE_FS.test("const fs = await import('fs/promises')")).toBe(true)
    expect(NODE_FS.test("import {\n  rm,\n  stat\n} from 'fs/promises'")).toBe(true)
    expect(NODE_FS.test("import type { Dirent } from 'fs'")).toBe(false)
    expect(NODE_FS.test("import { existsSync } from 'fs' // own-fs: a bundled exe")).toBe(false)
  })

  it('is plain fs outside Electron, looked up at call time so a test can still spy on fs/promises', async () => {
    const fsp = await import('fs/promises')
    const userFs = await import('./userFs')
    expect(process.versions.electron).toBeUndefined()
    expect(userFs.userFs.statSync).toBe((await import('fs')).statSync)
    const spy = vi.spyOn(fsp, 'stat')
    spy.mockRejectedValueOnce(new Error('spied'))
    await expect(userFs.stat(__filename)).rejects.toThrow('spied')
    spy.mockRestore()
    expect((await userFs.stat(__filename)).isFile()).toBe(true)
  })
})
