import { randomBytes } from 'crypto'

/**
 * PRISM PASTES ITS OWN COPY (#484; owner, 2026-11-06: "i had some issues
 * copying from zip to the main folder outside first i got the that didnt
 * work, then it worked").
 *
 * A copy in Prism reaches the Windows clipboard through a PowerShell, and
 * now and then that write sits until its 10 s timeout (3 of the 11 copies in
 * the owner's log, 2026-10-17 to 11-06). Paste used to wait for it and then
 * READ the clipboard back through a second PowerShell: after a timeout the
 * clipboard held no files, so both of the owner's pastes said "There are no
 * files on the clipboard" and landed nothing.
 *
 * Main keeps its own record of the newest copy (paths, cut or copy) from the
 * moment the request arrives, and a paste in Prism answers from it when:
 *   - the clipboard holds that copy (Prism's token, `PRISM_COPY_FORMAT`, is
 *     in the data object the write puts there): no PowerShell read at all;
 *   - or the write is still running or failed, and the clipboard has not
 *     changed since the copy began (nobody else copied anything meanwhile).
 * Only a clipboard that changed OUTSIDE Prism is read from Windows. "Changed"
 * is the cheap view Electron gives main without a process: the format list,
 * the token, the first file name and the text. A picture replaced by another
 * picture is not seen; that paste uses Prism's copy, its newest one.
 */

/** The custom format the write adds, holding the copy's id. */
export const PRISM_COPY_FORMAT = 'Prism.FileCopy'

/** The part of Electron's `clipboard` this reads (patched by the e2e fake). */
export interface ClipView {
  availableFormats(): string[]
  readText(): string
  readBuffer(format: string): Buffer
}

export type WriteState = 'pending' | 'ok' | 'failed'

export interface OwnCopy {
  id: string
  paths: string[]
  cut: boolean
  at: number
  state: WriteState
  reason?: string
  /** The clipboard as it was when the copy began. */
  before: string
  /** A cut already pasted (moved): nothing is left to move. */
  used?: boolean
}

export type PasteSource =
  | {
      from: 'prism'
      paths: string[]
      cut: boolean
      why: 'clipboard-holds-it' | 'write-pending' | 'write-failed' | 'cut-already-pasted'
      copy: string
    }
  | { from: 'windows'; why: 'no-prism-copy' | 'changed-outside' }

const tokenOf = (view: ClipView): string => {
  try {
    return view.readBuffer(PRISM_COPY_FORMAT).toString('utf8').replace(/\0+$/, '')
  } catch {
    return ''
  }
}

/** What the clipboard looks like, cheaply, for "did it change?". A read that
 *  throws is '?', the same each time, so a busy clipboard is "unchanged". */
export function clipSignature(view: ClipView): string {
  const part = (fn: () => string): string => {
    try {
      return fn()
    } catch {
      return '?'
    }
  }
  return [
    part(() => view.availableFormats().join(',')),
    tokenOf(view),
    part(() => view.readBuffer('FileNameW').toString('hex').slice(0, 1024)),
    part(() => {
      const t = view.readText()
      return `${t.length}:${t.slice(0, 256)}:${t.slice(-256)}`
    })
  ].join('|')
}

export function createOwnClipboard(
  view: () => ClipView,
  now: () => number = Date.now,
  newId: () => string = () => randomBytes(8).toString('hex')
): {
  begin(paths: string[], cut: boolean): OwnCopy
  settle(id: string, ok: boolean, reason?: string): void
  used(id: string): void
  source(): PasteSource
  latest(): OwnCopy | null
} {
  let latest: OwnCopy | null = null
  return {
    begin(paths, cut) {
      latest = { id: newId(), paths: [...paths], cut, at: now(), state: 'pending', before: clipSignature(view()) }
      return latest
    },
    settle(id, ok, reason) {
      if (!latest || latest.id !== id) return
      latest = { ...latest, state: ok ? 'ok' : 'failed', ...(ok || !reason ? {} : { reason }) }
    },
    used(id) {
      if (latest?.id === id && latest.cut) latest = { ...latest, used: true }
    },
    source() {
      const c = latest
      if (!c) return { from: 'windows', why: 'no-prism-copy' }
      const v = view()
      const ours = tokenOf(v) === c.id
      if (ours || (c.state !== 'ok' && clipSignature(v) === c.before)) {
        if (c.used) return { from: 'prism', paths: [], cut: true, why: 'cut-already-pasted', copy: c.id }
        const why = ours ? 'clipboard-holds-it' : c.state === 'failed' ? 'write-failed' : 'write-pending'
        return { from: 'prism', paths: [...c.paths], cut: c.cut, why, copy: c.id }
      }
      return { from: 'windows', why: 'changed-outside' }
    },
    latest: () => latest
  }
}
