import type { SavedBrowse } from './browse'
import type { ArchiveEncryption } from './ipcTypes'
import type { ExtractFail } from './extraction'

export type FileKind =
  'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'text' | 'archive' | 'comic' | 'other'

/** One openable file, as the renderer sees it. */
export interface ViewerFile {
  path: string
  name: string
  ext: string // lowercased, leading dot
  kind: FileKind
  /** Bytes on disk; 0 if it couldn't be stat'ed. Used to skip preloading files
   *  so large that warming them would cost more than it saves. ABSENT while
   *  the Explorer's names-first listing has not stat'ed it yet (#271): not
   *  zero, unknown, and nothing may count it as 0 bytes. */
  size?: number
  /** Modified time (ms since epoch); 0 if it couldn't be stat'ed. Sorting.
   *  Absent, like `size`, until the details arrive. */
  mtimeMs?: number
  /** A MEMBER of an archive (#300): `path` is its place inside the zip as the
   *  address bar spells it (`C:\x.zip\docs\a.md`), not a file on disk. Every
   *  viewer is reached through the member gate, which unpacks it to the run's
   *  temp folder first, and nothing writes to it. */
  member?: true
  /** What it occupies inside its container (#300, the Packed column). */
  packed?: number
  /** Password protected inside its container. */
  encrypted?: true
}

/** A subfolder, as the sidebar tree sees it. */
export interface DirEntry {
  path: string
  name: string
  /** Modified time, for the Explorer's date order (#285: Downloads mixes
   *  folders and files by date). Absent until the details arrive (#271), and
   *  in the tree, which never asks. */
  mtimeMs?: number
  /** A folder INSIDE an archive (#300): the bytes of every member beneath it
   *  and how many entries that is. The container's own listing knows both, so
   *  the Size column never asks `folder:size` about a path not on disk. */
  size?: number
  items?: number
}

/** A sidebar search hit: enough to draw the row and open the file. */
export interface SearchHit {
  path: string
  name: string
  kind: FileKind
  /** Where it lives, relative to the searched root ('' at the root itself). */
  dir: string
  /** This hit is a FOLDER, not a file (2026-08-30). Clicking it walks the tree
   *  there rather than opening it in a viewer. Kept separate from `dir`, which
   *  is the row's subtitle and means something else. */
  isFolder?: boolean
}

/** One entry inside an archive. */
export interface ArchiveEntry {
  path: string
  name: string
  dir: boolean
  size: number
  /** What it occupies inside the container; absent on folders. */
  packed?: number
  /** The entry's own modified time, epoch ms. */
  mtime?: number
  encrypted?: boolean
}

/** What listing an archive answered. A REASON rather than a bare null
 *  (2026-08-30): a 7z or rar written with encrypted file names cannot be
 *  listed without the password, and null reached the panel as "this archive
 *  looks corrupt" with nowhere to type one. */
export type ArchiveListing =
  { ok: true; entries: ArchiveEntry[] } | { ok: false; reason: ExtractFail }

/** What saving the editor's text answered. A REASON rather than a bare false
 *  (2026-08-30): the close-time "Save all changes" could fail with nothing to
 *  show but a silence, and a file moved out from under a dirty buffer was
 *  unsaveable for a reason nobody could see. */
export type WriteResult =
  { ok: true } | { ok: false; reason: 'refused' | 'gone' | 'failed'; message?: string }

export interface SearchResult {
  hits: SearchHit[]
  /** True when a cap stopped the walk: there may be more than what came back. */
  truncated: boolean
  /** This walk was SUPERSEDED and stopped where it was, so the empty hits are
   *  not an answer (2026-09-08). A cancelled walk reads exactly like "nothing
   *  matches" to whoever asked, and on the phone that emptied a list which had
   *  the right rows in it. Absent on a real answer, so nothing has to test it
   *  to believe one. */
  superseded?: true
}

/** One directory's listable contents: subfolders, then viewable files.
 *  `unreadable` marks a folder we could not open, so the tree can say so
 *  instead of showing it as empty. */
export interface DirListing {
  folders: DirEntry[]
  files: ViewerFile[]
  unreadable?: boolean
  /** How many files were dropped for being unviewable. Absent when none were,
   *  so a truly empty folder still reads as empty rather than as "0 files
   *  Prism can't open". */
  hidden?: number
  /** False while the files' sizes and dates are still on their way (#271):
   *  the Explorer is answered with names first and `browse:details` patches
   *  follow. Absent means complete. */
  complete?: boolean
  /** This listing is a place INSIDE an archive (#300): what the strip, the
   *  Packed column, the crumbs' zip icon and the menus need to know. */
  archive?: ArchiveMeta
  /** Why a place inside an archive could not be shown as asked (#300): it
   *  wants its password, it is damaged, nested too deep, or the folder has
   *  gone from it (then the listing is the nearest folder that is still
   *  there, and this says what was missing). `container` names the archive
   *  a password is for. */
  archiveError?: {
    reason: ExtractFail | 'missing' | 'deep' | 'nest-big'
    container: string
    message: string
  }
}

/**
 * A place inside an archive, as main found it (#300; owner, 2026-10-06: "make
 * zips seem like ordinary folders, they keep the icon but you open them like
 * any other folder but you get the zip relevant right click menu options").
 * Main decides which segment of a path is the container, by a stat, never the
 * renderer by an extension.
 */
export interface ArchiveMeta {
  /** The innermost container's REAL file (a temp copy when nested): what the
   *  archive verbs are handed. */
  container: string
  /** The innermost container's root as the address bar spells it. A member's
   *  name inside the container is its path below this. */
  base: string
  /** Every container's root along the path, outermost first: the crumbs that
   *  wear the archive icon. */
  chain: string[]
  /** The outermost container on disk: what "Show in File Explorer" names. */
  outer: string
  /** Where the listing is inside the innermost container, '' at its root. */
  inner: string
  /** The innermost container's name ("Wind-0.2.2.zip"). */
  display: string
  files: number
  folders: number
  /** Bytes of the container file itself. */
  packed: number
  /** Bytes of every member unpacked. */
  unpacked: number
  /** No Add, Rename or Delete: a 7-Zip format, a zip over adm-zip's cap, or
   *  a nested container (a temp copy, whose writes would be lost). A zip with
   *  password-protected members keeps Rename and Delete, as it always has;
   *  Add and moves inside refuse in main. */
  readOnly: boolean
  /** Inside another archive. */
  nested: boolean
  encryption: ArchiveEncryption
}

/** Sizes and dates for files of a names-first listing (#271). `done` is the
 *  last patch of the run: the listing at `path` is complete. Since #285 the
 *  folders' dates ride in `files` too; a folder takes only `mtimeMs`. */
export interface BrowseDetails {
  path: string
  files: Array<{ path: string; size: number; mtimeMs: number }>
  done: boolean
}

/** A folder Prism has open changed, and Prism did not change it (2026-08-30).
 *  `root` says which tab it belongs to; `dirs` are the folders to re-list. */
export interface DirChange {
  root: string
  dirs: string[]
}

/** An app the "Open in" submenu can hand a file to. `id` is the executable's
 *  path; main only ever launches an id it enumerated itself. */
export interface OpenWithApp {
  id: string
  name: string
  /** The exe's icon as a data URL, when Windows would give one up. */
  icon?: string
}

/** What to do when a rename runs into a name that's already taken. 'ask' changes
 *  nothing and reports back, so the choice can be put to the user. */
export type OnClash = 'ask' | 'overwrite' | 'keep-both'

export type RenameResult =
  /** `replaced` names what an overwrite sent to the bin, so undo can
   *  bring it back after the rename has been reversed. */
  | { ok: true; path: string; replaced?: string }
  | {
      ok: false
      reason: 'invalid' | 'clash' | 'missing' | 'failed'
      message?: string
      /** For a clash: the name "keep both" would use, e.g. "photo (2).jpg". */
      suggestion?: string
    }

/** What main hands the renderer when a tab is restored or something is opened
 * from outside: the folder's viewable files, the index of the one that was
 * actually opened, and the folder the tab was opened at. */
export interface OpenPayload {
  browse?: SavedBrowse
  restoreTabId?: string
  /** Every tab is an Explorer tab; the field stays so a saved strip reads. */
  role?: 'explorer'
  /** The permanent first Explorer tab. */
  pinned?: boolean
  files: ViewerFile[]
  /** Which of `files` to show. -1 when a folder was opened and it holds nothing
   *  viewable: the tab is still at that folder, the viewer just has no file. */
  index: number
  root: string
  /** Restore only: this payload rebuilds a SAVED tab. It always becomes its
   *  own tab - the arriving-file rule folds same-root payloads into one, and
   *  folding a restore silently deletes a tab the user had. */
  restore?: boolean
  /** A FILE arrived from outside (a double-click, "Open with", the Explorer
   *  menu's "Open file", the command line, a drop; 2026-09-22). It goes to
   *  the pinned Explorer tab, so main builds nothing for it and registers no
   *  root: `files` is empty, `index` -1, `root` its folder. */
  explorerFile?: string
  /** A FOLDER arrived from outside (the shell verb "Open in Prism", the
   *  command line, a second instance; 2026-10-26). It opens an Explorer tab at
   *  that folder. Like `explorerFile`, main builds nothing for it. */
  explorerFolder?: string
  /** Restore only: this saved tab was the ACTIVE one - it takes the front.
   *  The rest restore behind whatever is already showing. */
  restoreActive?: boolean
  /** Restore only: the tab's place in the saved strip (#271). Explorer tabs
   *  are sent first and the rest as each is ready, so the page puts every
   *  restored tab back at its saved place rather than in arrival order. */
  restoreOrder?: number
  /** An Explorer tab's listing of the folder it shows (#271), from the cache
   *  or a names-only read, so its first frame has rows. */
  listing?: { path: string; listing: DirListing }
}

/** What the PC remembers about a file (#118, #124): where you had got to and
 *  what you chose for it. `null` in a field is a choice ("off", "default");
 *  an absent field is no memory of it. */
export interface FileMemory {
  t?: number
  audio?: number | null
  subs?: string | null
  fit?: string
}
export type FileMemoryPatch = {
  t?: number | null
  audio?: number | null
  subs?: string | null
  fit?: string | null
}

/** What main knows about a media file, and whether Prism must decode its
 *  audio itself. Chromium ships no AC-3/E-AC-3/DTS/TrueHD decoder and no
 *  demuxer for ASF or raw AC-3, so those play as silence unless the sidecar
 *  takes over (src/main/audioSidecar.ts). */
export interface AudioTrackOffer {
  /** Absolute stream index; also the picker's identity for the track. */
  index: number
  codec: string
  channels: number
  language: string
  /** The name the file gives it, when it gives one ("Commentary"). */
  title: string
  /** fsaudio:// url that plays this track. */
  url: string
}

export interface MediaProbe {
  /** Is there an ffmpeg to decode with at all. */
  ffmpeg: boolean
  /** Is this file's own track one Chromium cannot play. */
  needed: boolean
  /** Set when nothing could be probed: the renderer may still ask for a
   *  sidecar off its own decoder counters, naming the duration itself. */
  blind?: boolean
  codec?: string
  channels?: number
  layout?: string
  /** Frames per second of the video stream, when the file says. What frame
   *  stepping steps by: 1/30 on 24fps film is not a frame. */
  fps?: number
  /** fsaudio:// url for the track, ready to hand to an <audio>. */
  url?: string
  /** Every audio track the file holds (2026-08-28), for the picker. Present
   *  whenever there is more than one; each carries the url that plays IT, so
   *  choosing is handing a different src to the same sidecar element. A film
   *  Chromium can play natively still lists them: picking a non-default track
   *  mutes the picture's own sound and decodes the chosen one beside it. */
  tracks?: AudioTrackOffer[]
  /** The video stream's codec, when there is one. Prism decodes audio but not
   *  video, so this exists to NAME what it cannot show. */
  videoCodec?: string
  /** A score rather than a recording: it must be synthesised before there is
   *  anything to play, which takes seconds. */
  synth?: boolean
  /** Set when the file needs converting before it can play at all.
   *  `quick` means the streams can be copied (a container problem, seconds);
   *  otherwise the picture is re-encoded, which takes as long as it takes. */
  convert?: { reason: 'container' | 'codec'; quick: boolean }
}

/**
 * What `file:text` answers (2026-08-28). A REASON rather than null, because an
 * editor that cannot tell "empty file" from "could not read it" will happily
 * save its own placeholder over the file it failed to open.
 */
export type TextRead = { text: string } | { error: 'too-large' | 'unreadable' }

/** The last slice of a file that is too big to open whole, plus where it
 *  starts and how big the file really is. Never a substitute for the file:
 *  the editor keeps its "what was on disk" ref null for one of these, which
 *  is what makes saving structurally impossible. */
export interface TailRead {
  text: string
  from: number
  size: number
}

/** A followed file grew. `reset` means it got SHORTER - rotated, truncated,
 *  replaced - so the new bytes must not be spliced onto the old tail. */
export interface TailEvent {
  path: string
  text: string
  reset: boolean
}

/** A phone paired to this PC (2026-09-06, #104): its token, the name it gave,
 *  and the folder it was last in, null for This PC (2026-10-14: a phone is in
 *  a folder anywhere on the PC, not on a tab). */
export interface PhoneInfo {
  token: string
  name: string
  here: string | null
  paired: number
  seen: number
}

/** What the More > Phone dialog shows: main's answer to `phone:get`. */
export interface PhoneState {
  on: boolean
  port: number | null
  addresses: string[]
  phones: PhoneInfo[]
  /** Phones that fetched something in the last 30 seconds, by token. */
  watching: string[]
  /** A pairing code for the folder in front (or This PC): link and QR (SVG), when the server is up. */
  code?: { code: string; link: string; svg: string; expires: number }
  error?: string
}
