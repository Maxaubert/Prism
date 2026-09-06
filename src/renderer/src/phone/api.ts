/**
 * The phone page's side of the wire (2026-09-06, #104): where the token
 * lives, how a route URL is built, and the one fetch helper that turns a
 * refused request into a PhoneError carrying the status, so the shell can
 * tell "forgotten" (401) from "could not read the folder".
 */
export const TOKEN_KEY = 'prism.phone.token'

export class PhoneError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode: the session still works until reload */
  }
}

/** A route URL with its params and the token in the query. */
export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params)
  const t = readToken()
  if (t) q.set('t', t)
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

/** `<video src>` cannot carry a header, so the token rides in the query. */
export function mediaUrl(path: string): string {
  const t = readToken()
  return `/m/${encodeURIComponent(path)}${t ? `?t=${t}` : ''}`
}

export async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const r = await fetch(apiUrl(path, params))
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
