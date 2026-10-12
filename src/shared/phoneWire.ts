/**
 * THE PHONE'S WIRE, ONCE (structure cleanup, 2026-10-12): the URL shapes the
 * phone server answers (`main/phone/server.ts`, `routes.ts`) and the page asks
 * for (`renderer/src/phone`), and the answers that are not already a bridge
 * shape. Both sides read this file, so a route renamed on one side is a type
 * error on the other rather than a 404 on a phone.
 */
import type { FileStat } from './ipcTypes'
import type { FileMemory, PhoneTab } from './types'

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
  tabs: 'tabs',
  tab: 'tab',
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

/** `/api/me`. `name` is this PHONE's, as the PC lists it; `folder` is the
 *  name of the TAB it is on, which main spells so the header and the tab
 *  list agree. */
export interface Me {
  root: string
  open: boolean
  name: string
  folder: string
}

/** `/api/stat`: what `file:stat` answers, without the dates the phone has no use for. */
export type PhoneStat = Pick<FileStat, 'size' | 'mtimeMs' | 'isFolder'>

/** `/api/pos` read: what the PC remembers about the file, `t` always present. */
export type PosAnswer = Omit<FileMemory, 't'> & { t: number | null }

/** `/api/tabs`: the folders the PC has open right now. */
export interface TabsAnswer {
  tabs: PhoneTab[]
}

/** `/api/tab`: the root the phone moved to, in the PC's own spelling. */
export interface TabMoved {
  root: string
  name: string
}

/** `/pair`: the phone's token and the root it is on. */
export interface PairAnswer {
  token: string
  root: string
}

/** `/api/doc`: an office or ebook document as sanitised HTML. */
export interface DocAnswer {
  html: string
}
