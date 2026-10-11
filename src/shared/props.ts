/**
 * What the Properties window asks main for, beyond `file:stat` (owner,
 * 2026-10-12; spec `docs/superpowers/specs/2026-10-12-properties-window-design.md`).
 * Every field is optional: a fact main could not read is left out, never guessed.
 */

/** ffprobe's answer for a video or a song (`props:media`). */
export interface MediaProps {
  /** Seconds. */
  duration?: number
  /** Bits per second, the container's. */
  bitrate?: number
  video?: {
    width: number
    height: number
    fps?: number
    /** "H.264", "HEVC (H.265)", "AV1"... */
    codec: string
    /** "High", "Main 10"... */
    profile?: string
    bitDepth?: number
    /** "HDR10", "HLG", or absent for SDR. */
    hdr?: string
  }
  audio: Array<{
    language?: string
    title?: string
    /** "AAC", "FLAC", "TrueHD"... */
    codec: string
    channels?: number
    /** "stereo", "5.1(side)"... */
    layout?: string
    sampleRate?: number
    bitDepth?: number
  }>
  subtitles: Array<{ language?: string; title?: string; codec?: string }>
  /** Music tags, from the container's own. */
  tags: {
    title?: string
    artist?: string
    album?: string
    year?: string
    track?: number
    trackTotal?: number
    genre?: string
  }
  /** The file carries a picture of its own (an attached cover). */
  cover: boolean
}

/** The first 64 KB of a text file, read as bytes (`props:text`). */
export interface TextProps {
  /** "UTF-8", "UTF-16 LE", "UTF-16 BE", "Windows-1252". */
  encoding: string
  bom: boolean
  eol: 'LF' | 'CRLF' | 'CR' | 'Mixed' | 'None'
}

/** A drive's own facts and its top-level folders (`drive:details`). */
export interface DriveDetails {
  /** The disk's model with underscores read as spaces: "WD BLACK SN850X 8000GB". */
  model?: string
  /** "NVMe", "SATA", "USB"... */
  bus?: string
  /** "SSD", "HDD", or absent when Windows does not say. */
  media?: string
  /** "NTFS", "exFAT"... */
  fs?: string
  label?: string
  total?: number
  free?: number
  /** The root's folders with their sizes from the search index, biggest first;
   *  null when the index could not answer. */
  folders: Array<{ path: string; name: string; bytes: number }> | null
}
