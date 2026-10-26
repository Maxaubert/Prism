import type { WindowPreferenceChange, WindowPreferencesSnapshot } from '@shared/windowPreferences'
import { CALL, PUSH, SWEEP_CHANNELS } from '@shared/channels'
import type {
  BrowseDirectory,
  BrowseDriveUsage,
  BrowseSearchProgress,
  BrowseSearchResult,
  BrowseSearchWindowRequest,
  BrowseShortcut,
  SavedBrowse
} from '@shared/browse'
import { clipboard, contextBridge, ipcRenderer, nativeImage, webUtils } from 'electron'

/** Started by the e2e harness (#356: its clipboard is main's fake). Main
 *  passes --prism-e2e through additionalArguments: the renderer has its own argv. */
const E2E_RUN = process.argv.includes('--prism-e2e')
import { isWebUrl } from 'prism-term-core/shared/webUrl'
import { createDiagApi } from 'prism-term-core/preload/diagApi'
import type { UpdateInfo } from 'prism-term-core/shared/updateTypes'
import type {
  ArchiveRenameResult,
  ExtractAllResult,
  ExtractDirResult,
  ExtractEvent,
  ExtractPickedResult,
  ExtractToResult,
  MemberExtractResult
} from '@shared/extraction'
import type { SweepBegin, SweepEnd, SweepState, SweepUpdate } from '@shared/sweepOverlay'
import type { ArchiveSummary, MemberAnswer } from '@shared/archivePlace'
import type { FolderSizeResult } from '@shared/folderSize'
import type { WinEShortcutStatus } from '@shared/winEShortcut'
import type { FolderHandlerStatus } from '@shared/folderHandler'
import type { DriveDetails, MediaProps, TextProps } from '@shared/props'
import type {
  ArchiveAddResult,
  ArchiveMoveResult,
  ArchiveStat,
  BinIfEmptyResult,
  ComicOpenResult,
  ConvertProgress,
  ConvertResult,
  FileStat,
  FolderSizeProgress,
  HashProgress,
  HostCapabilities,
  MoveOnClash,
  MoveResult,
  PasteProgress,
  PasteResult,
  PhotoInfo,
  SubtitleTrack,
  WindowState
} from '@shared/ipcTypes'
import type {
  ArchiveListing,
  BrowseDetails,
  DirChange,
  DirListing,
  OnClash,
  OpenPayload,
  OpenWithApp,
  RenameResult,
  SearchResult,
  MediaProbe,
  PhoneState,
  TailEvent,
  TailRead,
  TextRead,
  WriteResult,
  FileMemory,
  FileMemoryPatch
} from '@shared/types'

// The typed bridge the renderer uses. Kept small and stable; prism-core consumes
// `mediaUrl` + the open payload, nothing app-specific. Every channel is named
// through `@shared/channels` and every answer typed from `@shared/ipcTypes`
// (or its feature file), so main and this file cannot drift apart.

type PushChannel = (typeof PUSH)[keyof typeof PUSH]
type CallChannel = (typeof CALL)[keyof typeof CALL]

/** The page's side of a PUSH channel: hand it a callback, get back the off.
 *  The event is dropped; the callback gets the payload alone. */
function subscribe<T = void>(channel: PushChannel): (cb: (payload: T) => void) => () => void {
  return (cb) => {
    const listener = (_: unknown, payload: T): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

/** A synchronous ask (`sendSync`) that answers `fallback` when main cannot
 *  answer at all, rather than throwing into the page. */
function syncOr<T>(channel: CallChannel, fallback: T, ...args: unknown[]): T {
  try {
    return ipcRenderer.sendSync(channel, ...args)
  } catch {
    return fallback
  }
}

const api = {
  /** A folder's names now, its sizes and dates after as `onBrowseDetails`
   *  (#271). `details: false` is a read for its grant only, which must not
   *  take the disk from the folder on screen. */
  browseDirectory: (
    tabId: string,
    path: string,
    options?: { details?: boolean }
  ): Promise<BrowseDirectory | null> =>
    ipcRenderer.invoke(CALL.browseDirectory, tabId, path, options),
  /** The listing cache's copy of a folder, synchronously, or null (#271). */
  browseCached: (path: string): BrowseDirectory | null =>
    syncOr<BrowseDirectory | null>(CALL.browseCached, null, path) ?? null,
  /** Read a folder ahead of the click (#271); `pin` keeps it in the cache. */
  browsePrefetch: (path: string, pin = false): Promise<BrowseDirectory | null> =>
    ipcRenderer.invoke(CALL.browsePrefetch, path, pin),
  onBrowseDetails: subscribe<BrowseDetails>(PUSH.browseDetails),
  /** The user's first day of the week, 0 Sunday ... 6 Saturday (#285). */
  weekStart: (): Promise<number> => ipcRenderer.invoke(CALL.systemWeekStart),
  /** Settings > General > Remember folders: delete what was kept. */
  clearListingCache: (): Promise<boolean> => ipcRenderer.invoke(CALL.listingCacheClear),
  browseSearch: (
    tabId: string,
    path: string,
    query: string,
    requestId: string,
    window?: BrowseSearchWindowRequest
  ): Promise<BrowseSearchResult> =>
    ipcRenderer.invoke(CALL.browseSearch, tabId, path, query, requestId, window),
  browseSearchCancel: (tabId: string, requestId: string): void =>
    ipcRenderer.send(CALL.browseSearchCancel, tabId, requestId),
  browseSuggest: (
    tabId: string,
    path: string,
    query: string,
    requestId: string
  ): Promise<BrowseSearchResult> =>
    ipcRenderer.invoke(CALL.browseSuggest, tabId, path, query, requestId),
  browseSuggestCancel: (tabId: string, requestId: string): void =>
    ipcRenderer.send(CALL.browseSuggestCancel, tabId, requestId),
  onBrowseSearchProgress: subscribe<BrowseSearchProgress>(PUSH.browseSearchProgress),
  browseWatch: (tabId: string, path: string | null): Promise<boolean> =>
    ipcRenderer.invoke(CALL.browseWatch, tabId, path),
  browseLocations: (): Promise<BrowseShortcut[]> => ipcRenderer.invoke(CALL.browseLocations),
  browseDrives: (paths: string[]): Promise<BrowseDriveUsage[]> =>
    ipcRenderer.invoke(CALL.browseDrives, paths),
  browseRelease: (tabId: string): void => ipcRenderer.send(CALL.browseRelease, tabId),
  /**
   * What this host can do (#106). The viewers serve two hosts, the desktop
   * app and the phone page, and the phone's bridge (`phone/prismShim.ts`)
   * answers the same shape with every flag false. A viewer consults it to
   * leave a verb OUT rather than to offer one that answers "did not happen":
   * `write` is anything that changes a file (save, rename, extract, delete),
   * `clipboard` is the OS clipboard (files, pixels; the browser's own
   * writeText is not it), `explorer` is the desktop around the window (Show
   * in File Explorer, and the hex view a file handed over by Windows lands
   * in), `drag` is dragging out to other windows. The desktop has all four.
   */
  capabilities: { write: true, clipboard: true, explorer: true, drag: true } as HostCapabilities,
  /** fsmedia:// URL for a local path, so <img>/<video>/<audio>/<embed> can load it. */
  mediaUrl: (path: string): string => `fsmedia://local/${encodeURIComponent(path)}`,

  /** Choose a folder without opening it: the Settings picker. */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(CALL.dialogPickFolder),
  /** Choose real files: the archive panel's "Add files". Empty when cancelled. */
  pickFiles: (): Promise<string[]> => ipcRenderer.invoke(CALL.dialogPickFiles),
  /** Report the tab strip, for persistence only. The root wall is never
   *  rebuilt from a snapshot (it raced payloads in flight). */
  tabsChanged: (
    tabs: Array<{
      root: string
      role?: 'explorer'
      pinned?: boolean
      id?: string
      browse?: SavedBrowse
      file?: string
    }>,
    active: number
  ): void => ipcRenderer.send(CALL.tabsChanged, { tabs, active }),
  /** Where you had got to in a film, kept ONCE on the PC by file path
   *  (#118): the phone reads and writes the same store over /api/pos, so a
   *  film left at minute 40 here opens at minute 40 there. Seconds, or null. */
  positionGet: (path: string): Promise<number | null> =>
    ipcRenderer.invoke(CALL.posGet, path).then((m: FileMemory | null) => m?.t ?? null),
  positionSet: (path: string, t: number | null): void => ipcRenderer.send(CALL.posSet, path, { t }),
  /** The whole of what the PC remembers about a file (#124): the place, and
   *  the audio track, subtitle track and aspect ratio picked for it. A patch
   *  merges; null clears a field. */
  memoryGet: (path: string): Promise<FileMemory | null> => ipcRenderer.invoke(CALL.posGet, path),
  memorySet: (path: string, patch: FileMemoryPatch): void =>
    ipcRenderer.send(CALL.posSet, path, patch),
  // Prism on your phone (#104): the More > Phone dialog's state and verbs.
  // Every verb answers with the whole state, with a code that starts a phone
  // at `start` (the folder in front, null for This PC), so the dialog never
  // has to guess what a click did.
  /** The dialog's state: switch, port, addresses, phones, and a code for `start`. */
  phoneGet: (start: string | null): Promise<PhoneState> => ipcRenderer.invoke(CALL.phoneGet, start),
  /** Turn the server on or off. The answer says what the server IS. */
  phoneSetOn: (on: boolean, start: string | null): Promise<PhoneState> =>
    ipcRenderer.invoke(CALL.phoneSetOn, on, start),
  /** A fresh code for `start`, replacing the one it had. */
  phoneCode: (start: string | null): Promise<PhoneState> => ipcRenderer.invoke(CALL.phoneCode, start),
  /** The dialog closed: no code it showed may still pair a phone. */
  phoneCodeDrop: (): void => ipcRenderer.send(CALL.phoneCodeDrop),
  /** Forget a paired phone by token. */
  phoneForget: (token: string, start: string | null): Promise<PhoneState> =>
    ipcRenderer.invoke(CALL.phoneForget, token, start),
  /** The Quick access pins, for the phone's drawer (2026-10-14). */
  phonePins: (pins: ReadonlyArray<{ name: string; path: string }>): void =>
    ipcRenderer.send(CALL.phonePins, pins),
  /** Pairing, watchers or the switch changed: re-read with phoneGet. */
  onPhoneChanged: subscribe(PUSH.phoneChanged),
  // The three navigation calls name the root they act in. They are per-tab
  // operations, the caller always knows which tab is asking, and main refuses a
  // root that is not open as well as a path from a different one.
  /** Open a file the sidebar tree lists. Inside `root` only, and it leaves the
   *  root alone (unlike openPath, which opens a root of its own). */
  openWithin: (root: string, path: string): Promise<OpenPayload | null> =>
    ipcRenderer.invoke(CALL.openWithin, root, path),
  /** Children of a folder for the sidebar tree; null if outside `root`. */
  listDir: (root: string, path: string): Promise<DirListing | null> =>
    ipcRenderer.invoke(CALL.dirList, root, path),
  /** Name search under `root`: bounded, breadth-first, capped. */
  searchTree: (root: string, query: string): Promise<SearchResult> =>
    ipcRenderer.invoke(CALL.searchFiles, root, query),
  /** Rename a file in place. `onClash` decides what a taken name does: 'ask'
   *  reports the clash back so the user can choose. */
  renameFile: (path: string, name: string, onClash: OnClash): Promise<RenameResult> =>
    ipcRenderer.invoke(CALL.fileRename, path, name, onClash),
  /** Send a file to the Recycle Bin. */
  trashFile: (path: string): Promise<boolean> => ipcRenderer.invoke(CALL.fileTrash, path),
  /** Read a small text file (for the text/code/markdown viewer). */
  readText: (path: string): Promise<TextRead> => ipcRenderer.invoke(CALL.fileText, path),
  /** The LAST `max` bytes of a file, for one too big for readText. Read-only
   *  by construction: it answers where it starts and how big the file really
   *  is, and never claims to be the file. */
  tailBytes: (path: string, max: number): Promise<TailRead | null> =>
    ipcRenderer.invoke(CALL.fileTailBytes, path, max),
  /** Follow a file that is still being written, from `from` bytes in. New
   *  text arrives through onFileAppended until stopTail. */
  startTail: (path: string, from: number): Promise<boolean> =>
    ipcRenderer.invoke(CALL.tailStart, path, from),
  stopTail: (path: string): Promise<void> => ipcRenderer.invoke(CALL.tailStop, path),
  /** Save the editor's text over the file. Text kinds only, inside the root.
   *  Answers with a reason, so a failed save can say why rather than only
   *  that it failed. */
  writeText: (path: string, text: string): Promise<WriteResult> =>
    ipcRenderer.invoke(CALL.fileWrite, path, text),

  /** What the camera wrote into a photo: camera, lens, exposure, when, GPS.
   *  Read in main from the file itself, so it works for HEIC and camera RAW,
   *  whose decoded copies carry no metadata at all. */
  photoInfo: (path: string): Promise<PhotoInfo> => ipcRenderer.invoke(CALL.imagePhotoInfo, path),
  /** Paste whatever files are on the clipboard into a folder. The sources may
   *  be anywhere (you copied them in Explorer); the destination must be inside
   *  a root. Nothing is ever written over: a taken name becomes "name (2)". */
  pasteInto: (dir: string, cut?: string[], jobId?: string): Promise<PasteResult> =>
    ipcRenderer.invoke(CALL.filePasteInto, dir, cut, jobId),
  /** Byte progress of a running paste, 0-100, tagged with the job it belongs
   *  to since several can run at once. Only pastes big enough to measure
   *  ever report. */
  onPasteProgress: subscribe<PasteProgress>(PUSH.pasteProgress),
  /** Whether a Paste row is worth drawing at all. */
  clipboardHasFiles: (): Promise<boolean> => ipcRenderer.invoke(CALL.clipboardHasFiles),
  /** Size, dates and folder-ness for the Properties window. Created and
   *  Opened are optional: the phone's stat does not carry them. */
  statFile: (path: string): Promise<FileStat | null> => ipcRenderer.invoke(CALL.fileStat, path),
  /** The Properties window's facts beyond the stat (owner, 2026-10-12). A
   *  film's or a song's picture, tracks and tags; null without ffprobe. */
  propsMedia: (path: string): Promise<MediaProps | null> => ipcRenderer.invoke(CALL.propsMedia, path),
  /** One JPEG of the file as a `data:` URL: a frame 10% into a film, or a
   *  song's own cover. null when it has neither. */
  propsPicture: (path: string): Promise<string | null> => ipcRenderer.invoke(CALL.propsPicture, path),
  /** A text file's encoding, BOM and line endings, from its first 64 KB. */
  propsText: (path: string): Promise<TextProps | null> => ipcRenderer.invoke(CALL.propsText, path),
  /** A drive root's (`C:\`) model, connection, space and top-level folders. */
  driveDetails: (root: string): Promise<DriveDetails | null> => ipcRenderer.invoke(CALL.driveDetails, root),
  /** Windows' own Disk Cleanup for that drive. */
  driveCleanup: (root: string): Promise<boolean> => ipcRenderer.invoke(CALL.driveCleanup, root),
  /** A file's SHA-256, streamed in main. `done` is the hex, or null when it
   *  could not be read or was stopped; `cancel` stops it. */
  hashFile: (
    path: string,
    onProgress: (done: number, total: number) => void
  ): { done: Promise<string | null>; cancel: () => void } => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    const listener = (_e: unknown, m: HashProgress): void => {
      if (m.id === id) onProgress(m.done, m.total)
    }
    ipcRenderer.on(PUSH.fileHashProgress, listener)
    const done = (ipcRenderer.invoke(CALL.fileHash, path, id) as Promise<string | null>)
      .catch(() => null)
      .finally(() => ipcRenderer.removeListener(PUSH.fileHashProgress, listener))
    return { done, cancel: () => ipcRenderer.send(CALL.fileHashCancel, id) }
  },
  folderSize: (path: string, requestId: string): Promise<FolderSizeResult | null> =>
    ipcRenderer.invoke(CALL.folderSize, path, requestId),
  folderSizesCached: (paths: string[]): Promise<Record<string, FolderSizeResult>> =>
    ipcRenderer.invoke(CALL.folderSizesCached, paths),
  refreshFolderSizes: (path: string): Promise<void> =>
    ipcRenderer.invoke(CALL.folderSizesRefresh, path),
  onFolderSizeProgress: subscribe<FolderSizeProgress>(PUSH.folderSizeProgress),
  cancelFolderSize: (requestId: string): void => ipcRenderer.send(CALL.folderSizeCancel, requestId),
  /** Sidecar subtitle tracks for a video (same name beside it, or in Subs/). */
  subsFor: (path: string): Promise<SubtitleTrack[]> =>
    ipcRenderer.invoke(CALL.subsFor, path),
  /** Choose a subtitle file by hand, for the tracks name-matching cannot find.
   *  null when the dialog was cancelled. */
  pickSubtitle: (near?: string): Promise<SubtitleTrack | null> =>
    ipcRenderer.invoke(CALL.subsPick, near),
  /** One track's text as WebVTT (SRT converted), for a <track> blob. */
  readSubs: (path: string): Promise<string | null> => ipcRenderer.invoke(CALL.subsRead, path),

  /** The waveform transport's amplitude envelope, computed by ffmpeg in main
   *  and streamed there: the renderer never holds the file. null when the
   *  file has no audio, or no ffmpeg was found. */
  mediaPeaks: (path: string): Promise<number[] | null> => ipcRenderer.invoke(CALL.mediaPeaks, path),
  /** The waveform's viewer moved on: stop that decode (2026-10-16). */
  cancelPeaks: (path: string): void => ipcRenderer.send(CALL.mediaPeaksCancel, path),
  /** Does this file's audio need Prism's own decoder (AC-3, DTS, TrueHD and
   *  friends, none of which Chromium can play), and where is it served. */
  probeMedia: (path: string): Promise<MediaProbe> => ipcRenderer.invoke(CALL.mediaProbe, path),
  /** Are Prism's entries ("Open file", "Open in Prism") in File Explorer's
   *  context menu right now? */
  shellVerbStatus: (): Promise<boolean> => ipcRenderer.invoke(CALL.shellVerbStatus),
  /** Add or remove it. Per-user, no elevation; false means Windows refused. */
  setShellVerb: (on: boolean): Promise<boolean> => ipcRenderer.invoke(CALL.shellVerbSet, on),
  /** Synthesise a MIDI score and get back a url that plays. Slow the first
   *  time (a soundfont has to load), instant afterwards. */
  synthMidi: (path: string): Promise<string | null> => ipcRenderer.invoke(CALL.audioSynth, path),
  /** An office or ebook document as sanitised HTML, ready to render.
   *  null when the file is not one, or could not be read. */
  docHtml: (path: string): Promise<string | null> => ipcRenderer.invoke(CALL.docHtml, path),
  /** Convert a video Chromium cannot show, and get back a url that plays.
   *  Resolves when the copy is ready; progress arrives on onConvertProgress. */
  convertVideo: (path: string): Promise<ConvertResult> =>
    ipcRenderer.invoke(CALL.videoConvert, path),
  /** Stop converting a file nobody is looking at any more. */
  cancelConvert: (path: string): void => ipcRenderer.send(CALL.videoCancel, path),
  onConvertProgress: subscribe<ConvertProgress>(PUSH.videoProgress),
  /** The same stream without a probe: for when the player itself noticed the
   *  audio never decoded, and can name the duration off the element. */
  audioBlind: (path: string, duration: number): Promise<string | null> =>
    ipcRenderer.invoke(CALL.audioBlind, path, duration),

  /* ----- context-menu verbs ----- */

  /** Reveal (and select) the file or folder in File Explorer. */
  showInExplorer: (path: string): void => ipcRenderer.send(CALL.fileShowInExplorer, path),
  /** Hand the file to whatever Windows has as its default app. */
  openInDefault: (path: string): void => ipcRenderer.send(CALL.fileOpenDefault, path),
  /** The Windows "how do you want to open this?" chooser. */
  openWithChooser: (path: string): void => ipcRenderer.send(CALL.fileOpenChooser, path),
  /** Apps Windows registers for this file's extension, MRU first, with icons. */
  appsFor: (path: string): Promise<OpenWithApp[]> => ipcRenderer.invoke(CALL.appsFor, path),
  /** Launch one of the apps `appsFor` listed (by its id). */
  openWith: (path: string, appId: string): Promise<boolean> =>
    ipcRenderer.invoke(CALL.fileOpenWith, path, appId),
  /** Put the real file on the clipboard, so Ctrl+V in Explorer pastes it. */
  copyFileToClipboard: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(CALL.fileCopyClip, path),
  /**
   * The PICTURE on the clipboard, not the file (2026-08-30).
   *
   * For a HEIC, a camera RAW or any of the ffmpeg-decoded formats, copying
   * the file hands the other application bytes it cannot open. This hands it
   * pixels, which is what "copy this photo" means everywhere else. Done here
   * rather than over IPC because the PNG is already in the renderer and
   * shipping a few MB through main to put it back on the clipboard buys
   * nothing.
   */
  copyImageToClipboard: (png: ArrayBuffer): boolean => {
    const img = nativeImage.createFromBuffer(Buffer.from(png))
    if (img.isEmpty()) return false
    // Under --e2e the clipboard is main's in-memory one (#356).
    if (E2E_RUN) {
      void ipcRenderer.invoke(CALL.e2eClipboard, 'writeImage', png)
      return true
    }
    clipboard.clear()
    clipboard.writeImage(img)
    return true
  },
  /**
   * Save the picture as an ordinary PNG or JPEG. Main asks where, and that
   * dialog is the consent that lets it land outside every root. Resolves with
   * where it went, or null if the dialog was cancelled or the write failed.
   */
  saveImageCopy: (
    bytes: ArrayBuffer,
    suggested: string,
    format: 'png' | 'jpeg'
  ): Promise<string | null> => ipcRenderer.invoke(CALL.imageSaveCopy, bytes, suggested, format),
  /** A multi-selection's copy: every file lands on the clipboard together. */
  copyFilesToClipboard: (paths: string[], cut = false): Promise<boolean> =>
    ipcRenderer.invoke(CALL.fileCopyClip, paths, cut),
  /** The address bar's "Copy address": the folder, with its path as text. */
  copyAddress: (path: string): Promise<boolean> => ipcRenderer.invoke(CALL.fileCopyAddress, path),
  /** Copy the file next to itself as "name (2).ext"; resolves with the new path. */
  duplicateFile: (path: string): Promise<string | null> =>
    ipcRenderer.invoke(CALL.fileDuplicate, path),
  /** Ctrl+Shift+N (#330): "New folder" (or "(2)" and on) in `dir`; the path
   *  made, or null. `name` is a redo's: the undone folder's own name. */
  newFolder: (dir: string, name?: string): Promise<string | null> =>
    ipcRenderer.invoke(CALL.fileNewFolder, dir, name),
  /** Undoing a new folder: the Recycle Bin, only while it is still empty. */
  binIfEmpty: (path: string): Promise<BinIfEmptyResult> =>
    ipcRenderer.invoke(CALL.fileBinIfEmpty, path),

  /* ----- drag and drop (#70) ----- */

  /** Undo a delete: ask Windows for these paths back out of the Recycle Bin. */
  restoreFromBin: (paths: string[]): Promise<boolean> => ipcRenderer.invoke(CALL.fileRestore, paths),
  /** Move files and folders into another folder. 'ask' reports clashes and
   *  moves nothing, so the user answers before anything happens. */
  moveEntries: (paths: string[], destDir: string, onClash: MoveOnClash): Promise<MoveResult> =>
    ipcRenderer.invoke(CALL.fileMove, paths, destDir, onClash),
  /** Put real files and folders INTO a zip, under a folder ('' is the root). */
  archiveAdd: (
    zip: string,
    srcPaths: string[],
    destFolder: string,
    keepBoth?: boolean
  ): Promise<ArchiveAddResult> => ipcRenderer.invoke(CALL.archiveAdd, zip, srcPaths, destFolder, keepBoth),
  /** Move members to another folder inside the same zip. */
  archiveMoveMembers: (
    zip: string,
    entries: string[],
    destFolder: string
  ): Promise<ArchiveMoveResult> =>
    ipcRenderer.invoke(CALL.archiveMoveMembers, zip, entries, destFolder),
  /** Extract members OUT to a real folder, keeping the shape under a folder.
   *  The extraction window (#166) is main's to open; `asksPassword` says this
   *  caller will ask for a password and try again, so a `password` ending
   *  closes the window rather than becoming its error. 'cancelled' is the
   *  window's Cancel, and 'busy' is a second extraction while one is up. */
  archiveExtractTo: (
    zip: string,
    entries: string[],
    destDir: string,
    password?: string,
    asksPassword = false
  ): Promise<ExtractToResult> =>
    ipcRenderer.invoke(CALL.archiveExtractTo, zip, entries, destDir, password, asksPassword),

  /** Members out to a folder the user picks in main's dialog (the consent
   *  that lets it write outside every root). 'cancelled' is the dialog. */
  archiveExtractMembersTo: (
    zip: string,
    entries: string[],
    password?: string
  ): Promise<ExtractPickedResult> =>
    ipcRenderer.invoke(CALL.archiveExtractMembersPicked, zip, entries, password),

  /** The system's own icon for this file's type (the user's association),
   *  as a data URL; null when Windows has none to give. */
  iconForExt: (path: string): Promise<string | null> => ipcRenderer.invoke(CALL.iconForExt, path),

  /* ----- archives (zip): list, view, rename, delete members ----- */

  /** What an archive holds, for the Properties dialog. */
  archiveStat: (path: string): Promise<ArchiveStat | null> =>
    ipcRenderer.invoke(CALL.archiveStat, path),
  /** Every entry in the archive (folders derived when the zip omits them).
   *  Answers with a REASON rather than null (2026-08-30): a 7z or rar written
   *  with encrypted file names cannot be listed without the password, and a
   *  bare null read as "corrupt archive" with nowhere to type one. */
  archiveList: (path: string, password?: string): Promise<ArchiveListing> =>
    ipcRenderer.invoke(CALL.archiveList, path, password),
  /** Extract the whole archive into a folder named after it. `here` skips the
   *  dialog and lands beside the archive; otherwise main asks where. An
   *  archive whose whole content is one folder hands that folder up rather
   *  than burying it a level deeper. Resolves with where it landed. */
  archiveExtractAll: (
    path: string,
    here = false
  ): Promise<ExtractAllResult> => ipcRenderer.invoke(CALL.archiveExtractAll, path, here),
  /** A FOLDER inside the archive, extracted whole to a temp copy, shape
   *  intact - so copying a folder gives you the folder and not a flat pile
   *  of the files that were in it. */
  archiveExtractDir: (
    path: string,
    entry: string,
    here = false
  ): Promise<ExtractDirResult> => ipcRenderer.invoke(CALL.archiveExtractDir, path, entry, here),
  /** Extract one member to temp for viewing. 'password' means one is needed
   *  or the given one is wrong; 'aes' encryption cannot be opened at all. */
  archiveExtract: (
    path: string,
    entry: string,
    password?: string
  ): Promise<MemberExtractResult> => ipcRenderer.invoke(CALL.archiveExtract, path, entry, password),
  /** Rename one member in place (same folder). A taken name refuses. */
  archiveRename: (
    path: string,
    entry: string,
    name: string,
    password?: string
  ): Promise<ArchiveRenameResult> =>
    ipcRenderer.invoke(CALL.archiveRename, path, entry, name, password),
  /** A member of a place inside an archive, unpacked for a viewer (#300).
   *  `force` is an explicit Open, past the automatic-preview limit. */
  archiveMember: (path: string, password?: string, force?: boolean): Promise<MemberAnswer> =>
    ipcRenderer.invoke(CALL.archiveMember, path, password, force),
  /** The archive card: totals and the top of the tree (#300). */
  archiveSummary: (path: string): Promise<ArchiveSummary> =>
    ipcRenderer.invoke(CALL.archiveSummary, path),
  /** A member out beside its archive, the read-only note's Extract here
   *  (#300): the extracted copy's path, to open where editing can start. */
  archiveMemberOut: (path: string): Promise<{ ok: boolean; path?: string | null }> =>
    ipcRenderer.invoke(CALL.archiveMemberOut, path),
  /** A password typed for a container a listing asked about (#300). */
  archiveRememberPassword: (container: string, password: string): Promise<boolean> =>
    ipcRenderer.invoke(CALL.archiveRememberPassword, container, password),
  /** Remove one member. Permanent - no recycle bin inside a zip. */
  archiveDelete: (path: string, entry: string): Promise<boolean> =>
    ipcRenderer.invoke(CALL.archiveDelete, path, entry),
  /** Absolute path of a dropped File (Electron removed File.path). */
  getDroppedPath: (file: File): string => webUtils.getPathForFile(file),

  /** Minimised / focused, from main: the page cannot see either for itself. */
  onWindowState: subscribe<WindowState>(PUSH.windowState),
  /** Fired when main opens a file (launch arg, drag, or a forwarded second instance). */
  onOpenFile: (cb: (p: OpenPayload) => void, onRestored?: () => void): (() => void) => {
    const offFile = subscribe<OpenPayload>(PUSH.openFile)(cb)
    const offRestored = subscribe(PUSH.openRestored)(() => onRestored?.())
    ipcRenderer.send(CALL.openListen)
    return () => {
      offFile()
      offRestored()
    }
  },
  /**
   * Something changed in a folder Prism has open, and Prism did not do it.
   *
   * `root` names which tab (two tabs can share one), `dirs` the folders that
   * actually changed. Coalesced and filtered in main; Prism's own writes are
   * muted, since the renderer refreshes after those itself.
   */
  onDirChanged: subscribe<DirChange>(PUSH.dirChanged),
  /**
   * THE EXTRACTION WINDOW'S ONE CHANNEL (2026-09-19, #166): an extraction
   * started, how far it has got, how it ended. Every route that writes
   * extracted files to a folder the user can see speaks on it, both engines
   * alike, so there is one listener and one window. It replaces
   * `onArchiveProgress`, which only the 7-Zip path of two of the five routes
   * ever fed.
   */
  onExtractEvent: subscribe<ExtractEvent>(PUSH.extractEvent),
  /** The window's Cancel. Resolves once main has stopped the work, waited
   *  for the process to be gone and removed what was half written; false
   *  when the job had already finished. */
  extractCancel: (id: string): Promise<boolean> => ipcRenderer.invoke(CALL.extractCancel, id),
  /** A followed file grew (or was truncated, which is `reset`). */
  onFileAppended: subscribe<TailEvent>(PUSH.fileAppended),

  /**
   * Open a comic book: unpack it once (cached) and answer its pages in
   * reading order, as absolute paths for mediaUrl. Read-only - a comic has
   * none of the archive panel's verbs, deliberately.
   */
  comicOpen: (
    path: string,
    password?: string
  ): Promise<ComicOpenResult> =>
    ipcRenderer.invoke(CALL.comicOpen, path, password),

  // THE DIAGNOSTICS LOG's (#322): the page's lines, its heartbeat, and
  // Settings > Diagnostics. Timing stays main-side; these calls are not timed.
  ...createDiagApi(ipcRenderer),

  /** A web link to the system browser. http(s) only, here and again in main
   *  (2026-10-26: Prism's own channel, `link:open-external`). */
  openExternal: (url: string): void => {
    if (isWebUrl(url)) ipcRenderer.send(CALL.openExternal, url)
  },

  // frameless window controls
  minimize: (): void => ipcRenderer.send(CALL.windowMinimize),
  toggleMaximize: (): void => ipcRenderer.send(CALL.windowToggleMaximize),
  /** `force` means the unsaved-changes question has already been answered. */
  close: (force = false): void => ipcRenderer.send(CALL.windowClose, force),
  /** Keep main in step with the editor, so closing can ask before it discards. */
  setDirty: (dirty: boolean): void => ipcRenderer.send(CALL.editorDirty, dirty),
  /** Something is playing: hold the screen awake until told otherwise. */
  setAwake: (on: boolean): void => ipcRenderer.send(CALL.powerAwake, on),
  /** Main blocked a close (unsaved text): ask. */
  onAskClose: subscribe(PUSH.appAskClose),
  setFullscreen: (on: boolean): void => ipcRenderer.send(CALL.windowSetFullscreen, on),
  /* ----- the update check ----- */
  // These three are the core's UpdateBridge (prism-term-core's useUpdateFlow),
  // spelled the same in Prism Terminal's preload: the chip and its window are
  // shared (#168), so App hands this whole object to the hook as it is.
  /** A newer release exists, with its notes (mock: true for a preview:
   *  `--preview-update`, or any unpackaged build outside the e2e). */
  onUpdate: (cb: (info: UpdateInfo) => void): (() => void) => {
    const off = subscribe<UpdateInfo>(PUSH.updateAvailable)(cb)
    // Ask main to replay an offer that arrived before this renderer loaded.
    ipcRenderer.send(CALL.updateAnnounce)
    return off
  },
  /** Download percentage while an update installs. */
  onUpdateProgress: subscribe<number>(PUSH.updateProgress),
  /** Download the named installer and hand off to it; the app quits under it.
   *  False when nothing was installed, which is always the case for a preview. */
  installUpdate: (url: string): Promise<boolean> => ipcRenderer.invoke(CALL.updateInstall, url),
  /** Stop the download `installUpdate` is running; it then resolves false. */
  cancelUpdate: (): void => ipcRenderer.send(CALL.updateCancel),
  /** The running app's version (package.json's), for the update window's
   *  "You have" line. */
  appVersion: (): Promise<string> => ipcRenderer.invoke(CALL.appVersion),
  /** E2E only (#322): main registers the channel under --e2e alone, so
   *  anywhere else this rejects. */
  e2eSlowIpc: (): Promise<boolean> => ipcRenderer.invoke(CALL.e2eSlowIpc),
  /** E2E only (#356): the page's clipboard, routed to main's in-memory one so
   *  a test run never touches the owner's. Absent outside --e2e. */
  e2eClipboard: E2E_RUN
    ? {
        readText: (): Promise<string> => ipcRenderer.invoke(CALL.e2eClipboard, 'readText'),
        writeText: (text: string): Promise<void> => ipcRenderer.invoke(CALL.e2eClipboard, 'writeText', text)
      }
    : undefined,
  /** Open the Windows "Default apps" page, where Prism can be chosen. */
  openDefaultApps: (): void => ipcRenderer.send(CALL.appDefaultApps),
  windowPreferencesLoad: (): WindowPreferencesSnapshot | null =>
    syncOr<WindowPreferencesSnapshot | null>(CALL.windowPreferencesLoad, null),
  windowPreferencesSeed: (values: Record<string, string>): WindowPreferencesSnapshot | null =>
    syncOr<WindowPreferencesSnapshot | null>(CALL.windowPreferencesSeed, null, values),
  windowPreferencesSet: (change: WindowPreferenceChange): boolean =>
    syncOr<unknown>(CALL.windowPreferencesSet, false, change) === true,
  onWindowPreferencesChanged: subscribe<WindowPreferencesSnapshot>(PUSH.windowPreferencesChanged),
  winEShortcutStatus: (): Promise<WinEShortcutStatus> => ipcRenderer.invoke(CALL.winEStatus),
  setWinEShortcut: (enabled: boolean): Promise<WinEShortcutStatus> => ipcRenderer.invoke(CALL.winESet, enabled),
  folderHandlerStatus: (): Promise<FolderHandlerStatus> => ipcRenderer.invoke(CALL.foldersStatus),
  setFolderHandler: (on: boolean): Promise<FolderHandlerStatus> => ipcRenderer.invoke(CALL.foldersSet, on),
  onWinEOpen: (cb: (request: { id: string; path: string | null }) => void): (() => void) => {
    const off = subscribe<{ id: string; path: string | null }>(PUSH.winEOpen)(cb)
    ipcRenderer.send(CALL.winEListen)
    return off
  },
  winEReady: (requestId: string): void => ipcRenderer.send(CALL.winEReady, requestId),
  /** True when setup asked for the first-run guide, whatever this machine has
   *  already seen. */
  forceSetup: process.argv.includes('--prism-setup'),
  /** True when the process was started with --demo. It opens one door and only
   *  that door: the recording harness can change the style while a file plays,
   *  which Settings cannot do without covering the file it is meant to show. */
  demo: process.argv.includes('--prism-demo'),
  /** Ask Windows for a translucent window material ('acrylic', 'mica', 'none'),
   *  in the given mode: DWM tints its own blur, so it has to be told. */
  setWindowMaterial: (material: string, mode: string): void =>
    ipcRenderer.send(CALL.windowMaterial, material, mode),
  /** A fullscreen transition is starting or has finished. While one is in
   *  flight the window is held OPAQUE: a translucent window has nothing behind
   *  it, so the frame where it has resized but not repainted shows the desktop. */
  setFsTransition: (active: boolean): void => ipcRenderer.send(CALL.windowFsTransition, active),
  /** Raise or fade out the display-covering black shroud. The in-window veil
   *  cannot touch the taskbar or the desktop around the window; the shroud
   *  fades them on the same clock. */
  setFsShroud: (up: boolean): void => ipcRenderer.send(CALL.windowFsShroud, up),
  onFullscreen: subscribe<boolean>(PUSH.windowFullscreen),
  /** THE NATIVE SWEEP BOX (#338): the page hands main the box's anchor, clip
   *  and colours at a sweep's start and when the list moves under it (never
   *  per pointer move), and hears whether the box is drawn natively. */
  sweepOverlay: {
    begin: (m: SweepBegin): void => ipcRenderer.send(SWEEP_CHANNELS.begin, m),
    update: (m: SweepUpdate): void => ipcRenderer.send(SWEEP_CHANNELS.update, m),
    end: (m: SweepEnd): void => ipcRenderer.send(SWEEP_CHANNELS.end, m),
    onState: subscribe<SweepState>(SWEEP_CHANNELS.state)
  }
}

contextBridge.exposeInMainWorld('prism', api)

export type PrismApi = typeof api
