import { open, stat } from 'fs/promises'
import { sniffEncoding, type TextEncoding } from './textFile'

/**
 * Following a file that is still being written (2026-08-31).
 *
 * A build log, a server's output, an agent's transcript: files whose whole
 * point is that they grow. Prism read them once and showed you a snapshot,
 * and the folder watcher (which is a DIRECTORY watcher, deliberately, and
 * scoped to the root set by construction) could not help - it says a folder
 * changed, never what a file now contains.
 *
 * So this is its own thing, and small on purpose: an offset, a poll, and a
 * read of exactly the bytes that appeared. Never sync - main is one thread
 * and a tail that stats synchronously every half second stops every window,
 * every IPC reply and the Range handler a playing film depends on.
 *
 * Two things are easy to get wrong and are handled here rather than in the
 * renderer. A chunk boundary can fall in the MIDDLE of a character, so the
 * decoder is a streaming one and the trailing partial bytes are held for the
 * next read. And a file can SHRINK - a log rotated, a build starting over -
 * which is not a chunk at all; it is reported as a reset so the reader can
 * start again rather than splicing new bytes onto an old tail.
 */

/** The decoder name for a shape we sniffed. */
function decoderFor(enc: TextEncoding): string {
  if (enc === 'utf16le') return 'utf-16le'
  if (enc === 'utf16be') return 'utf-16be'
  return 'utf-8'
}

export interface TailEvent {
  path: string
  /** New text, already decoded and normalised to LF. Empty on a reset. */
  text: string
  /** The file got shorter: rotated, truncated, replaced. Start again. */
  reset: boolean
}

interface Watch {
  path: string
  /** Its place in `watches`: the owner and the path. */
  key: string
  offset: number
  timer: ReturnType<typeof setInterval>
  decoder: TextDecoder
  /** Reads in flight, so a slow read never overlaps the next tick. */
  busy: boolean
  /** A backlog was skipped: drop text up to the first line break. */
  fragment?: boolean
}

const watches = new Map<string, Watch>()

/** Half a second: fast enough to read like a live log, slow enough that a
 *  dozen idle tails cost nothing. */
const POLL_MS = 500

const key = (p: string, owner = ''): string => `${owner}\u0000${p.toLowerCase()}`

/** The most one poll reads (review, 2026-10-28). */
export const TAIL_CHUNK = 4 * 1024 * 1024
/** A backlog past this (the editor's 64 MB text cap) is skipped, not read. */
export const TAIL_BACKLOG_MAX = 64 * 1024 * 1024
/** Where a skip starts again: the size of the tail CodeView shows first. */
export const TAIL_SKIP_TO = 2 * 1024 * 1024

async function pump(w: Watch, emit: (e: TailEvent) => void): Promise<void> {
  if (w.busy) return
  w.busy = true
  let more = false
  try {
    const st = await stat(w.path)
    if (st.size < w.offset) {
      // Shorter than it was. Splicing the new bytes onto the old tail would
      // produce a document that never existed.
      w.offset = st.size
      w.decoder = new TextDecoder(w.decoder.encoding, { fatal: false })
      emit({ path: w.path, text: '', reset: true })
      return
    }
    if (st.size === w.offset) return
    if (st.size - w.offset > TAIL_BACKLOG_MAX) {
      // More arrived than the editor would ever be handed whole (the 64 MB
      // text cap): start again from the file's last part, as its first
      // read did, rather than allocate and send the lot.
      w.offset = st.size - TAIL_SKIP_TO
      w.decoder = new TextDecoder(w.decoder.encoding, { fatal: false })
      w.fragment = true
      emit({ path: w.path, text: '', reset: true })
    }
    // ONE BOUNDED READ A TURN (review, 2026-10-28): the whole delta used to be
    // one allocation and one message, however much a log had grown.
    const want = Math.min(st.size - w.offset, TAIL_CHUNK)
    const buf = Buffer.allocUnsafe(want)
    const fh = await open(w.path, 'r')
    try {
      const { bytesRead } = await fh.read(buf, 0, buf.length, w.offset)
      w.offset += bytesRead
      // `stream: true` holds a partial character back for the next chunk,
      // which is the whole reason the decoder lives on the watch.
      let text = w.decoder.decode(buf.subarray(0, bytesRead), { stream: true })
      if (w.fragment) {
        // After a skip the first line is a fragment, as readTail drops its own.
        const nl = text.indexOf('\n')
        text = nl >= 0 ? text.slice(nl + 1) : ''
        if (nl >= 0) w.fragment = false
      }
      // CodeMirror rejoins its document with \n, so a CRLF log tailed as-is
      // grows a stray \r at the end of every appended line.
      if (text) emit({ path: w.path, text: text.replace(/\r\n/g, '\n'), reset: false })
      more = bytesRead > 0 && w.offset < st.size
    } finally {
      await fh.close().catch(() => {})
    }
  } catch {
    // Gone, locked, or on a volume that went away. The watch stays: a log
    // being rotated is exactly this, and it comes back.
  } finally {
    w.busy = false
  }
  // The rest of a backlog follows at once, a chunk a turn, while it is still followed.
  if (more)
    setImmediate(() => {
      if (watches.get(w.key) === w) void pump(w, emit)
    })
}

/**
 * Follow `path` from `from` bytes in, calling `emit` with each new chunk.
 *
 * `from` is what the reader has already seen. A negative or oversized offset
 * is clamped to the file's current size, which means "from here on".
 */
export async function startTail(
  path: string,
  from: number,
  emit: (e: TailEvent) => void,
  /** Who follows it (tab tear-off step 1, 2026-10-29): one tail per path PER
   *  WINDOW, so one window's stop never freezes another's live log, and a
   *  window that closes stops only its own (`stopTailsOf`). */
  owner = ''
): Promise<boolean> {
  stopTail(path, owner)
  try {
    const st = await stat(path)
    if (!st.isFile()) return false
    const offset = Math.min(Math.max(0, Math.floor(from)), st.size)
    // The encoding is the file's own, sniffed from its byte-order mark - the
    // same BOM-only rule the editor's read uses.
    const fh = await open(path, 'r')
    const head = Buffer.alloc(4)
    await fh.read(head, 0, 4, 0)
    await fh.close().catch(() => {})
    const w: Watch = {
      path,
      key: key(path, owner),
      offset,
      busy: false,
      decoder: new TextDecoder(decoderFor(sniffEncoding(head)), { fatal: false }),
      timer: setInterval(() => void pump(w, emit), POLL_MS)
    }
    watches.set(w.key, w)
    // One read straight away, so anything written between the reader's own
    // read and this call is not silently lost.
    void pump(w, emit)
    return true
  } catch {
    return false
  }
}

export function stopTail(path: string, owner = ''): void {
  const w = watches.get(key(path, owner))
  if (!w) return
  clearInterval(w.timer)
  watches.delete(w.key)
}

/** Every tail one owner (a window) follows, dropped: that window closed. */
export function stopTailsOf(owner: string): void {
  for (const [k, w] of watches)
    if (k.startsWith(`${owner}\u0000`)) {
      clearInterval(w.timer)
      watches.delete(k)
    }
}

/** Every tail, dropped. For quitting, and for a root wall that narrowed. */
export function stopAllTails(): void {
  for (const w of watches.values()) clearInterval(w.timer)
  watches.clear()
}

export interface TailRead {
  text: string
  /** Byte offset the returned text starts at. */
  from: number
  /** The whole file's size in bytes, which is what the banner reports. */
  size: number
}

/**
 * The LAST `maxBytes` of a file, as text.
 *
 * For the files the editor refuses outright: over 64MB it will not be handed
 * across the bridge as one string, and the honest answer used to be an
 * overlay saying so. The tail is the useful half of a 900MB log.
 *
 * The start offset is walked forward off a partial character AND off a
 * partial line, because a tail that begins mid-word reads as a corrupt file.
 */
export async function readTail(path: string, maxBytes: number): Promise<TailRead | null> {
  try {
    const st = await stat(path)
    if (!st.isFile()) return null
    const fh = await open(path, 'r')
    try {
      const head = Buffer.alloc(4)
      await fh.read(head, 0, 4, 0)
      const enc = sniffEncoding(head)
      let from = Math.max(0, st.size - maxBytes)
      // UTF-16 is two bytes a unit: an odd offset decodes the whole tail as
      // nonsense rather than as slightly-wrong text.
      if ((enc === 'utf16le' || enc === 'utf16be') && from % 2 === 1) from += 1
      const buf = Buffer.alloc(Number(Math.min(maxBytes, st.size - from)))
      const { bytesRead } = await fh.read(buf, 0, buf.length, from)
      let text = new TextDecoder(decoderFor(enc), { fatal: false }).decode(buf.subarray(0, bytesRead))
      if (from > 0) {
        // The replacement character is what a partial UTF-8 sequence decodes
        // to; either way the first line is a fragment, so it goes.
        const nl = text.indexOf('\n')
        text = nl >= 0 ? text.slice(nl + 1) : text
      }
      return { text: text.replace(/\r\n/g, '\n'), from, size: st.size }
    } finally {
      await fh.close().catch(() => {})
    }
  } catch {
    return null
  }
}
