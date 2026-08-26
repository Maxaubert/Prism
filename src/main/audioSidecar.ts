import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import {
  findFfmpeg,
  parseRange,
  sidecarArgs,
  sidecarSize,
  timeForByte,
  wavHeader,
  WAV_HEADER_BYTES
} from './ffmpeg'

/**
 * fsaudio:// - a track Chromium cannot decode, served as a seekable WAV.
 *
 * The response is a fiction with real bytes behind it: a 44-byte header, then
 * PCM produced on demand by an ffmpeg started at whatever timestamp the
 * requested byte range stands for. Because the byte rate is constant
 * (see ffmpeg.ts), Chromium's own seeking works unchanged - it asks for a byte
 * offset, and we answer with the audio that belongs there.
 *
 * URL: fsaudio://track/<encoded path>?s=<stream index>&d=<duration seconds>
 */

export const AUDIO_SCHEME = 'fsaudio'

export interface SidecarRequest {
  file: string
  stream: number
  duration: number
}

/** Pull the three things the stream needs out of the URL. null = malformed. */
export function parseSidecarUrl(raw: string): SidecarRequest | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  let file: string
  try {
    file = decodeURIComponent(url.pathname).replace(/^\//, '')
  } catch {
    return null
  }
  if (!file) return null
  const stream = Number(url.searchParams.get('s'))
  const duration = Number(url.searchParams.get('d'))
  // -1 is FIRST_AUDIO: the blind route, where nothing probed the container.
  if (!Number.isInteger(stream) || stream < -1) return null
  if (!Number.isFinite(duration) || duration <= 0) return null
  return { file, stream, duration }
}

// Every ffmpeg this module has running. A seek abandons the response mid-flight
// (Chromium simply drops it), and an orphaned decoder would sit there filling a
// pipe nobody reads, so cancellation kills, and so does quitting.
const live = new Set<ChildProcessWithoutNullStreams>()

export function killSidecars(): void {
  for (const p of live) p.kill()
  live.clear()
}

interface Deps {
  /** The root wall: only files the window may see get decoded. */
  allowed: (p: string) => boolean
  packaged: boolean
  resourcesPath: string
  appPath: string
}

export function serveSidecarAudio(request: Request, deps: Deps): Response {
  const req = parseSidecarUrl(request.url)
  if (!req) return new Response(null, { status: 400 })
  if (!deps.allowed(req.file) || !existsSync(req.file)) return new Response(null, { status: 403 })

  const tools = findFfmpeg(deps.packaged, deps.resourcesPath, deps.appPath)
  if (!tools) return new Response(null, { status: 503 })

  const total = sidecarSize(req.duration)
  const range = parseRange(request.headers.get('range'), total)
  if (request.headers.get('range') && !range) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? total - 1
  const length = end - start + 1

  let proc: ChildProcessWithoutNullStreams | null = null
  let sent = 0

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // The header only exists at the front of the stream; a seek lands past it.
      if (start < WAV_HEADER_BYTES) {
        const head = wavHeader(total - WAV_HEADER_BYTES).subarray(start, Math.min(WAV_HEADER_BYTES, end + 1))
        if (head.length) {
          controller.enqueue(new Uint8Array(head))
          sent += head.length
        }
      }
      if (sent >= length) {
        controller.close()
        return
      }

      const at = timeForByte(Math.max(start, WAV_HEADER_BYTES))
      const child = spawn(tools.ffmpeg, sidecarArgs(req.file, req.stream, at), { windowsHide: true })
      proc = child
      live.add(child)

      const done = (): void => {
        live.delete(child)
        child.kill()
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (sent >= length) return
        const take = chunk.length > length - sent ? chunk.subarray(0, length - sent) : chunk
        sent += take.length
        try {
          controller.enqueue(new Uint8Array(take))
        } catch {
          done() // the consumer went away between chunks
          return
        }
        // Backpressure: Chromium buffers a bounded window, and without this
        // ffmpeg would decode a whole film into memory at 200x realtime.
        if ((controller.desiredSize ?? 1) <= 0) child.stdout.pause()
        if (sent >= length) {
          done()
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
      })
      child.stdout.on('end', () => {
        done()
        try {
          // Short by a frame or two at the very end of a file: pad rather than
          // break the promised Content-Length, which Chromium reads as an error.
          if (sent < length) controller.enqueue(new Uint8Array(length - sent))
          controller.close()
        } catch {
          /* already closed */
        }
      })
      child.on('error', () => {
        done()
        try {
          controller.error(new Error('ffmpeg failed to start'))
        } catch {
          /* already gone */
        }
      })
      // stderr is drained and dropped: an unread pipe blocks the child.
      child.stderr.resume()
    },
    pull() {
      proc?.stdout.resume()
    },
    cancel() {
      if (proc) {
        live.delete(proc)
        proc.kill()
      }
    }
  })

  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(length),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${total}` } : {})
    }
  })
}
