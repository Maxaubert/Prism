export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'text' | 'archive' | 'other'

/** One openable file, as the renderer sees it. */
export interface ViewerFile {
  path: string
  name: string
  ext: string // lowercased, leading dot
  kind: FileKind
  /** Bytes on disk; 0 if it couldn't be stat'ed. Used to skip preloading files
   *  so large that warming them would cost more than it saves. */
  size: number
  /** Modified time (ms since epoch); 0 if it couldn't be stat'ed. Sorting. */
  mtimeMs: number
}

/** A subfolder, as the sidebar tree sees it. */
export interface DirEntry {
  path: string
  name: string
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
  | { ok: true; entries: ArchiveEntry[] }
  | { ok: false; reason: 'password' | 'aes' | 'failed' }

export interface SearchResult {
  hits: SearchHit[]
  /** True when a cap stopped the walk: there may be more than what came back. */
  truncated: boolean
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

/** What main hands the renderer when a file is opened: the folder's viewable
 * files, the index of the one that was actually opened, and the session root
 * (the folder Prism was opened in) that the sidebar tree is bounded by. */
export interface OpenPayload {
  files: ViewerFile[]
  /** Which of `files` to show. -1 when a folder was opened and it holds nothing
   *  viewable: the tree is still rooted there, the viewer just has no file. */
  index: number
  root: string
  /** Restore only: the tab had a terminal showing in this view when the app
   *  closed, so reopen one (a fresh shell - sessions die with the app). A tab
   *  that lived as a Claude session must come back as a terminal, not as an
   *  empty viewer. */
  term?: 'full' | 'split'
  /** Restore only: the SESSION ID of the Claude conversation the terminal
   *  hosted at close. The fresh shell launches `claude --resume <id>` as its
   *  startup command - the ONE command Prism ever writes itself (owner
   *  decision, 2026-08-21), and never typed on screen. */
  agentResume?: string
  /** Restore only: this payload rebuilds a SAVED tab. It always becomes its
   *  own tab - the arriving-file rule folds same-root payloads into one, and
   *  folding a restore silently deletes a tab the user had. */
  restore?: boolean
  /** A FOLDER arrived from outside (Explorer's "Open in Prism" on a folder, or
   *  "Open Prism here" on its background). The tab roots there, and what it
   *  SHOWS is the "New tabs show" setting's business - first file, a terminal,
   *  or nothing - exactly as the + would do it. */
  folder?: boolean
  /** Restore only: this saved tab was the ACTIVE one - it takes the front.
   *  The rest restore behind whatever is already showing. */
  restoreActive?: boolean
}

/** A shell main detected on this machine; the only things term:spawn launches. */
export interface ShellDef {
  id: string
  name: string
  exe: string
  args: string[]
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
