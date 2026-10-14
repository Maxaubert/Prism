/**
 * THE PHONE'S WIRE, ONCE (structure cleanup, 2026-10-12): the URL shapes the
 * phone server answers (`main/phone/server.ts`, `routes.ts`) and the page asks
 * for (`renderer/src/phone`), and the answers that are not already a bridge
 * shape. Both sides read this file, so a route renamed on one side is a type
 * error on the other rather than a 404 on a phone.
 */
import type { FileStat } from './ipcTypes'
import type { FileMemory } from './types'
import type { BrowseDriveUsage } from './browse'

/** Pairing: a code and a name, POSTed. Needs no token. */
export const PHONE_PAIR = '/pair'
/** Every JSON route sits under this; the name follows it. */
export const PHONE_API = '/api/'
/** Media bytes by path, through the same handler as fsmedia://. */
export const PHONE_MEDIA = '/m/'
/** A live transcode's playlist and segments, by job id. */
export const PHONE_HLS = '/hls/'

/** The route names after `/api/`, as the server's switch reads them. */
export const ROUTE = {
  play: 'play',
  me: 'me',
  places: 'places',
  pos: 'pos',
  diag: 'diag',
  search: 'search',
  dir: 'dir',
  thumb: 'thumb',
  stat: 'stat',
  subs: 'subs',
  subsRead: 'subs/read',
  text: 'text',
  doc: 'doc',
  comic: 'comic',
  archive: 'archive',
  archiveExtract: 'archive/extract'
} as const
export type RouteName = (typeof ROUTE)[keyof typeof ROUTE]

/** A route's path, `/api/<name>`. */
export const routePath = (name: RouteName): string => `${PHONE_API}${name}`
/** A file's media path, `/m/<encoded path>`; the token goes in the query. */
export const mediaPath = (path: string): string => `${PHONE_MEDIA}${encodeURIComponent(path)}`
/** A job's playlist, `/hls/<job>/index.m3u8`. */
export const hlsPlaylistPath = (job: string): string => `${PHONE_HLS}${job}/index.m3u8`

/** A track the PC's probe found, as `/api/play` lists them (#120). */
export interface PlayTrack {
  index: number
  codec: string
  channels: number
  language: string
  title: string
}

/**
 * What `/api/play` answers (#105): direct is the `/m/` url the viewers
 * already build for themselves, hls is a playlist url Prism serves from a
 * live transcode, none is a reason. `audioOnly` is what tells the shim
 * which reused hook the playlist belongs to.
 */
export type PlayAnswer =
  | { mode: 'direct'; url: string; fps: number | null; duration: number }
  | {
      mode: 'hls'
      url: string
      copyVideo: boolean
      audioOnly: boolean
      fps: number | null
      duration: number
      /** Every audio track the file holds, and which one this stream carries. */
      tracks?: PlayTrack[]
      audio?: number | null
    }
  | { mode: 'none'; reason: string }

/** `/api/me`. `name` is this PHONE's, as the PC lists it; `here` is the
 *  folder it was last in, null for This PC (2026-10-14: the phone is in a
 *  folder anywhere on the PC, not on a tab). */
export interface Me {
  name: string
  here: string | null
}

/** `/api/stat`: what `file:stat` answers, without the dates the phone has no use for. */
export type PhoneStat = Pick<FileStat, 'size' | 'mtimeMs' | 'isFolder'>

/** `/api/pos` read: what the PC remembers about the file, `t` always present. */
export type PosAnswer = Omit<FileMemory, 't'> & { t: number | null }

/** A Quick access place: a Known Folder or one of the user's own pins. */
export interface PhonePlace {
  name: string
  path: string
  /** Which Known Folder it is; absent for a pin. */
  known?: string
}

/** A drive on This PC, with what the Explorer's drive rows show (label,
 *  kind, size and free space, each absent when Windows did not say). */
export type PhoneDrive = { name: string } & BrowseDriveUsage

/** `/api/places`: the drawer and the This PC page, the Explorer's places. */
export interface PlacesAnswer {
  quick: PhonePlace[]
  drives: PhoneDrive[]
}

/** `/pair`: the phone's token and the folder it starts in (null: This PC). */
export interface PairAnswer {
  token: string
  here: string | null
}

/** `/api/doc`: an office or ebook document as sanitised HTML. */
export interface DocAnswer {
  html: string
}
