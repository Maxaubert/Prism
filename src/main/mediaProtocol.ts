import { createReadStream } from 'fs'
import { stat, readFile } from 'fs/promises'
import { Readable } from 'stream'
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
  /** The bundled ffmpeg, for the stills Chromium cannot draw. */
  ffmpeg: () => FfmpegTools | null
  /** A HEIC still as JPEG (heicClient.ts). */
  heic: (p: string, mtimeMs: number) => Promise<Buffer>
}

/**
 * fsmedia:// (stage 9b of the structure cleanup, 2026-10-12, out of index.ts):
 * serve a local file honouring Range requests (206), so media can seek. Camera
 * raws, HEIC and the stills only ffmpeg reads are converted first. The phone's
 * `/m/` route answers through the same function. Mirrors Filesmith's
 * serveMedia; becomes part of prism-core in Phase 1.
 */
export function createMediaServer(deps: MediaServerDeps): (request: Request) => Promise<Response> {
  return async function serveMedia(request: Request): Promise<Response> {
    let filePath: string
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname).slice(1)
    } catch {
      return new Response(null, { status: 400 })
    }
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
        return new Response(jpeg, {
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
          return new Response(png, {
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
        return new Response(jpeg, {
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
    // so hand back one buffer instead of a stream — measured, the stream plumbing (not
    // the decode) dominated their load time. The cap is deliberately low: a single
    // large buffer crosses the process boundary as one IPC message, and tracing a
    // 40 MB image showed a 1.2s "Receive mojo message" stall in the renderer. Bigger
    // files stream, arriving in chunks that never block.
    if (type.startsWith('image/') && size <= 8 * 1024 * 1024) {
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

    const range = request.headers.get('range')
    const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : size - 1
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= size) end = size - 1
      if (start > end) start = end
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
    return new Response(body(open()), {
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
