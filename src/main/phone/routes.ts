/**
 * The phone server's URL shapes (2026-09-06, #104). Parsing only: no fs, no
 * wall. A media path is handed over exactly as the phone sent it and the
 * root wall in the server decides; a STATIC path is the one place the parser
 * refuses on its own, because it becomes a file under the renderer dir.
 */

export type Route =
  | { kind: 'static'; file: string }
  | { kind: 'pair' }
  | { kind: 'api'; name: string; query: URLSearchParams }
  | { kind: 'media'; path: string; query: URLSearchParams }
  | { kind: 'hls'; job: string; file: string; query: URLSearchParams }
  | { kind: 'remote'; what: 'state' | 'cmd'; query: URLSearchParams }
  | { kind: 'none' }

const NONE: Route = { kind: 'none' }

/**
 * `/hls/<job>/<file>` (2026-09-06, #105): a job id is sixteen hex characters
 * and the file is one of the three shapes the job directory is known to
 * hold. The parser is the wall here, on purpose: nothing else under a job
 * directory is ever served, so `ffmpeg.m3u8` (ffmpeg's own playlist), a
 * `.tmp` in flight or a climb never reach the server's fs at all.
 */
const HLS = /^\/hls\/([0-9a-f]{16})\/(index\.m3u8|init\.mp4|\d+\.m4s)$/

/**
 * Whether any segment of a raw request path is `..`, decoded or not. The
 * WHATWG parser RESOLVES dot segments before `pathname` is readable, so
 * `/assets/../../main/index.js` reaches `pathname` as `/main/index.js`, a name
 * that looks perfectly ordinary; the raw text is the only place the climb is
 * still visible. A segment that will not decode is refused too.
 */
function climbs(rawPath: string): boolean {
  return rawPath.split(/[\\/]/).some((seg) => {
    let s: string
    try {
      s = decodeURIComponent(seg)
    } catch {
      return true
    }
    return s === '..'
  })
}

export function parseRoute(url: string): Route {
  let u: URL
  try {
    u = new URL(url, 'http://phone.invalid')
  } catch {
    return NONE
  }
  const p = u.pathname
  if (p === '/' || p === '/index.html' || p === '/phone.html') return { kind: 'static', file: '' }
  if (p === '/pair') return { kind: 'pair' }
  if (p.startsWith('/api/')) return { kind: 'api', name: p.slice(5), query: u.searchParams }
  if (p.startsWith('/m/')) {
    let path: string
    try {
      path = decodeURIComponent(p.slice(3))
    } catch {
      return NONE
    }
    return { kind: 'media', path, query: u.searchParams }
  }
  if (p.startsWith('/hls/')) {
    const m = HLS.exec(p)
    if (!m) return NONE
    return { kind: 'hls', job: m[1], file: m[2], query: u.searchParams }
  }
  // The remote (#107): the state stream and the command drop, exactly two
  // names, and `/remote/` is a namespace rather than a static file that
  // happens to be called that.
  if (p === '/remote/state' || p === '/remote/cmd') {
    return { kind: 'remote', what: p === '/remote/cmd' ? 'cmd' : 'state', query: u.searchParams }
  }
  if (p === '/remote' || p.startsWith('/remote/')) return NONE
  if (climbs(url.replace(/[?#][\s\S]*$/, ''))) return NONE
  let file: string
  try {
    file = decodeURIComponent(p.replace(/^\/+/, ''))
  } catch {
    return NONE
  }
  if (!file || file.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) return NONE
  return { kind: 'static', file }
}

/**
 * The token: an Authorization header for fetches, `?t=` for `<video src>`,
 * which can carry no header.
 */
export function tokenOf(query: URLSearchParams, auth: string | undefined): string | null {
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth) : null
  if (m) return m[1]
  return query.get('t') || null
}

/** The address the QR encodes: the page itself, with the code in the query. */
export function pairLink(address: string, port: number, code: string): string {
  return `http://${address}:${port}/?code=${code}`
}
