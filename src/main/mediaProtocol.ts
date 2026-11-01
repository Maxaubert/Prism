import { createReadStream } from 'fs'
import { stat, readFile } from 'fs/promises'
import { Readable } from 'node:stream'
import { parseByteRange } from './byteRange'
import type { FfmpegTools } from './ffmpeg'
import { isHeic } from './heicClient'
import { decodeImage, needsImageDecode, tiffPages } from './imageDecode'
import { mediaMime } from './mime'
import { isRaw, rawPreview } from './rawPreview'

/** The scheme the renderer loads every local file through. */
export const MEDIA_SCHEME = 'fsmedia'

export interface MediaServerDeps {
  /** The wall (pathWall.ts `mediaAllowed`): media may only be served from a
   *  root, from an archive member main extracted on request, or from
   *  something main made itself (2026-08-28). The fsaudio:// sibling has
   *  always been walled; this one was not, which was an accident of the two
   *  handlers being written a month apart rather than a decision. */
  allowed: (p: string) => boolean
  /** Resolve the path off main's thread before `allowed` reads it (review,
   *  2026-10-28): every Range request of a playing video asks the wall, and
   *  its realpath was a native call on main each time. */
  warm?: (p: string) => Promise<void>
  /** The bundled ffmpeg, for the stills Chromium cannot draw. */
  ffmpeg: () => FfmpegTools | null
  /** A HEIC still as JPEG (heicClient.ts). */
  heic: (p: string, mtimeMs: number) => Promise<Buffer>
}

/** Past this a whole buffer is one IPC message, and tracing a 40 MB image
 *  showed a 1.2s "Receive mojo message" stall in the renderer (see below). */
export const WHOLE_BUFFER_MAX = 8 * 1024 * 1024
const CHUNK = 1024 * 1024

/**
 * A picture main MADE (a decoded TIFF or PSD, a raw's preview, a HEIC), as a
 * response body: whole when small, in 1 MB chunks above the 8 MB rule
 * (review, 2026-10-16). Those used to go back as one buffer of any size, so a
 * big scan froze the renderer for the second the file's own rule was there to
 * prevent.
 */
export function madeImageBody(buf: Buffer): Buffer | ReadableStream<Uint8Array> {
  if (buf.length <= WHOLE_BUFFER_MAX) return buf
  let at = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= buf.length) {
        controller.close()
        return
      }
      controller.enqueue(buf.subarray(at, Math.min(buf.length, at + CHUNK)))
      at += CHUNK
    }
  })
}

/**
 * fsmedia:// (stage 9b of the structure cleanup, 2026-10-12, out of index.ts):
 * serve a local file honouring Range requests (206), so media can seek. Camera
 * raws, HEIC and the stills only ffmpeg reads are converted first. The phone's
 * `/m/` route answers through the same function. Mirrors Filesmith's
 * serveMedia; becomes part of prism-core in Phase 1.
 */
export function createMediaServer(deps: MediaServerDeps): (request: Request) => Promise<Response> {
  // THE HANDLER NEVER THROWS (#23, 2026-11-01): protocol.handle has no catch
  // of its own, so anything that throws below (a 0-byte file's ranged read
  // was one) is a 500 here, with no body. The wall is asked first inside, so
  // a wall that throws serves nothing either.
  return async function serveMedia(request: Request): Promise<Response> {
    try {
      return await answer(request)
    } catch {
      return new Response(null, { status: 500 })
    }
  }
  async function answer(request: Request): Promise<Response> {
    let filePath: string
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
    } catch {
      return new Response(null, { status: 400 })
    }
    await deps.warm?.(filePath)
    if (!deps.allowed(filePath)) return new Response(null, { status: 403 })
    // Async since the phone server (2026-09-06) started answering a LAN's
    // worth of Range requests through here: a sync stat on main's one thread
    // was cheap for one window and is the wrong shape for many phones.
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(filePath)
    } catch {
      return new Response(null, { status: 404 })
    }

    // Camera raw: the full-size JPEG the camera embedded, which is what every
    // fast viewer shows. Developing the sensor data is another program's job.
    if (isRaw(filePath)) {
      try {
        const jpeg = await rawPreview(filePath, st.mtimeMs)
        return new Response(madeImageBody(jpeg), {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(jpeg.length),
            'Access-Control-Allow-Origin': '*'
          }
        })
      } catch {
        return new Response(null, { status: 415 }) // no preview inside it
      }
    }
    // Stills Chromium cannot draw (Targa, PCX, Photoshop, OpenEXR, DDS...) come
    // back as PNG from the bundled ffmpeg.
    if (needsImageDecode(filePath)) {
      const tools = deps.ffmpeg()
      if (tools) {
        try {
          const png = await decodeImage(tools.ffmpeg, filePath, st.mtimeMs)
          // A multi-page TIFF shows its first page and nothing said so. ffmpeg
          // cannot reach page 2 at all, so this is a hint rather than a picker -
          // scans and faxes arrive this way constantly, and silence there is
          // how someone misses eleven pages of a document.
          const pages = /\.tiff?$/i.test(filePath) ? await tiffPages(filePath) : 1
          return new Response(madeImageBody(png), {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
              'Content-Length': String(png.length),
              'Access-Control-Allow-Origin': '*',
              // fsmedia:// is a different origin from the renderer, so without
              // the expose header res.headers.get() reads null and the hint
              // silently never appears.
              ...(pages > 1
                ? {
                    'X-Prism-Pages': String(pages),
                    'Access-Control-Expose-Headers': 'X-Prism-Pages'
                  }
                : {})
            }
          })
        } catch {
          return new Response(null, { status: 415 }) // a still even ffmpeg refused
        }
      }
    }
    if (isHeic(filePath)) {
      try {
        const jpeg = await deps.heic(filePath, st.mtimeMs)
        return new Response(madeImageBody(jpeg), {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(jpeg.length),
            'Access-Control-Allow-Origin': '*'
          }
        })
      } catch {
        return new Response(null, { status: 415 }) // couldn't decode this HEIC
      }
    }

    const size = st.size
    const type = mediaMime(filePath)

    // Small images are consumed whole by the renderer and never issue Range requests,
    // so hand back one buffer instead of a stream. Measured: the stream plumbing (not
    // the decode) dominated their load time. The cap is deliberately low: a single
    // large buffer crosses the process boundary as one IPC message, and tracing a
    // 40 MB image showed a 1.2s "Receive mojo message" stall in the renderer. Bigger
    // files stream, arriving in chunks that never block.
    if (type.startsWith('image/') && size <= WHOLE_BUFFER_MAX) {
      try {
        const buf = await readFile(filePath)
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': type,
            'Content-Length': String(buf.length),
            'Access-Control-Allow-Origin': '*'
          }
        })
      } catch {
        return new Response(null, { status: 404 })
      }
    }
    const open = (opts?: { start: number; end: number }): NodeJS.ReadableStream => {
      const s = createReadStream(filePath, opts)
      s.on('error', () => s.destroy())
      return s
    }
    const body = (s: NodeJS.ReadableStream): ReadableStream =>
      Readable.toWeb(s as Readable) as unknown as ReadableStream

    // A 0-byte file has no byte to stream (end would be -1, #23): an empty
    // answer, or a 416 for any range asked of it (below).
    const range = parseByteRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' }
      })
    }
    if (range) {
      const { start, end } = range
      return new Response(body(open({ start, end })), {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      })
    }
    return new Response(size === 0 ? null : body(open()), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*'
      }
    })
  }
}
