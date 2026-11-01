import { app, clipboard, shell, ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import type {
  ArchiveAddResult,
  ArchiveMoveResult,
  BinIfEmptyResult,
  MoveOnClash,
  MoveResult,
  PasteResult,
  SaveCopiesResult,
  SaveCopyResult
} from '@shared/ipcTypes'
import { isCopyFormat } from '@shared/imageCopy'
import { basename, dirname, extname, join, resolve } from 'path'
import { copyFile, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { execFile, launch } from '../spawnWorker'
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
import { addToArchive, archiveTooLarge, moveMembers, moveNames } from '../archive'
import { insideSelf, moveEntries } from '../moveOps'
import { copyCounted, movePct, pastesIntoItself, pctOf, predictNames, walkSizes } from '../pasteCopy'
import { fileKind, isMarkdown } from '@shared/fileKind'
import { samePath } from '@shared/path'
import type { OnClash, OpenWithApp, RenameResult, TextRead, WriteResult } from '@shared/types'
import { exists } from '../fsUtil'
import { windows } from '../appState'
import { saveCopyDialog } from '../dialogs'
import { saveImageCopy } from '../saveCopy'
import { saveCopies } from '../batchCopies'
import { cancelCopies, convertForCopy, copiesTemp, dropTemp, endCopies, placeCopy, startCopies, transcodePng } from '../copyJobs'
import { ffmpegTools } from '../bundledTools'
import type { MainCtx, ReadyCtx } from './context'

/** Whose tail it is: the page's webContents id (fileTail's `owner`). */
export const tailOwner = (sender: { id: number }): string => `page-${sender.id}`

/** At most one paste progress message this often, ms. */
const PASTE_TICK_MS = 120

export function registerSaveCopyIpc(ctx: MainCtx): void {
  const { editable, written } = ctx
  /**
   * Save the picture as an ordinary PNG or JPEG, somewhere the user picks.
   *
   * The destination is OUTSIDE every root on purpose, and that is not a hole
   * in the wall: main's own save dialog IS the consent, exactly as it is for
   * "Extract all" and for picking a subtitle file. The renderer hands over
   * bytes it encoded from the decoded picture; main never re-reads the
   * source, so a HEIC or a camera RAW saves as easily as a PNG. The source
   * path only says where the dialog opens and what it may not overwrite
   * (#78, `saveCopy.ts`).
   */
  ipcMain.handle(
    CALL.imageSaveCopy,
    (e, bytes: ArrayBuffer, suggested: string, format: unknown, source?: string): Promise<SaveCopyResult> =>
      saveImageCopy(
        { bytes, suggested, format: isCopyFormat(format) ? format : 'png', source },
        {
          ask: (opts) => saveCopyDialog(opts, e.sender),
          write: (p, b) => writeFile(p, b),
          transcode: (png, f) => transcodePng(ffmpegTools(), png, f),
          written,
          temp: tmpdir()
        }
      )
  )

  /**
   * SAVE COPIES AS (#474): the Explorer's selection, each picture next to
   * its original. No dialog, so the copies stay INSIDE the wall: every
   * source must be `editable` (a granted folder), which is where its copy
   * lands. Progress rides the paste channel to the chip (`jobId`), one
   * message per picture; `imageSaveCopiesCancel` stops it.
   */
  ipcMain.handle(
    CALL.imageSaveCopies,
    async (e, paths: unknown, format: unknown, jobId: unknown): Promise<SaveCopiesResult> => {
      const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && !!p) : []
      if (!isCopyFormat(format)) return { saved: [], failed: 0, skipped: list.length, canceled: false }
      const job = typeof jobId === 'string' ? jobId : ''
      const stop = startCopies(job)
      const tools = ffmpegTools()
      const tmp = await copiesTemp().catch(() => null)
      try {
        return await saveCopies(
          { paths: list, format },
          {
            allowed: (p) => editable(p),
            entry: (p) => stat(p).then((s) => (s.isFile() ? 'file' : 'other'), () => null),
            convert: (src, out, f, signal) => (tmp ? convertForCopy(tools, src, out, f, signal) : Promise.resolve(false)),
            exists,
            place: placeCopy,
            written: (p) => written(p),
            discard: (p) => rm(p, { force: true }),
            progress: (done, total) =>
              void windows.sendTo(e.sender, PUSH.pasteProgress, { jobId: job, pct: total ? Math.round((done / total) * 100) : 100 }),
            tmp: tmp ?? tmpdir(),
            signal: stop.signal
          }
        )
      } finally {
        endCopies(job)
        if (tmp) await dropTemp(tmp)
      }
    }
  )
  ipcMain.handle(CALL.imageSaveCopiesCancel, (_e, jobId: unknown) => typeof jobId === 'string' && cancelCopies(jobId))
}

/** Rename, bin, read and save text, follow a growing file. */
export function registerFilesIpc(ctx: MainCtx, ready: ReadyCtx): void {
  const { TEXT_MAX_BYTES, editable, readable, textShape, wall, written } = ctx
  const { positions, readTextWalled } = ready
  // File operations. Inside the root only, and nothing is ever destroyed: an
  // overwritten or deleted file goes to the Recycle Bin.
  // The root itself is off limits: renaming or binning the folder the tree is
  // rooted in would pull the ground out from under the window.
  // The guard is the wall's `editable` (pathWall.ts).
  ipcMain.handle(
    CALL.fileRename,
    async (_e, p: string, name: string, onClash: OnClash): Promise<RenameResult> => {
      if (!editable(p))
        return { ok: false, reason: 'failed', message: 'Prism cannot rename that here.' }
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
  // One tail per path PER WINDOW (2026-10-29), its chunks to that window
  // only; a window's close stops its own (index.ts, `stopTailsOf`).
  ipcMain.handle(CALL.tailStart, async (event, p: string, from: number) => {
    if (!readable(p)) return false
    const sender = event.sender
    return startTail(p, Number(from) || 0, (e) => windows.sendTo(sender, PUSH.fileAppended, e), tailOwner(sender))
  })
  ipcMain.handle(CALL.tailStop, (event, p: string) => {
    if (typeof p === 'string') stopTail(p, tailOwner(event.sender))
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
  const { movable, readable, shellVerbSetting, textShape, written } = ctx
  // "Open file" / "Open in Prism" in File Explorer's own context menu
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
    void launch('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', p]).catch(() => {})
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
  ipcMain.handle(CALL.fileOpenWith, async (_e, p: string, exe: string): Promise<boolean> => {
    if (!insideDesktop(p)) return false
    // The expired list still answers a launch: the menu the user is clicking
    // was built from it moments ago.
    const c = openWithCache.get(extname(p).toLowerCase())?.list.find((x) => x.exe === exe)
    if (!c) return false
    try {
      await launch(c.exe, argsFor(c.args, p))
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


  /**
   * Paste, with PROGRESS and an answer that names what landed (2026-09-03).
   * Windows copy/cut metadata is authoritative, including when another app
   * copies the same paths that Prism previously marked as cut. Older file
   * clipboards without this format retain the matching renderer mark fallback.
   */
  ipcMain.handle(CALL.filePasteInto, async (e, destDir: string, cut?: string[], jobId?: string): Promise<PasteResult> => {
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
    return runPaste(e.sender, destDir, src, moving, jobId)
  })

  /**
   * FILES DROPPED FROM WINDOWS ARE COPIED IN (#103, D3; owner, 2026-10-31).
   * A drop from Explorer, the desktop or another app onto a Prism folder used
   * to MOVE them, though the payload said "never moved, only copied in". It is
   * the paste engine on the dropped paths: the rows land with their bars,
   * names never collide, a folder never lands inside itself. Both ends are
   * walled: the drop browses each source's folder first (`onBrowseDropInto`),
   * so a source is inside the wall, and one that is not is refused (a page
   * could otherwise copy any file on disk into a granted folder and read it).
   */
  ipcMain.handle(CALL.fileCopyInto, async (e, destDir: string, paths: unknown, jobId?: string): Promise<PasteResult> => {
    if (typeof destDir !== 'string' || !insideDesktop(destDir)) {
      return { pasted: 0, failed: 0, refused: true, paths: [] }
    }
    const src = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && !!p) : []
    if (!src.length) return { pasted: 0, failed: 0, empty: true, paths: [] }
    if (!src.every(movable)) return { pasted: 0, failed: 0, refused: true, paths: [] }
    return runPaste(e.sender, destDir, src, false, jobId)
  })

  /** The paste engine: copy (or, for a cut, move) `src` into `destDir`. */
  const runPaste = async (
    sender: Electron.WebContents,
    destDir: string,
    src: string[],
    moving: boolean,
    jobId?: string
  ): Promise<PasteResult> => {
    // The progress goes to the window that pasted (2026-10-29), and to
    // nobody once it has closed.
    const sendToPage = (channel: typeof PUSH.pasteProgress, payload: unknown): void =>
      void windows.sendTo(sender, channel, payload)
    const fs = await import('fs/promises')
    const job = typeof jobId === 'string' ? jobId : ''
    // THE LIST SHOWS WHAT IS LANDING (owner, 2026-10-28: "nothing happens and
    // suddenly items just appear"): a copy names each item and the path it
    // is expected at, so the list can draw it as a row with its own bar.
    // The names are picked in order, each apart from the ones before it, and
    // the copy writes to exactly that name (review, 2026-10-28: two sources
    // called readme.md both predicted readme.md, one row hid the other).
    let current = -1
    let itemDone = 0
    const predicted = moving
      ? []
      : await predictNames(
          src.map((s) => basename(s)),
          (name, taken) => uniqueNameAsync(destDir, name, taken)
        )
    const reserved = new Set(predicted.map((n) => n.toLowerCase()))
    if (!moving) {
      const items = await Promise.all(
        src.map(async (s, i) => {
          const isFolder = await stat(s).then((st) => st.isDirectory(), () => false)
          return { path: join(destDir, predicted[i]), name: predicted[i], isFolder }
        })
      )
      sendToPage(PUSH.pasteProgress, { jobId: job, pct: 0, start: { dir: destDir, items } })
    }
    // Sized AFTER the rows are said (review, 2026-10-28, finding 17): a big
    // folder's walk no longer holds the list empty. lstat, never following a
    // junction (pasteCopy.walkSizes). A move is a rename and sizes nothing.
    const sizes = moving
      ? src.map(() => 0) // only the cross-volume fallback counts bytes
      : await Promise.all(src.map((f) => walkSizes(f).catch(() => 0)))
    const total = sizes.reduce((x, y) => x + y, 0)
    let done = 0
    let lastSent = 0
    // A message at most every PASTE_TICK_MS, bytes and landings alike (review,
    // 2026-10-28: one per landed item, unthrottled, was a message, a store
    // update and a list pass per file of a 3,000-photo paste). Progress on an
    // item says every item before it is through, so a landing skipped here is
    // said by the next message (lib/jobs.ts updateLanding).
    const due = (): boolean => {
      const now = Date.now()
      if (now - lastSent <= PASTE_TICK_MS) return false
      lastSent = now
      return true
    }
    let unsaid = -1
    const tick = (bytes: number): void => {
      done += bytes
      itemDone += bytes
      if (total > 0 && due()) {
        unsaid = -1
        const size = sizes[current] ?? 0
        sendToPage(PUSH.pasteProgress, {
          jobId: job,
          pct: pctOf(done, total),
          ...(current >= 0 && size > 0 ? { item: current, itemPct: pctOf(itemDone, size) } : {})
        })
      }
    }
    const sayLanded = (i: number): void =>
      sendToPage(PUSH.pasteProgress, {
        jobId: job,
        pct: total > 0 ? pctOf(done, total) : 100,
        item: i,
        itemPct: 100
      })
    const landed = (i: number): void => {
      if (moving) return
      if (due()) {
        unsaid = -1
        sayLanded(i)
      } else unsaid = i
    }
    let pasted = 0
    let failed = 0
    const paths: string[] = []
    const from: string[] = []
    for (const [i, s] of src.entries()) {
      current = i
      itemDone = 0
      // A folder pasted into itself or below itself is skipped and counted
      // as failed (2026-10-16): it used to copy its own copy until the path
      // ran out, and a cut fell through to the same copy (pasteCopy.ts).
      if (pastesIntoItself(s, destDir)) {
        failed += 1
        continue
      }
      try {
        // The predicted name, unless something took it meanwhile (then the
        // next free one that no other item of this paste is to land under).
        const name =
          predicted[i] && !(await exists(join(destDir, predicted[i])))
            ? predicted[i]
            : await uniqueNameAsync(destDir, basename(s), reserved)
        const target = join(destDir, name)
        if (moving) {
          try {
            await fs.rename(s, target)
          } catch {
            // EXDEV or a lock: counted copy, then the source goes, its share
            // of the job counted in items (pasteCopy.ts movePct).
            const size = await walkSizes(s).catch(() => 0)
            let moved = 0
            await copyCounted(s, target, (b) => {
              moved += b
              if (size > 0 && due())
                sendToPage(PUSH.pasteProgress, { jobId: job, pct: movePct(i, src.length, moved, size) })
            })
            await fs.rm(s, { recursive: true })
          }
          // A cut carries the text shape like a drag-move does (2026-10-16).
          moveShapes(textShape, s, target)
        } else {
          await copyCounted(s, target, tick)
        }
        paths.push(target)
        from.push(s)
        pasted += 1
        landed(i)
      } catch {
        failed += 1
      }
    }
    if (unsaid >= 0) sayLanded(unsaid)
    await written(destDir, ...(moving ? src : []))
    return { pasted, failed, paths, from, moved: moving }
  }

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
  const { archiveOk, movable, textShape, written } = ctx
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
    async (
      _e,
      zip: string,
      entries: string[],
      destFolder: string,
      keepBoth?: boolean,
      names?: unknown
    ): Promise<ArchiveMoveResult> => {
      // A bad name refuses the move: never a move under other names.
      const named = moveNames(names, Array.isArray(entries) ? entries.length : 0)
      if (!archiveOk(zip) || !Array.isArray(entries) || named === null) return 'failed'
      if (archiveTooLarge((await stat(zip)).size)) return 'failed'
      return moveMembers(
        zip,
        entries,
        typeof destFolder === 'string' ? destFolder : '',
        keepBoth === true,
        named
      ).catch(() => 'failed' as const)
    }
  )
}

/** Duplicate, New folder, and undoing a new folder. */
export function registerNewFilesIpc(ctx: MainCtx): void {
  const { editable, written } = ctx
  ipcMain.handle(CALL.fileDuplicate, async (_e, p: string): Promise<string | null> => {
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
      try {
        return await binIfEmpty(p, (t) => shell.trashItem(t))
      } finally {
        await written(p)
      }
    }
  )
}
