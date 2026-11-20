/**
 * The phone page's side of the wire (2026-09-06, #104): how a route URL is
 * built, and the one fetch helper that turns a refused request into a
 * PhoneError carrying the status, so the shell can tell "not paired" (401)
 * from "could not read the folder". Since 2026-11-20 the page holds NO token:
 * it lives in an HttpOnly cookie the browser sends on every same-origin
 * request (fetch, `<img>`, `<video>`, HLS segments), so no URL carries it.
 */
import { ROUTE, mediaPath, routePath } from '@shared/phoneWire'
import { thumbKeepsAlpha } from '@shared/thumbAlpha'

/** Where pages before 2026-11-20 kept the token. */
const LEGACY_TOKEN_KEY = 'prism.phone.token'

export class PhoneError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

/** A phone paired by an older page still has its token in storage: it is
 *  not used any more, so it is removed rather than left lying there. */
export function dropLegacyToken(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    /* site data blocked: nothing to remove */
  }
}

/** A route URL with its params. */
export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const s = new URLSearchParams(params).toString()
  return s ? `${path}?${s}` : path
}

/** A tile's picture (#135): the cookie rides along, the URL carries no secret.
 *  A picture that can be clear asks with `a=1` (#477): a NEW url, so the
 *  black JPEG the phone cached for a day before the fix is not shown again.
 *  The server ignores it; main picks the WebP by the extension itself. */
export function thumbUrl(path: string): string {
  return apiUrl(routePath(ROUTE.thumb), thumbKeepsAlpha(path) ? { path, a: '1' } : { path })
}

/** A file's address: the cookie authorises it, so it is just the path. */
export function mediaUrl(path: string): string {
  return mediaPath(path)
}

export async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  return answer<T>(await fetch(apiUrl(path, params)))
}

/** A read whose failure is an answer: the shim's verbs say what the IPC
 *  would on a refusal (no listing, no hits, unreadable) rather than throw. */
export function getOr<T, F = T>(
  path: string,
  params: Record<string, string>,
  fallback: F
): Promise<T | F> {
  return getJson<T>(path, params).catch(() => fallback)
}

/** A POST nobody waits for: a position, a memory patch, a batch of log
 *  lines. `keepalive` so a page going to the background still hands it
 *  over, and a post that fails is dropped. */
export function postFireAndForget(
  path: string,
  body: unknown,
  params: Record<string, string> = {}
): void {
  void fetch(apiUrl(path, params), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true
  }).catch(() => undefined)
}


/** A refusal carries the PC's own one-line reason where it has one, so the
 *  page can show that rather than a status code. */
async function answer<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg
    } catch {
      /* not json */
    }
    throw new PhoneError(r.status, msg)
  }
  return (await r.json()) as T
}

/** The code the QR link carries, upper-cased the way the server compares it. */
export function codeFromLocation(search: string): string | null {
  const c = new URLSearchParams(search).get('code')
  return c && c.trim() ? c.trim().toUpperCase() : null
}
