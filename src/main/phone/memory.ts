/**
 * What a phone may write into a file's memory (#124): the same patch the
 * window sends over IPC, checked field by field, since it arrives over the
 * wire. Anything else in the body is dropped, and a body with nothing sane
 * in it is refused. Pure.
 */
import type { FileMemoryPatch } from '@shared/types'

export function memoryPatch(body: unknown): FileMemoryPatch | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const out: FileMemoryPatch = {}
  if ('t' in b) {
    if (b.t === null) out.t = null
    else if (typeof b.t === 'number' && Number.isFinite(b.t) && b.t >= 0) out.t = b.t
    else return null
  }
  if ('audio' in b) {
    if (b.audio === null) out.audio = null
    else if (typeof b.audio === 'number' && Number.isInteger(b.audio) && b.audio >= 0) out.audio = b.audio
    else return null
  }
  if ('subs' in b) {
    if (b.subs === null) out.subs = null
    else if (typeof b.subs === 'string' && b.subs.length < 1024) out.subs = b.subs
    else return null
  }
  if ('fit' in b) {
    if (b.fit === null) out.fit = null
    else if (typeof b.fit === 'string' && /^[a-z0-9:]{1,16}$/.test(b.fit)) out.fit = b.fit
    else return null
  }
  return Object.keys(out).length ? out : null
}
