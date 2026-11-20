import type { DirChange, OpenPayload, TextRead } from '@shared/types'
import type { createArchiveBrowse } from '../archiveBrowse'
import type { MediaInfo } from '../ffmpeg'
import type { FolderSizeCache } from '../folderSizeCache'
import type { createExplorerListings } from '../explorerListing'
import type { createListingCache } from '../listingCache'
import type { LiveVideo } from '../liveVideo'
import type { MemberTemp } from '../memberTemp'
import type { createPathWall } from '../pathWall'
import type { Positions } from '../positions'
import type { createShellVerbSetting } from '../shellVerbSetting'
import type { SavedTabs } from '../tabs'
import type { TextShape } from '../textFile'
import type { createWinERequests } from '../winERequests'
import type { createWindowPreferences } from '../windowPreferences'

type Wall = ReturnType<typeof createPathWall>

/**
 * What the IPC handlers in ipc/ reach that main holds (stage 9d of the
 * structure cleanup, 2026-10-12): index.ts's own state and helpers, handed to
 * every register function. A `let` that changes is never copied in here (the
 * handler would hold a stale value); it is read through a function instead.
 *
 * The type lives HERE since #538 item 6: it used to be `typeof ctx` in
 * index.ts, which made every ipc/ file import a type back from the file that
 * imports them. index.ts builds `const ctx: MainCtx` and is checked against it.
 */
export interface MainCtx {
  // The root wall (pathWall.ts) and its guards.
  wall: Wall
  readable: Wall['readable']
  editable: Wall['editable']
  movable: Wall['movable']
  archiveOk: Wall['archiveOk']
  archiveReadOk: Wall['archiveReadOk']
  comicOk: Wall['comicOk']
  // Places inside archives, their passwords, and where members are unpacked.
  archives: ReturnType<typeof createArchiveBrowse>
  archivePasswords: Map<string, string>
  memberTemp: MemberTemp
  // The Explorer's listings and folder sizes, and the folder watch.
  explorerListings: ReturnType<typeof createExplorerListings>
  listingCache: ReturnType<typeof createListingCache>
  folderSizes: FolderSizeCache
  warmIndexer: (root?: string) => Promise<void>
  folderChanged: (change: DirChange) => void
  SLOW_SETUP_MS: number
  SLOW_SCAN_MS: number
  // Prism's own writes: sizes refreshed.
  written: (...paths: Array<string | null | undefined>) => Promise<void>
  // Opening: the payload builders, a web link, picked subtitles.
  buildPayload: (p: string, root?: string) => Promise<OpenPayload | null>
  openLink: (url: string) => void
  pickedSubs: Set<string>
  // Text files: the size cap and the shape each arrived with.
  TEXT_MAX_BYTES: number
  textShape: Map<string, TextShape>
  // The window, its preferences and the session.
  windowPreferences: ReturnType<typeof createWindowPreferences>
  preferencesOwner: string
  winERequests: ReturnType<typeof createWinERequests>
  shellVerbSetting: ReturnType<typeof createShellVerbSetting>
  reportTabs: (sender: Electron.WebContents, state: SavedTabs) => void
  keepAwake: (sender: { id: number }, on: boolean) => void
}

/** What only exists once the app is ready: made in whenReady and handed to
 *  the register functions that need it, beside `ctx`. */
export interface ReadyCtx {
  /** Where you had got to in each film (#118). */
  positions: Positions
  /** `file:text`'s body, shared with the phone's `/api/text`. */
  readTextWalled: (p: string) => Promise<TextRead>
  /** One ffprobe per file while it is unchanged, shared with the phone. */
  probeCached: (p: string) => Promise<MediaInfo | null>
  /** `doc:html`'s body, shared with the phone. */
  docHtmlOf: (p: string) => Promise<string | null>
  /** The desktop's live transcode (liveVideo.ts); null without ffmpeg. */
  live: LiveVideo | null
}