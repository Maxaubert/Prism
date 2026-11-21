import { app } from 'electron'
import { extname } from 'path'
import { E2E } from '../appState'
import { ffmpegTools } from '../bundledTools'
import { browseLocations } from '../browse'
import { listDir, searchFiles } from '../dirList'
import { docKind } from '../docConvert'
import { createDocClient } from '../docClient'
import { documentImages } from '../docImages'
import { driveUsage, withUsedShare } from '../driveUsage'
import type { MediaInfo } from '../ffmpeg'
import type { MainCtx } from '../ipc/context'
import type { ArchiveBodies } from '../ipc/archive'
import {
  startPhoneService,
  type PhoneHooks,
  type PhoneServerDeps,
  type PhoneService
} from '../phone'
import { HlsJobs } from '../phone/jobs'
import { phoneListed, phoneMay, phoneOnThisPc, phoneRelease } from '../phone/phoneAccess'
import { phonePlaces } from '../phone/places'
import type { Positions } from '../positions'
import { readAsVtt, sidecarsFor } from '../subtitles'
import { shapeOf } from '../textFile'
import type { Thumbs } from '../thumbs'
import * as userFsp from '../userFs'
import { fileKind, isMarkdown } from '@shared/fileKind'
import type { TextRead } from '@shared/types'

/** What the phone group needs that index.ts builds first (audit #7 step 2). */
export interface PhoneWiringDeps {
  ctx: MainCtx
  /** Where the renderer's own files live. */
  rendererDir: string
  /** `fsmedia://`, walled by `mediaAllowed`. */
  serveMedia: (request: Request) => Promise<Response>
  probeCached: (p: string) => Promise<MediaInfo | null>
  hlsJobs: HlsJobs | null
  positions: Positions
  thumbs: Thumbs | null
  logPhone: (line: string) => void
  /** Read when the phone asks, after `registerArchiveIpc` has made them. */
  archiveBodies: () => ArchiveBodies
}

/**
 * The phone group of whenReady (audit #7 step 2): the text and document
 * bodies the phone shares with the window, the phone server's deps, and its
 * service. Moved whole, in the same order.
 */
export function wirePhone(d: PhoneWiringDeps): {
  phoneService: PhoneService
  readTextWalled: (p: string) => Promise<TextRead>
  docHtmlOf: (p: string) => Promise<string | null>
} {
  const { ctx, rendererDir, serveMedia, probeCached, hlsJobs, positions, thumbs, logPhone } = d
  /**
   * `file:text`'s body, factored (#106) so the phone's `/api/text` reads
   * the same way: capped, decoded by its own byte-order mark, the shape
   * remembered for a save. The WALL is not in here: the IPC handler checks
   * the root set and the extracted grants, the phone route checks its own
   * phone's root, and each grants what the answer names on its own side.
   */
  const readTextWalled = async (p: string): Promise<TextRead> => {
    try {
      const fs = userFsp
      // AWAITED, so a read error is caught here rather than escaping as a
      // rejected invoke; and capped, because the contract is small text
      // files and CodeMirror is handed one string (2026-08-28).
      const st = await fs.stat(p)
      // Too big to hand over as one string. Answered as a REASON rather than
      // as null: the editor used to seed itself with a placeholder and could
      // then save that placeholder over the file (2026-08-28).
      if (st.size > ctx.TEXT_MAX_BYTES) return { error: 'too-large' }
      // Decoded by its own byte-order mark rather than assumed utf-8: a
      // .reg is UTF-16LE by definition and Prism claims .reg, and so is
      // anything PowerShell 5.1 redirected to a file. Those used to open as
      // mojibake, which Prism would then offer to save back over them. The
      // file's SHAPE is remembered so the save can reproduce it, line
      // endings included (see textFile.ts).
      const buf = await fs.readFile(p)
      const { text, encoding, eol } = shapeOf(buf)
      ctx.textShape.set(p.toLowerCase(), { encoding, eol })
      return { text }
    } catch {
      return { error: 'unreadable' }
    }
  }
  /** `doc:html`'s body, factored the same way (#106): converted AND
   *  sanitised on the document worker, null for anything that is not a document or
   *  would not convert. No wall in here either. */
  const docClient = createDocClient()
  const docHtmlOf = async (p: string): Promise<string | null> => {
    if (!docKind(extname(p))) return null
    try {
      // On the document worker, never main (2026-10-12, docClient.ts).
      return await docClient.html(p)
    } catch {
      return null
    }
  }

  const phoneDeps = (hooks: PhoneHooks): PhoneServerDeps => ({
    rendererDir: rendererDir,
    devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
    media: serveMedia,
    listDir,
    // The very function `search:files` answers the sidebar with, so the
    // phone's field and the PC's box find the same files by the same rules,
    // over the folder the phone is in (2026-10-14).
    search: (dir: string, query: string) => searchFiles(dir, query),
    // The desktop Explorer's rule, one owner per phone (phoneAccess.ts).
    access: {
      listed: phoneListed,
      may: phoneMay,
      release: phoneRelease,
      local: (p) => phoneOnThisPc(p)
    },
    places: () =>
      phonePlaces(
        () => browseLocations((key) => app.getPath(key)),
        hooks.pins(),
        async (paths) =>
          E2E
            ? withUsedShare(await driveUsage(paths), process.env.PRISM_E2E_DRIVE_USED)
            : driveUsage(paths)
      ),
    subsFor: async (p: string) =>
      (await sidecarsFor(p)).map((t) => ({ path: t.path, label: t.label })),
    readSubs: (p: string) => readAsVtt(p, ffmpegTools()?.ffmpeg),
    probe: probeCached,
    jobs: hlsJobs,
    readText: readTextWalled,
    docHtml: docHtmlOf,
    docImages: documentImages,
    isMarkdown,
    // `/m/` passes through serveMedia, whose wall is `mediaAllowed`; the
    // phone's grant on its side is not enough on its own.
    grantServable: (paths) => {
      for (const img of paths) ctx.wall.grantServable(img)
    },
    // The comic and archive bodies are made further down this block, by
    // `registerArchiveIpc` beside the gates they share. That is fine:
    // `phoneDeps()` is only ever called from `startPhone`, which runs after
    // the block has finished, so nothing here is read before it exists.
    comicOpen: (p, password) => d.archiveBodies().openComicWalled(p, password),
    archiveList: (p, password) => d.archiveBodies().listArchiveWalled(p, password),
    archiveExtract: (p, entry, password) =>
      d.archiveBodies().extractMemberWalled(p, entry, password),
    // The IPC's own kind gates, minus their root half (the route walls
    // with the phone's root instead): a .txt is never handed to 7-Zip.
    isArchive: (p) => fileKind(extname(p)) === 'archive',
    isComic: (p) => fileKind(extname(p)) === 'comic',
    onChange: hooks.onChange,
    log: logPhone,
    positions: {
      get: (p) => positions.get(p),
      set: (p, t) => positions.set(p, t)
    },
    thumb: (p) => {
      const kind = fileKind(extname(p))
      if (!thumbs || (kind !== 'image' && kind !== 'video')) return Promise.resolve(null)
      return thumbs.get(p, kind)
    },
    // A throwaway e2e build must never raise the firewall prompt.
    loopbackOnly: E2E
  })
  const phoneService = startPhoneService({ deps: phoneDeps, hlsJobs })
  return { phoneService, readTextWalled, docHtmlOf }
}
