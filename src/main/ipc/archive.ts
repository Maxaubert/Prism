import { app, ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import { basename, dirname, extname, join } from 'path'
import { mkdir, mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { insideDesktop } from '../desktopAccess'
import { container } from '../archiveBrowse'
import type {
  ArchiveRenameResult,
  ExtractAllResult,
  ExtractDirResult,
  ExtractFail,
  ExtractFailure,
  ExtractToResult,
  MemberExtractResult
} from '@shared/extraction'
import { holders } from '../holders'
import { userPaths } from '../paths'
import { mainCrumb } from '../diagCrumb'
import {
  extractAllSeven,
  extractSeven,
  extractSevenSubtree,
  extractSevenTo,
  isSevenArchive,
  listSeven
} from '../sevenZip'
import { ExtractJobs, Made, pruneEmpty, type ExtractJob } from '../extractJob'
import { openComic, type ComicOpen } from '../comic'
import { uniqueNameAsync } from '../fileOps'
import {
  archiveStat,
  archiveTooLarge,
  deleteMember,
  extractMember,
  extractTo,
  listArchive,
  renameMember,
  type ArchiveStat
} from '../archive'
import { fileKind } from '@shared/fileKind'
import type { ArchiveListing } from '@shared/types'
import { exists } from '../fsUtil'
import { appState } from '../appState'
import { sevenExe } from '../bundledTools'
import { openDialog } from '../dialogs'
import type { MainCtx } from './context'

/** The archive bodies the phone's routes share with these handlers (#106):
 *  no wall in them; each side checks its own. */
export interface ArchiveBodies {
  openComicWalled: (
    p: string,
    password: string
  ) => Promise<ComicOpen | { error: 'password' | 'failed' | 'empty' }>
  listArchiveWalled: (p: string, password?: string) => Promise<ArchiveListing>
  extractMemberWalled: (p: string, entry: string, password?: string) => Promise<MemberExtractResult>
}

/** Extraction jobs, the archive verbs and comics. Answers the bodies the
 *  phone shares (`ArchiveBodies`). */
export function registerArchiveIpc(ctx: MainCtx): ArchiveBodies {
  const { archiveOk, archivePasswords, archiveReadOk, archives, comicOk, memberTemp, wall } = ctx
  /**
   * THE ONE EXTRACTION WINDOW (2026-09-19, #166).
   *
   * Owner: "When you extract something, the progress bar works differently
   * based on like how you extracted ... I would like it to just be one kind
   * of view that appears, and I want it to be a pop-up window that you
   * can't close, kind of like it is with WinRAR." Asked the same day: it
   * gets a Cancel button, which stops the extraction and cleans up what was
   * half written.
   *
   * Every route below that writes extracted files to a folder the user can
   * see opens a JOB, and the job is what talks to the window: one channel,
   * whatever the engine and whatever the landing rule. The routes that
   * extract to temp so a member can be VIEWED or put on the clipboard open
   * none and stay silent, as they always were.
   */
  // When each job began, for its end's `ms` in the diagnostics log.
  const jobStarted = new Map<string, number>()
  const extractJobs = new ExtractJobs((e) => {
    // THE ARCHIVE JOB ON THE TIMELINE (#322): its start and its end, from
    // the one channel every extraction talks to the window through.
    if (e.type === 'start') {
      jobStarted.set(e.id, performance.now())
      mainCrumb('archive-job', { phase: 'start', id: e.id, archive: e.archive, dest: e.dest })
    } else if (e.type === 'end') {
      const t0 = jobStarted.get(e.id)
      jobStarted.delete(e.id)
      mainCrumb('archive-job', {
        phase: 'end',
        id: e.id,
        result: e.result,
        ...(e.reason ? { reason: e.reason } : {}),
        ...(t0 !== undefined ? { ms: Math.round(performance.now() - t0) } : {})
      })
    }
    if (appState.mainWindow && !appState.mainWindow.isDestroyed())
      appState.mainWindow.webContents.send(PUSH.extractEvent, e)
  })
  ipcMain.handle(CALL.extractCancel, (_e, id: string) =>
    typeof id === 'string' ? extractJobs.cancel(id) : false
  )
  // No orphaned 7-Zip left writing into somebody's folder after the app
  // has gone.
  app.on('will-quit', () => extractJobs.killAll())
  /** The second job while one is up. The modal makes it unreachable from
   *  the UI; refused here too, so the rule is not the renderer's to keep. */
  const BUSY = { ok: false as const, reason: 'busy' as const }
  /**
   * A request main will not even start (the wall, a path that is not an
   * archive) is still a failure SOMEBODY has to show, and since #166 the
   * callers show none of their own: the window is where an extraction's
   * error lives. So a refusal opens the window straight into its error,
   * and the five routes keep one way of saying no.
   */
  const refused = (zip: unknown, dest: unknown): { ok: false; reason: 'failed' } => {
    extractJobs
      .begin({
        archive: typeof zip === 'string' ? basename(zip) : 'archive',
        dest: typeof dest === 'string' ? dest : ''
      })
      ?.end('failed', 'failed')
    return { ok: false, reason: 'failed' }
  }
  /** What the engines hand a job: its progress, its child, its question. */
  const watching = (
    job: ExtractJob
  ): {
    onProgress: (pct: number | null, file: string | null) => void
    onChild: (child: import('child_process').ChildProcess) => void
    cancelled: () => boolean
  } => ({
    onProgress: (pct, file) => job.progress(pct, file),
    onChild: (child) => job.attach(child),
    cancelled: () => job.cancelled
  })

  /** Members out to `destDir`, as a job. Both engines take back what they
   *  made when cancelled, so there is nothing left for this to remove. */
  async function membersOut(
    zip: string,
    entries: string[],
    destDir: string,
    pw: string,
    asksPassword: boolean
  ): Promise<ExtractToResult> {
    const job = extractJobs.begin({ archive: basename(zip), dest: destDir, asksPassword })
    if (!job) return BUSY
    try {
      // A .7z/.rar/.iso is not a zip: adm-zip cannot read one, so dragging a
      // member out of one always failed (2026-08-28).
      const exe = await seven(zip)
      const out = exe
        ? await extractSevenTo(exe, zip, entries, destDir, pw, watching(job))
        : await extractTo(zip, entries, destDir, pw || undefined, watching(job))
      if (out.ok) job.end('done')
      else if (out.reason === 'cancelled') job.end('cancelled')
      else
        job.end(
          'failed',
          out.reason,
          // 7-Zip's own line; the in-process engine has none to give.
          'message' in out && typeof out.message === 'string' ? out.message : undefined
        )
      return out
    } catch {
      job.end('failed', 'failed')
      return { ok: false, reason: 'failed' }
    }
  }

  ipcMain.handle(
    CALL.archiveExtractTo,
    (
      _e,
      zip: string,
      entries: string[],
      destDir: string,
      password?: string,
      asksPassword?: boolean
    ) => {
      // The READ gate for the source (#300): a nested archive is a temp copy
      // main made, and extracting out of it reads it; the destination is
      // still a folder the tab may write to.
      if (!archiveReadOk(zip) || !Array.isArray(entries) || !insideDesktop(destDir))
        return refused(zip, destDir)
      const pw = typeof password === 'string' ? password : ''
      return membersOut(zip, entries, destDir, pw, !!asksPassword)
    }
  )

  /**
   * Members OUT to a folder the user PICKS (2026-09-03, owner: "Extract
   * to..." on a member row). Main's dialog is the consent, exactly as
   * extract-all's is, which is why the destination is not bound by the
   * root wall; everything else is the extract-to above. The job opens
   * AFTER the dialog is answered: the window is for the work, not for the
   * question.
   */
  ipcMain.handle(
    CALL.archiveExtractMembersPicked,
    async (_e, zip: string, entries: string[], password?: string) => {
      if (!archiveReadOk(zip) || !Array.isArray(entries)) return refused(zip, '')
      const r = await openDialog({ properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'cancelled' }
      const destDir = r.filePaths[0]
      const pw = typeof password === 'string' ? password : ''
      // The archive panel is the only caller, and it asks for a password
      // and tries again.
      const out = await membersOut(zip, entries, destDir, pw, true)
      return out.ok ? { ok: true, dest: destDir, written: out.written } : out
    }
  )

  /**
   * A MEMBER out beside the outermost archive, as a job with the window
   * (#300): the read-only note's Extract here. Answers the extracted copy,
   * so it can be opened where editing can start.
   */
  ipcMain.handle(CALL.archiveMemberOut, async (_e, path: string) => {
    const outer = typeof path === 'string' ? await container(path) : null
    if (!outer || !insideDesktop(outer)) return { ok: false }
    const r = await archives.resolve(path, { enterLast: false })
    if (!r?.ok || !r.place.entry || r.place.entry.dir) return { ok: false }
    const dest = dirname(r.place.outer)
    const name = r.place.entry.name || basename(r.place.entry.path)
    const landing = join(
      dest,
      (await exists(join(dest, name))) ? await uniqueNameAsync(dest, name) : name
    )
    const out = await membersOut(
      r.place.real,
      [r.place.entry.path],
      dest,
      archivePasswords.get(r.place.real) ?? '',
      false
    )
    return out.ok ? { ok: true, path: (await exists(landing)) ? landing : null } : { ok: false }
  })

  /* ----- the archive verbs (#68): zip only, through src/main/archive.ts ----- */

  // Every verb names the zip, which must sit inside a root and actually be
  // an archive; the members have no independent existence on disk. Renames
  // and deletes rewrite the container, so an oversized archive is refused
  // rather than frozen over. The guards are the wall's `archiveOk` (writes),
  // `archiveReadOk` (reads, also a nested archive main extracted) and
  // `comicOk` (pathWall.ts).

  /**
   * `comic:open`'s body, factored (#106) so the phone's `/api/comic` opens
   * a book the same way: unpacked once under the comics folder, the password
   * remembered when it worked. No wall in here; the IPC handler checks
   * `comicOk` and the phone route checks its own root and kind. The answer
   * keeps the DIRECTORY, which the phone server grants to the phone that
   * asked; the IPC drops it, since the media wall already allows
   * `comicsDir` as a whole.
   */
  const openComicWalled = async (
    p: string,
    password: string
  ): Promise<ComicOpen | { error: 'password' | 'failed' | 'empty' }> => {
    wall.setComicsDir(userPaths.comics())
    const pw = password || (archivePasswords.get(p) ?? '')
    const exe = sevenExe()
    if (!exe) return { error: 'failed' as const }
    const got = await openComic(exe, p, wall.comicsDir(), pw)
    if ('error' in got) return got
    if (pw) archivePasswords.set(p, pw)
    return got
  }
  ipcMain.handle(CALL.comicOpen, async (_e, p: string, password?: string) => {
    if (!comicOk(p)) return { error: 'failed' as const }
    const got = await openComicWalled(p, typeof password === 'string' ? password : '')
    if ('error' in got) return got
    // No per-page grant: the pages live under `comicsDir`, which the media
    // wall allows as a directory.
    return { pages: got.pages }
  })
  /**
   * Which archives go through the bundled 7-Zip rather than adm-zip.
   *
   * 7z, rar, tar, gz and friends always do: they are READ-ONLY, since 7-Zip
   * lists and extracts them all and Prism never writes with it. zip keeps
   * its own in-process path, and its verbs.
   *
   * A .zip that is TOO BIG for adm-zip goes through 7-Zip as well
   * (2026-08-31). adm-zip reads the whole container into memory, which is
   * why anything over the cap was refused - but the cap is adm-zip's limit,
   * not zip's, and 7-Zip streams. A 1.9GB zip used to list (by reading 1.9GB
   * into main) and then answer "failed" to every extract, which is the worst
   * of both. Now it lists cheaply and extracts fine, and simply has no write
   * verbs, exactly like a .7z. The size is an awaited stat (2026-10-12):
   * every archive verb asks this first, and main never waits on the disk.
   */
  const seven = async (p: string): Promise<string | null> => {
    const exe = (): string | null => sevenExe()
    if (isSevenArchive(extname(p))) return exe()
    try {
      return archiveTooLarge((await stat(p)).size) ? exe() : null
    } catch {
      return null // gone between the listing and now
    }
  }

  /**
   * Extract-all's landing folder, and the ONE-FOLDER RULE (2026-08-31).
   *
   * An archive whose whole content is a single top-level folder - which is
   * what every "download as zip" produces - used to land as
   * `chosen/archive-name/TheFolder`, one level deeper than anybody wanted.
   * So after a successful extract, a wrapper holding exactly one directory
   * hands that directory up to its parent and removes itself.
   *
   * Done by MOVING rather than by extracting straight into the destination,
   * because the rule that Prism never writes over an existing folder is
   * worth more than the one rmdir it costs: the move picks "name (2)" the
   * same way the wrapper itself does, and a same-volume rename is instant
   * whatever the folder weighs.
   */
  async function unwrapSingleFolder(wrapper: string, parent: string): Promise<string> {
    try {
      const fs = await import('fs/promises')
      const kids = await fs.readdir(wrapper, { withFileTypes: true })
      if (kids.length !== 1 || !kids[0].isDirectory()) return wrapper
      let out = join(parent, kids[0].name)
      for (let n = 2; (await exists(out)) && n < 100; n += 1)
        out = join(parent, `${kids[0].name} (${n})`)
      await fs.rename(join(wrapper, kids[0].name), out)
      await fs.rmdir(wrapper).catch(() => {})
      return out
    } catch {
      return wrapper
    }
  }

  /** Extract the whole archive into `into`, which must already exist. */
  async function extractWhole(
    p: string,
    into: string,
    job: ExtractJob
  ): Promise<{ ok: true } | { ok: false; reason: ExtractFail | 'cancelled'; message?: string }> {
    const pw = archivePasswords.get(p) ?? ''
    const exe = await seven(p)
    if (exe) {
      // 7-Zip's own percentage, forwarded to the window: a 2GB archive takes
      // minutes, and a window that says nothing for minutes is
      // indistinguishable from one that has hung.
      // How many entries there are, so the file-count fallback has
      // something to be a fraction OF. Folders included, because `-bb1`
      // logs a line for each of those as well. One extra 7z listing,
      // measured at 88ms on a 1.9GB archive - nothing against the minutes
      // that follow.
      const listed = await listSeven(exe, p, pw)
      const total = listed.ok ? listed.entries.length : 0
      const s7 = await extractAllSeven(exe, p, into, pw, { ...watching(job), total })
      // A killed 7-Zip and a failed one look the same from here.
      if (job.cancelled) return { ok: false, reason: 'cancelled' }
      return s7.ok ? { ok: true } : { ok: false, reason: s7.reason, message: s7.message }
    }
    // Every top-level entry: extractTo matches members by prefix, and the
    // roots of the tree are what covers all of them.
    const tops = (await listArchive(p)).filter((e) => !e.path.includes('/')).map((e) => e.path)
    const out = await extractTo(p, tops, into, pw || undefined, watching(job))
    return out.ok ? { ok: true } : { ok: false, reason: out.reason }
  }

  /** A folder to extract into, named after the archive, never overwriting. */
  async function landingDir(p: string, parent: string): Promise<string> {
    const stem = basename(p).replace(/\.[^.]+$/, '') || 'extracted'
    let dest = join(parent, stem)
    for (let n = 2; (await exists(dest)) && n < 100; n += 1) dest = join(parent, `${stem} (${n})`)
    return dest
  }

  ipcMain.handle(CALL.archiveStat, async (_e, p: string): Promise<ArchiveStat | null> => {
    if (!archiveOk(p)) return null
    const exe = await seven(p)
    if (!exe) return archiveStat(p).catch(() => null)
    const listed = await listSeven(exe, p, archivePasswords.get(p) ?? '')
    if (!listed.ok) return null
    const list = listed.entries
    return {
      files: list.filter((e) => !e.dir).length,
      folders: list.filter((e) => e.dir).length,
      uncompressed: list.reduce((n, e) => n + (e.dir ? 0 : e.size), 0),
      encryption: list.some((e) => e.encrypted) ? 'aes' : 'none',
      readOnly: true
    }
  })
  // Answers WHY it could not list (2026-08-30). A 7z or rar written with
  // encrypted file NAMES cannot be listed at all without the password, and
  // the old flat null reached the panel as "this archive looks corrupt": a
  // good archive read as broken, with nowhere to type what it was asking
  // for. A password that works is remembered here too, so the member verbs
  // and the drag-out do not ask again.
  /** `archive:list`'s body, factored (#106) for the phone's `/api/archive`.
   *  No wall in here: the IPC handler checks `archiveReadOk`, the phone
   *  route its own root and kind. */
  const listArchiveWalled = async (p: string, password?: string): Promise<ArchiveListing> => {
    try {
      const exe = await seven(p)
      if (!exe) {
        const entries = await listArchive(p)
        return entries ? { ok: true, entries } : { ok: false, reason: 'failed' }
      }
      const pw = password || (archivePasswords.get(p) ?? '')
      const listed = await listSeven(exe, p, pw)
      if (listed.ok && pw) archivePasswords.set(p, pw)
      return listed
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
  /**
   * A MEMBER of a place inside an archive, unpacked for a viewer (#300): the
   * run's member folder, one member, reused while the container is
   * unchanged. `force` is an explicit Open, past the automatic-preview limit.
   * The container must be one the Explorer or a project may read.
   */
  ipcMain.handle(CALL.archiveMember, async (_e, path: string, password?: string, force?: boolean) => {
    const outer = typeof path === 'string' ? await container(path) : null
    if (!outer || !insideDesktop(outer)) return { ok: false, reason: 'failed' }
    const out = await archives.member(
      path,
      typeof password === 'string' && password ? password : undefined,
      force === true
    )
    if (out.ok) {
      memberTemp.touch(out.path)
      // Over the run's cap, the least recently viewed go: never the one
      // just asked for, nor one a player or a converter holds.
      void memberTemp.evict((f) => f === out.path || holders.count([f]) > 0)
    }
    return out
  })
  /** What the archive card shows (#300): totals and the top of the tree. */
  ipcMain.handle(CALL.archiveSummary, async (_e, path: string) => {
    const outer = typeof path === 'string' ? await container(path) : null
    if (!outer || !insideDesktop(outer)) return { ok: false, reason: 'failed' }
    return archives.summary(path)
  })
  /** A password the user typed for a container a listing asked about
   *  (#300): remembered for the session, as every archive password is. */
  ipcMain.handle(CALL.archiveRememberPassword, (_e, container: string, password: string) => {
    if (typeof container !== 'string' || typeof password !== 'string' || !password) return false
    if (!insideDesktop(container) && !memberTemp.owns(container)) return false
    archivePasswords.set(container, password)
    archives.forget(container)
    return true
  })
  ipcMain.handle(
    CALL.archiveList,
    async (_e, p: string, password?: string): Promise<ArchiveListing> => {
      if (!archiveReadOk(p)) return { ok: false, reason: 'failed' }
      return listArchiveWalled(p, typeof password === 'string' ? password : undefined)
    }
  )
  /** `archive:extract`'s body, factored the same way (#106): one member to
   *  a temp file, which joins `extractedPaths` so the media wall serves it.
   *  The phone server adds its own per-phone grant on top. */
  const extractMemberWalled = async (
    p: string,
    entry: string,
    password?: string
  ): Promise<MemberExtractResult> => {
    try {
      const exe = await seven(p)
      // The cap is ADM-ZIP's - it reads the whole container into memory.
      // 7-Zip streams, so a 3GB .7z is fine and used to be refused here
      // by a check that ran before the branch (2026-08-28).
      if (!exe && archiveTooLarge((await stat(p)).size)) return { ok: false, reason: 'failed' }
      if (exe) {
        const pw = password ?? ''
        const s7 = await extractSeven(exe, p, entry, pw)
        if (!s7.ok) return s7
        if (pw) archivePasswords.set(p, pw)
        wall.grantExtracted(s7.path)
        return { ok: true, path: s7.path, kind: fileKind(extname(s7.path), basename(s7.path)) }
      }
      const r = await extractMember(p, entry, password)
      if (!r.ok) return r
      wall.grantExtracted(r.path)
      return { ok: true, path: r.path, kind: fileKind(extname(r.path), basename(r.path)) }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
  ipcMain.handle(
    CALL.archiveExtract,
    async (_e, p: string, entry: string, password?: string): Promise<MemberExtractResult> => {
      // The READ gate: extracting a member to view it is a read, and the
      // container may itself be a member Prism extracted a moment ago.
      if (!archiveReadOk(p) || typeof entry !== 'string') return { ok: false, reason: 'failed' }
      return extractMemberWalled(p, entry, typeof password === 'string' ? password : undefined)
    }
  )
  /**
   * Extract the WHOLE archive, Explorer-shaped: the user picks where, and
   * the contents land in a folder named after the archive so a zip full of
   * loose files never sprays them over the chosen folder.
   *
   * The destination is chosen in MAIN's own dialog, which is the consent -
   * that is why this one is not bound by the root wall, unlike
   * archive:extract-to, whose destination the renderer names.
   */
  ipcMain.handle(
    CALL.archiveExtractAll,
    async (
      _e,
      p: string,
      here?: boolean
    ): Promise<ExtractAllResult> => {
      if (!archiveOk(p)) return refused(p, '')
      let parent = dirname(p)
      if (!here) {
        // The dialog IS the consent: it is why the destination does not have
        // to be inside a root. "Extract here" needs none, because the
        // archive's own folder already is one.
        const r = await openDialog({
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: dirname(p),
          buttonLabel: 'Extract here'
        })
        if (r.canceled || !r.filePaths.length) return { ok: false, reason: 'cancelled' }
        parent = r.filePaths[0]
      }
      const dest = await landingDir(p, parent)
      // The landing folder is what a Cancel removes WHOLE, so it has to be
      // one this job made. `landingDir` gives up after "name (99)", and
      // extracting into a folder that was already there would make the
      // clean-up a delete of somebody's files.
      if (await exists(dest)) return refused(p, parent)
      // Opened AFTER the dialog: the window is for the work, not for the
      // question. It names the folder that was chosen, which is where the
      // result lands whether or not the one-folder rule unwraps it.
      const job = extractJobs.begin({ archive: basename(p), dest: parent })
      if (!job) return BUSY
      const made = new Made()
      try {
        await mkdir(dest, { recursive: true })
        made.tree(dest)
        const out = await extractWhole(p, dest, job)
        if (!out.ok) {
          if (out.reason === 'cancelled') {
            // 7-Zip has closed by now (its promise resolves on `close`), so
            // nothing is still holding what is about to be removed.
            await made.undo()
            job.end('cancelled')
            return out
          }
          // A FAILURE keeps what came out, as it always has: those files
          // are good. Only a landing folder with nothing in it goes, which
          // is what a wrong password used to leave behind.
          await pruneEmpty(dest)
          job.end('failed', out.reason, out.message)
          return out
        }
        const landed = await unwrapSingleFolder(dest, parent)
        job.end('done')
        return { ok: true, dest: landed }
      } catch {
        job.end('failed', 'failed')
        return { ok: false, reason: 'failed' }
      }
    }
  )

  /**
   * A FOLDER inside the archive, extracted whole to a temp copy.
   *
   * The panel's "Copy" on a folder used to extract its members one at a
   * time and put the loose FILES on the clipboard, so pasting gave you a
   * flat pile and never the folder you right-clicked. This hands back one
   * real directory with the shape intact, which is what gets copied.
   */
  ipcMain.handle(
    CALL.archiveExtractDir,
    async (
      _e,
      p: string,
      entry: string,
      here?: boolean
    ): Promise<ExtractDirResult> => {
      // A copy out of a nested archive reads a temp copy main made (#300).
      if (!(here ? archiveOk(p) : archiveReadOk(p)) || typeof entry !== 'string' || !entry) {
        return here ? refused(p, '') : { ok: false, reason: 'failed' }
      }
      // `here` writes beside the archive, where the user can see it, so it
      // is a job with the window (#166). The temp copy that "Copy folder"
      // puts on the clipboard is not, and stays silent.
      const job = here ? extractJobs.begin({ archive: basename(p), dest: dirname(p) }) : null
      if (here && !job) return BUSY
      const made = new Made()
      /** Say how it ended, to the window and to the caller, in one place. */
      const fail = (reason: ExtractFail, message?: string): ExtractFailure => {
        job?.end('failed', reason, message)
        return { ok: false, reason, ...(message ? { message } : {}) }
      }
      try {
        const clean = entry.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
        const name = clean.split('/').pop() || 'folder'
        /**
         * Staged on the DESTINATION's volume when it is going to land
         * somewhere real (2026-08-31).
         *
         * `here` finishes with a rename, and `fs.rename` CANNOT CROSS
         * VOLUMES - it throws EXDEV. The temp directory is on C: and the
         * archive very often is not (an X: drive full of comics is what
         * found this), so every "Extract folder here" onto another disk
         * failed after 7-Zip had already done the work, with no message,
         * because the failure was the move and not the extraction.
         *
         * Staging beside the archive makes the rename same-volume and
         * therefore instant, whatever the folder weighs. The clipboard copy
         * still stages in temp: nothing renames it anywhere.
         */
        const dir = here
          ? await mkdtemp(join(dirname(p), '.prism-extract-'))
          : await mkdtemp(join(tmpdir(), 'prism-arcdir-'))
        // The staging folder is this call's own, whole: it is what a
        // Cancel removes, and nothing else is.
        if (here) made.tree(dir)
        const pw = archivePasswords.get(p) ?? ''
        const exe = await seven(p)
        let out1 = join(dir, name)
        if (exe) {
          // ONE 7-Zip call for the whole subtree. The member-at-a-time
          // route spawns a process per file, each re-opening the container:
          // measured on a 2GB zip, a 25-file folder came out in 0.41s as
          // one call, and the folder next to it holds 561 files. That is
          // what "Extract folder here" was failing on.
          let total = 0
          if (job) {
            // What the folder holds, so a count of files is a fraction of
            // something when 7-Zip prints no percentage.
            const listed = await listSeven(exe, p, pw)
            if (listed.ok)
              total = listed.entries.filter(
                (e) => e.path === clean || e.path.startsWith(clean + '/')
              ).length
          }
          const s7 = await extractSevenSubtree(
            exe,
            p,
            clean,
            dir,
            pw,
            job ? { ...watching(job), total } : undefined
          )
          if (job?.cancelled) {
            await made.undo()
            job.end('cancelled')
            return { ok: false, reason: 'cancelled' }
          }
          if (!s7.ok) {
            await made.undo()
            return fail(s7.reason, s7.message)
          }
          // 7-Zip keeps the full path under -o, so the folder is as deep as
          // its name was.
          out1 = join(dir, ...clean.split('/'))
        } else {
          const out = await extractTo(
            p,
            [clean],
            dir,
            pw || undefined,
            job ? watching(job) : undefined
          )
          if (!out.ok) {
            await made.undo()
            if (out.reason === 'cancelled') {
              job?.end('cancelled')
              return { ok: false, reason: 'cancelled' }
            }
            return fail(out.reason)
          }
        }
        if (!(await exists(out1))) {
          await made.undo()
          return fail('failed')
        }
        if (!here) {
          wall.grantExtracted(out1)
          return { ok: true, path: out1 }
        }
        // `here` lands it beside the archive, which is inside a root, so it
        // needs no dialog to consent to. Extracted to staging first and
        // renamed across, so a taken name never merges into somebody
        // else's folder - the same rule extract-all follows.
        const parent = dirname(p)
        let out2 = join(parent, name)
        for (let n = 2; (await exists(out2)) && n < 100; n += 1)
          out2 = join(parent, `${name} (${n})`)
        const fs = await import('fs/promises')
        try {
          await fs.rename(out1, out2)
        } catch (e) {
          // Belt and braces: if the stage ever does end up on another
          // volume, copy across rather than answering "failed" for work
          // that has already been done.
          if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
          await fs.cp(out1, out2, { recursive: true })
        }
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        job?.end('done')
        return { ok: true, path: out2 }
      } catch {
        // The staging folder goes whatever went wrong: it has a dot name
        // the tree never shows, so left behind it is clutter nobody can
        // see to remove.
        await made.undo()
        return fail('failed')
      }
    }
  )
  ipcMain.handle(
    CALL.archiveRename,
    async (
      _e,
      p: string,
      entry: string,
      name: string,
      password?: string
    ): Promise<ArchiveRenameResult> => {
      if (!archiveOk(p) || typeof entry !== 'string' || typeof name !== 'string') return 'failed'
      if (await seven(p)) return 'failed' // read-only format; the panel offers no verbs
      try {
        if (archiveTooLarge((await stat(p)).size)) return 'failed'
        return await renameMember(
          p,
          entry,
          name,
          typeof password === 'string' ? password : undefined
        )
      } catch {
        return 'failed'
      }
    }
  )
  ipcMain.handle(CALL.archiveDelete, async (_e, p: string, entry: string): Promise<boolean> => {
    if (!archiveOk(p) || typeof entry !== 'string') return false
    if (await seven(p)) return false
    try {
      return !archiveTooLarge((await stat(p)).size) && (await deleteMember(p, entry))
    } catch {
      return false
    }
  })
  return { openComicWalled, listArchiveWalled, extractMemberWalled }
}
