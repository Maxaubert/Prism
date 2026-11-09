/**
 * The desktop's thumbnails on the wire (Stage 2 of the zoom grid, 2026-11-09).
 * `thumbs:want` carries tile pictures the page wants, `thumbs:ready` what main
 * made, as `fsmedia://thumb/<key>` URLs. The page never sees a file path to
 * a thumbnail (mediaProtocol.ts answers that host from the cache folder only).
 */

/** The two sizes made: 320 is the phone's own (shared), 640 is for a big tile
 *  on a dense screen. Chosen by tile edge x devicePixelRatio (`tierFor`). */
export type ThumbTier = 320 | 640

export interface ThumbWant {
  path: string
  tier: ThumbTier
}

/** `null` is "no picture": corrupt, unsupported, timed out. The tile keeps its icon. */
export interface ThumbResult {
  path: string
  url: string | null
}

export interface ThumbsReady {
  /** The page's counter of its asks: an older generation is ignored. */
  gen: number
  results: ThumbResult[]
}

export interface ThumbsWantReply {
  /** Cache hits (a url) and remembered failures (null), answered at once. */
  ready: Record<string, string | null>
}

/** A thumbnail's name in the cache folder: 40 hex and .jpg or .webp. */
export const THUMB_KEY_RE = /^[0-9a-f]{40}\.(jpg|webp)$/
