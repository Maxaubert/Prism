import { app, clipboard, shell, ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import type {
  ArchiveAddResult,
  ArchiveMoveResult,
  BinIfEmptyResult,
  MoveOnClash,
  MoveResult,
  PasteResult
} from '@shared/ipcTypes'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import { copyFile, readFile, stat, writeFile } from 'fs/promises'
import { execFile, spawn } from 'child_process'
import { copyWindowsFiles, hasWindowsFiles, readWindowsFiles } from '../fileClipboard'
import { insideDesktop } from '../desktopAccess'
import { container } from '../archiveBrowse'
import { holders } from '../holders'
import { documentImages } from '../docImages'
import { encodeText, fallbackShape, moveShapes } from '../textFile'
import { replaceFile } from '../replaceFile'
import { readTail, startTail, stopTail } from '../fileTail'
import { binIfEmpty, makeFolder, renameFile, uniqueNameAsync } from '../fileOps'
import { appsForExt, argsFor, type AppCandidate } from '../openWith'
import { addToArchive, archiveTooLarge, moveMembers } from '../archive'
import { insideSelf, moveEntries } from '../moveOps'
import { copyCounted, pastesIntoItself } from '../pasteCopy'
import { fileKind, isMarkdown } from '@shared/fileKind'
import { samePath } from '@shared/path'
import type { OnClash, OpenWithApp, RenameResult, TextRead, WriteResult } from '@shared/types'
import { exists } from '../fsUtil'
import { sendToPage } from '../appState'
import { saveDialog } from '../dialogs'
import type { MainCtx, ReadyCtx } from './context'

export function registerSaveCopyIpc(ctx: MainCtx): void {
  const { ownWrite, written } = ctx
  /**
   * Save the picture as an ordinary PNG or JPEG, somewhere the user picks.
   *
   * The destination is OUTSIDE every root on purpose, and that is not a hole
   * in the wall: main's own save dialog IS the consent, exactly as it is for
   * "Extract all" and for picking a subtitle file. The renderer hands over
   * bytes it encoded from the decoded picture; main never re-reads the
   * source, so a HEIC or a camera RAW saves as easily as a PNG.
   */
  ipcMain.handle(
    CALL.imageSaveCopy,
    async (
      _e,
      bytes: ArrayBuffer,
      suggested: string,
      format: 'png' | 'jpeg'
    ): Promise<string | null> => {
      if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength) return null
      const ext = format === 'png' ? 'png' : 'jpg'
      const r = await saveDialog({
        defaultPath: suggested.replace(/\.[^.]*$/, '') + '.' + ext,
        filters: [{ name: format === 'png' ? 'PNG image' : 'JPEG image', extensions: [ext] }]
      })
      if (r.canceled || !r.filePath) return null
      try {
        // Muted so the folder watcher does not report Prism's own write.
        ownWrite(r.filePath)
        await writeFile(r.filePath, Buffer.from(bytes))
        await written(r.filePath)
        return r.filePath
      } catch {
        return null
      }
    }
  )
}

/** Rename, bin, read and save text, follow a growing file. */
export function registerFilesIpc(ctx: MainCtx, ready: ReadyCtx): void {
  const { TEXT_MAX_BYTES, editable, ownWrite, readable, textShape, wall, written } = ctx
  const { positions, readTextWalled } = ready
  // File operations. Inside the root only, and nothing is ever destroyed: an
  // overwritten or deleted file goes to the Recycle Bin.
  // The root itself is off limits: renaming or binning the folder the tree is
  // rooted in would pull the ground out from under the window.
  // The guard is the wall's `editable` (pathWall.ts).
  ipcMain.handle(
    CALL.fileRename,
    async (_e, p: string, name: string, onClash: OnClash): Promise<RenameResult> => {
      ownWrite(p)
      if (!editable(p))
        return { ok: false, reason: 'failed', message: 'That folder is the one Prism opened in.' }
      await holders.release([p]) // a rename is refused for the same reason a move is (#127)
      const r = await renameFile(p, name, onClash, (t) => shell.trashItem(t))
      await written(p, r.ok ? r.path : dirname(p))
      // The file's memory follows it (#124): its place and its choices. Its
      // encoding and line endings too (2026-10-16), or a dirty buffer renamed
      // before its save was written as utf-8 with LF.
      if (r.ok) {
        void positions.rename(p, r.path)
        moveShapes(textShape, p, r.path)
      }
      return r
    }
  )
  ipcMain.handle(CALL.fileTrash, async (_e, p: string): Promise<boolean> => {
    ownWrite(p)
    if (!editable(p)) return false
    try {
      await shell.trashItem(p)
      return true
    } catch {
      return false
    } finally {
      await written(p)
    }
  })
  // The same wall as every other handler. A text file only ever reaches the
  // renderer from inside the session root, and opening one from outside
  // re-roots first, so this refuses nothing the app legitimately asks for.
  /**
   * The LAST slice of a file, read-only (2026-08-31).
   *
   * For a file `file:text` refuses: over 64MB it cannot be handed over as
   * one string, and the honest answer used to be an overlay saying so. The
   * tail is the useful half of a 900MB log. Answers with the offset and
   * the real size, so the editor can say what it is showing - and it never
   * pretends to be the file, so nothing can save it back.
   */
  ipcMain.handle(CALL.fileTailBytes, async (_e, p: string, max: number) => {
    if (!readable(p)) return null
    const want = Math.min(Math.max(64 * 1024, Number(max) || 0), TEXT_MAX_BYTES)
    return readTail(p, want)
  })

  /** Follow a file that is still being written: new bytes arrive on
   *  `file:appended` until `tail:stop`. One watch per path. */
  ipcMain.handle(CALL.tailStart, async (_e, p: string, from: number) => {
    if (!readable(p)) return false
    return startTail(p, Number(from) || 0, (e) =>
      sendToPage(PUSH.fileAppended, e)
    )
  })
  ipcMain.handle(CALL.tailStop, (_e, p: string) => {
    if (typeof p === 'string') stopTail(p)
  })

  ipcMain.handle(CALL.fileText, async (_e, p: string): Promise<TextRead> => {
    // Extracted archive members live in temp, outside every root; each one
    // was granted individually when archive:extract wrote it.
    if (!readable(p)) return { error: 'unreadable' }
    const r = await readTextWalled(p)
    // A markdown document may point at pictures OUTSIDE the folder Prism
    // opened in ("../assets/logo.png" from a doc in docs/), which the
    // media wall would otherwise refuse. Main grants exactly the files
    // this document names, having read it (see docImages.ts).
    if ('text' in r && isMarkdown(p))
      for (const img of await documentImages(p, r.text)) wall.grantServable(img)
    return r
  })
  // The editor's save. Text files only, in place, inside the root: this is
  // the third thing Prism writes (after rename and bin), and the narrowest.
  /**
   * Save the editor's text. Answers with a REASON (2026-08-30).
   *
   * It used to demand that the file already exist, and answer a bare
   * boolean. Both hurt: a file renamed or moved out from under a dirty
   * buffer could never be saved at all, and "Save all changes" at close
   * time failed with nothing to show the user but a silence. The parent
   * folder still has to exist, so a save cannot create a file somewhere
   * nothing asked for, and the root wall and the text-kind check are
   * unchanged. Extracted archive members stay unwritable: reads honour
   * `extractedPaths`, writes never do.
   */
  ipcMain.handle(CALL.fileWrite, async (_e, p: string, text: string): Promise<WriteResult> => {
    ownWrite(p)
    if (!insideDesktop(p)) return { ok: false, reason: 'refused' }
    if (fileKind(extname(p).toLowerCase(), basename(p)) !== 'text')
      return { ok: false, reason: 'refused' }
    if (!(await exists(dirname(p)))) return { ok: false, reason: 'gone' }
    try {
      // Back in the shape it came in. CodeMirror rejoins its document with
      // a bare newline whatever it read, so without this one fixed typo in
      // a .bat was 400 changed lines, and a UTF-16 file came back as UTF-8.
      // With no remembered read, the file as it is on disk now (2026-10-16:
      // the fallback was utf-8 with LF whatever the file held). Capped like
      // a read: a file too big to open is not sniffed whole either.
      const remembered = textShape.get(p.toLowerCase())
      const onDisk = async (): Promise<Buffer | null> => {
        const st = await stat(p).catch(() => null)
        return st?.isFile() && st.size <= TEXT_MAX_BYTES ? readFile(p).catch(() => null) : null
      }
      const shape = remembered ?? fallbackShape(await onDisk())
      // Whole or not at all (2026-10-16): a truncating write left the file
      // empty on a full or pulled disk (replaceFile.ts).
      await replaceFile(p, encodeText(text, shape))
      return { ok: true }
    } catch (e) {
      // EACCES, EROFS, ENOSPC: the cases worth naming rather than leaving
      // the user to guess why their work would not save.
      return {
        ok: false,
        reason: 'failed',
        message: String((e as NodeJS.ErrnoException)?.code ?? '')
      }
    } finally {
      await written(p)
    }
  })
}

/** Explorer's verbs, Open with, the clipboard and paste, file icons, restore. */
export function registerShellIpc(ctx: MainCtx): void {
  const { ownWrite, readable, shellVerbSetting, textShape, written } = ctx
  // "Open file" / "Open as project" in File Explorer's own context menu
  // (HKCU only).
  ipcMain.handle(CALL.shellVerbStatus, () => shellVerbSetting.status())
  ipcMain.handle(CALL.shellVerbSet, (_e, on: unknown): Promise<boolean> | false =>
    typeof on === 'boolean' ? shellVerbSetting.set(on) : false
  )

  /* ----- context-menu verbs ----- */

  ipcMain.on(CALL.fileShowInExplorer, (_e, p: string) => {
    if (insideDesktop(p)) shell.showItemInFolder(p)
  })
  ipcMain.on(CALL.fileOpenDefault, (_e, p: string) => {
    if (insideDesktop(p)) void shell.openPath(p)
  })
  // The Windows "how do you want to open this?" chooser, which also reaches
  // the store apps the submenu can't launch.
  ipcMain.on(CALL.fileOpenChooser, (_e, p: string) => {
    if (!insideDesktop(p)) return
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p], {
      detached: true,
      stdio: 'ignore'
    }).unref()
  })

  // What the "Open in" submenu lists. The candidates main enumerated are the
  // only executables the launch handler below will ever run. Entries expire:
  // Prism is resident, and a list cached forever would never learn about a
  // newly installed app (or unlearn a transient reg.exe failure).
  const OPEN_WITH_TTL = 30_000
  const openWithCache = new Map<string, { list: AppCandidate[]; at: number }>()
  const cachedApps = (ext: string): AppCandidate[] | null => {
    const hit = openWithCache.get(ext)
    return hit && Date.now() - hit.at < OPEN_WITH_TTL ? hit.list : null
  }
  ipcMain.handle(CALL.appsFor, async (_e, p: string): Promise<OpenWithApp[]> => {
    if (!insideDesktop(p)) return []
    const ext = extname(p).toLowerCase()
    if (!ext) return []
    let list = cachedApps(ext)
    if (!list) {
      list = await appsForExt(ext)
      openWithCache.set(ext, { list, at: Date.now() })
    }
    return Promise.all(
      list.map(async (c) => ({
        id: c.exe,
        name: c.name,
        icon: await app
          .getFileIcon(c.exe, { size: 'small' })
          .then((i) => i.toDataURL())
          .catch(() => undefined)
      }))
    )
  })
  ipcMain.handle(CALL.fileOpenWith, (_e, p: string, exe: string): boolean => {
    if (!insideDesktop(p)) return false
    // The expired list still answers a launch: the menu the user is clicking
    // was built from it moments ago.
    const c = openWithCache.get(extname(p).toLowerCase())?.list.find((x) => x.exe === exe)
    if (!c) return false
    try {
      spawn(c.exe, argsFor(c.args, p), { detached: true, stdio: 'ignore' }).unref()
      return true
    } catch {
      return false
    }
  })

  // The real file onto the clipboard (a drop list, so Ctrl+V in Explorer
  // pastes it). Electron's clipboard has no CF_HDROP; PowerShell does.
  // One path or a multi-selection's worth: every one must pass the wall
  // (roots, or an individually granted extracted member) or nothing copies.
  ipcMain.handle(CALL.fileCopyClip, (_e, p: string | string[], cut = false): Promise<boolean> => {
    const list = Array.isArray(p) ? p : [p]
    if (!list.length || list.some((x) => !readable(x))) return Promise.resolve(false)
    return copyWindowsFiles(list, cut === true)
  })

  // The address bar's "Copy address" (2026-09-22): the folder as a file
  // drop AND its path as text, Explorer's own pair. Walled like the copy
  // above; the folder is the only thing put on the clipboard.
  ipcMain.handle(CALL.fileCopyAddress, (_e, p: string): Promise<boolean> => {
    if (typeof p !== 'string' || !insideDesktop(p)) return Promise.resolve(false)
    return copyWindowsFiles([p], false, p)
  })

  /**
   * Paste whatever is on the clipboard into a folder.
   *
   * The SOURCES may be anywhere - that is the point, you copied them in
   * Explorer - but the DESTINATION has to be inside a root, which is the
   * wall doing its job. Names never collide: `uniqueName` picks "name (2)"
   * the way Duplicate does, so a paste can add to a folder but never write
   * over what is in it.
   */
  /** Are there files on the clipboard? Asked when a menu OPENS, so a Paste
   *  row that would do nothing is never drawn (2026-09-02). Electron's own
   *  format list, not PowerShell: a presence check needs no paths, and a
   *  process per right-click made the row late (2026-10-16). */
  ipcMain.handle(CALL.clipboardHasFiles, () => hasWindowsFiles(() => clipboard.availableFormats()))

  /** Every file under a path, with sizes, for the progress arithmetic. */
  async function walkSizes(p: string): Promise<number> {
    const fs = await import('fs/promises')
    const st = await fs.stat(p)
    if (!st.isDirectory()) return st.size
    let total = 0
    for (const e of await fs.readdir(p, { withFileTypes: true })) {
      try {
        total += await walkSizes(join(p, e.name))
      } catch {
        /* unreadable entries copy as failures later; the bar only guides */
      }
    }
    return total
  }

  /**
   * Paste, with PROGRESS and an answer that names what landed (2026-09-03).
   * Windows copy/cut metadata is authoritative, including when another app
   * copies the same paths that Prism previously marked as cut. Older file
   * clipboards without this format retain the matching renderer mark fallback.
   */
  ipcMain.handle(CALL.filePasteInto, async (_e, destDir: string, cut?: string[], jobId?: string): Promise<PasteResult> => {
    if (typeof destDir !== 'string' || !insideDesktop(destDir)) {
      return { pasted: 0, failed: 0, refused: true, paths: [] }
    }
    const clipboard = await readWindowsFiles()
    const src = clipboard.paths
    if (!src.length) return { pasted: 0, failed: 0, empty: true, paths: [] }
    const moving =
      clipboard.cut ??
      (Array.isArray(cut) &&
        cut.length === src.length &&
        cut.every((c) => src.some((f) => samePath(f, String(c)))))
    ownWrite(join(destDir, 'x'))
    const fs = await import('fs/promises')
    const total = moving
      ? 0 // a rename is instant; only the cross-volume fallback counts bytes
      : await Promise.all(src.map((f) => walkSizes(f).catch(() => 0))).then((a) =>
          a.reduce((x, y) => x + y, 0)
        )
    let done = 0
    let lastSent = 0
    const tick = (bytes: number, of = total): void => {
      done += bytes
      const now = Date.now()
      if (of > 0 && now - lastSent > 120) {
        lastSent = now
        sendToPage(PUSH.pasteProgress, {
          jobId: typeof jobId === 'string' ? jobId : '',
          pct: Math.min(100, (done / of) * 100)
        })
      }
    }
    let pasted = 0
    let failed = 0
    const paths: string[] = []
    for (const s of src) {
      // A folder pasted into itself or below itself is skipped and counted
      // as failed (2026-10-16): it used to copy its own copy until the path
      // ran out, and a cut fell through to the same copy (pasteCopy.ts).
      if (pastesIntoItself(s, destDir)) {
        failed += 1
        continue
      }
      try {
        const target = join(destDir, await uniqueNameAsync(destDir, basename(s)))
        if (moving) {
          try {
            await fs.rename(s, target)
          } catch {
            // EXDEV or a lock: counted copy, then the source goes.
            const size = await walkSizes(s).catch(() => 0)
            let moved = 0
            await copyCounted(s, target, (b) => {
              moved += b
              tick(b, size)
            })
            void moved
            await fs.rm(s, { recursive: true })
          }
          // A cut carries the text shape like a drag-move does (2026-10-16).
          moveShapes(textShape, s, target)
        } else {
          await copyCounted(s, target, tick)
        }
        paths.push(target)
        pasted += 1
      } catch {
        failed += 1
      }
    }
    await written(destDir, ...(moving ? src : []))
    return { pasted, failed, paths, moved: moving }
  })

  // The icon Windows itself shows for a file of this type - the user's own
  // association (WinRAR, 7-Zip, Explorer's zip folder...). One fetch per
  // extension; the tree shows it for archives (#68, revised 2026-08-22).
  const extIconCache = new Map<string, string | null>()
  ipcMain.handle(CALL.iconForExt, async (_e, p: string): Promise<string | null> => {
    if (typeof p !== 'string' || !insideDesktop(p)) return null
    const ext = extname(p).toLowerCase()
    if (!ext) return null
    const hit = extIconCache.get(ext)
    if (hit !== undefined) return hit
    try {
      const img = await app.getFileIcon(p, { size: 'normal' })
      const url = img.isEmpty() ? null : img.toDataURL()
      extIconCache.set(ext, url)
      return url
    } catch {
      extIconCache.set(ext, null)
      return null
    }
  })

  // Undo's half of a delete: ask the shell for the items back. MoveHere
  // rather than InvokeVerb, because the Restore verb's NAME is localised
  // and the namespace move is not. Best effort: an item the user has since
  // emptied simply is not there any more.
  ipcMain.handle(CALL.fileRestore, async (_e, paths: string[]): Promise<boolean> => {
    ownWrite(...(Array.isArray(paths) ? paths : []))
    if (!Array.isArray(paths) || !paths.length || !paths.every((p) => insideDesktop(p)))
      return Promise.resolve(false)
    const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
    const script = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$missing = $false',
      '$sh = New-Object -ComObject Shell.Application',
      '$bin = $sh.Namespace(0xA)',
      `foreach ($p in @(${list})) {`,
      '  $dir = Split-Path $p -Parent; $name = Split-Path $p -Leaf',
      '  $item = @($bin.Items() | Where-Object {',
      '    $_.Name -eq $name -and $_.ExtendedProperty("System.Recycle.DeletedFrom") -eq $dir',
      '  })[-1]',
      '  if ($item) { $sh.Namespace($dir).MoveHere($item) } else { $missing = $true }',
      '}',
      // Nothing came back: say so, or undo would claim a restore that never
      // happened (an emptied Recycle Bin is the common case).
      'if ($missing) { exit 1 }'
    ].join('; ')
    return new Promise<boolean>((done) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-Command', script],
        { windowsHide: true, timeout: 20000 },
        (err) => done(!err)
      )
    }).finally(() => written(...paths))
  })
}

/** Drag and drop: move, add to a zip, move members. */
export function registerMoveIpc(ctx: MainCtx, ready: ReadyCtx): void {
  const { archiveOk, movable, ownWrite, textShape, written } = ctx
  const { positions } = ready
  /* ----- drag and drop (#70): move, add to a zip, extract out of one ----- */

  // Every path, source and destination alike, must sit inside an open root:
  // dragging is not a way out of the wall. Extracted archive members are
  // granted individually, so a member dragged to a folder can be written.
  // A folder that is ITSELF a tab's root cannot be moved or zipped away:
  // the wall would be left pointing at nothing and that tab dies. Renaming
  // and binning a root are already refused; this is the same rule.
  // The guard is the wall's `movable` (pathWall.ts).
  ipcMain.handle(
    CALL.fileMove,
    async (
      _e,
      paths: string[],
      destDir: string,
      onClash: MoveOnClash
    ): Promise<MoveResult> => {
      // Both ends: a move empties one folder and fills another.
      ownWrite(destDir + sep + 'x', ...(Array.isArray(paths) ? paths : []))
      /**
       * A drop that asks for nothing does nothing, SILENTLY (2026-08-31).
       *
       * Picking a folder up and putting it back down where it was is how
       * anybody changes their mind mid-drag, and it was answering with "a
       * tab's own folder cannot be moved" - the wall talking about a move
       * nobody requested. Filtered out BEFORE the wall check, so the
       * gesture is a no-op rather than a refusal.
       */
      const wanted = (Array.isArray(paths) ? paths : []).filter(
        (p) =>
          typeof p === 'string' &&
          !insideSelf(p, destDir) &&
          resolve(dirname(p)).toLowerCase() !== resolve(destDir).toLowerCase()
      )
      if (!wanted.length) return { moved: [], clashes: [], failed: [], replaced: [], busy: [] }
      if (!wanted.every(movable) || !insideDesktop(destDir))
        // `refused` is the wall talking, which is a different sentence from
        // "that file is locked": the renderer branches on it.
        return {
          moved: [],
          clashes: [],
          failed: wanted,
          replaced: [],
          busy: [],
          refused: true
        }
      // Prism's own decoders on these files go first (#127): the audio
      // sidecar, the waveform, a conversion. MEASURED: two sidecar ffmpegs
      // outlived the player and held the film past every retry.
      await holders.release(wanted)
      const r = await moveEntries(wanted, destDir, onClash === 'ask' ? 'ask' : onClash, (t) =>
        shell.trashItem(t)
      ).finally(() => written(destDir, ...wanted))
      // Each file's memory follows it (#124), its text shape too (2026-10-16).
      for (const m of r.moved) {
        void positions.rename(m.from, m.to)
        moveShapes(textShape, m.from, m.to)
      }
      return r
    }
  )
  ipcMain.handle(
    CALL.archiveAdd,
    async (
      _e,
      zip: string,
      srcPaths: string[],
      destFolder: string,
      keepBoth?: boolean
    ): Promise<ArchiveAddResult> => {
      if (!archiveOk(zip) || !Array.isArray(srcPaths) || !srcPaths.every(movable)) return 'failed'
      if (archiveTooLarge((await stat(zip)).size)) return 'failed'
      // A worker that died mid-job answers like any other failure.
      return addToArchive(
        zip,
        srcPaths,
        typeof destFolder === 'string' ? destFolder : '',
        !!keepBoth
      ).catch(() => 'failed' as const)
    }
  )
  ipcMain.handle(
    CALL.archiveMoveMembers,
    async (_e, zip: string, entries: string[], destFolder: string): Promise<ArchiveMoveResult> => {
      if (!archiveOk(zip) || !Array.isArray(entries)) return 'failed'
      if (archiveTooLarge((await stat(zip)).size)) return 'failed'
      return moveMembers(zip, entries, typeof destFolder === 'string' ? destFolder : '').catch(
        () => 'failed' as const
      )
    }
  )
}

/** Duplicate, New folder, and undoing a new folder. */
export function registerNewFilesIpc(ctx: MainCtx): void {
  const { editable, ownWrite, written } = ctx
  ipcMain.handle(CALL.fileDuplicate, async (_e, p: string): Promise<string | null> => {
    ownWrite(p)
    if (!insideDesktop(p)) return null
    try {
      if (!(await stat(p)).isFile()) return null // folders are a different feature
      const dir = dirname(p)
      // basename, not a slice: dirname keeps its trailing separator at a
      // drive root, and slicing past it ate the name's first character.
      const copy = join(dir, await uniqueNameAsync(dir, basename(p)))
      await copyFile(p, copy)
      await written(copy)
      return copy
    } catch {
      return null
    }
  })
  // NEW FOLDER (#330; owner, 2026-10-07: Ctrl+Shift+N in the Explorer and
  // the tree, the explicit yes to "new folder is a fresh decision"). The
  // page names a folder; main checks it is one this window may write in, on
  // disk and not inside an archive, and picks the name itself ("New folder",
  // "New folder (2)"...). `name` is only a redo's: the name the undone
  // folder had, put through the same validation as any rename.
  ipcMain.handle(
    CALL.fileNewFolder,
    async (_e, dir: string, name?: string): Promise<string | null> => {
      if (typeof dir !== 'string' || !dir || (name !== undefined && typeof name !== 'string'))
        return null
      if ((await container(dir)) || !insideDesktop(dir)) return null
      ownWrite(join(dir, 'New folder'))
      const made = await makeFolder(dir, name)
      await written(made ?? dir)
      return made
    }
  )
  // Undoing it: the Recycle Bin, and only while the folder is still empty.
  ipcMain.handle(
    CALL.fileBinIfEmpty,
    async (_e, p: string): Promise<BinIfEmptyResult> => {
      if (typeof p !== 'string' || (await container(p)) || !editable(p)) return 'failed'
      ownWrite(p)
      try {
        return await binIfEmpty(p, (t) => shell.trashItem(t))
      } finally {
        await written(p)
      }
    }
  )
}
