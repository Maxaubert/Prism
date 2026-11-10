import { performance } from 'perf_hooks'
import { CALL } from '@shared/channels'
import { diagMain } from 'prism-term-core/main/diagLog'
import type { ClipWrite } from './clipWriter'

/**
 * EVERY FILE OPERATION SAYS HOW IT WENT (owner, 2026-11-06: "make sure logs
 * are always on so you can see what happened").
 *
 * The diagnostics log named each IPC call and its time, never what it
 * answered: the owner's two pastes after #484's stuck copy were two
 * `file:paste-into` lines, and nothing said they landed nothing, or why. An
 * `op` line now says it, ALWAYS (not only in Detailed logging): the
 * operation, `ok`, what it was asked (paths, at most five, and how many),
 * what landed, what failed and why, and how long it took. Paths are logged
 * as the log already logs them; never a password, a file's text or bytes.
 *
 * Copy and paste say more and write their own lines (`copyLine`,
 * `pasteLine`): which way the clipboard was written and in how many tries,
 * and whether a paste took Prism's own copy or read Windows' clipboard. The
 * rest are told at the one place every call passes (`watchOps`, wrapping
 * `ipcMain.handle` like the core's timing does), from what each answered.
 */

export type OpFields = Record<string, unknown> & { op: string; ok: boolean }

/** Write an `op` line to the log. */
export function writeOp(fields: OpFields): void {
  diagMain().write('main', 'op', fields)
}

const MAX_PATHS = 5
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
/** A path list as a line holds it: how many, and the first five. */
export function pathsField(v: unknown): { n: number; paths: string[] } {
  const all = list(v)
  return { n: all.length, paths: all.slice(0, MAX_PATHS) }
}
const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined))

/** Answers that mean it worked, from the channels that answer a word. */
const OK_WORDS = new Set(['ok', 'binned', 'done'])

const count = (v: unknown): number | undefined =>
  Array.isArray(v) ? v.length : typeof v === 'number' ? v : undefined

/** What an operation answered, as fields: `ok`, the counts, the reason. */
export function opResult(r: unknown): Record<string, unknown> & { ok: boolean } {
  if (r === true) return { ok: true }
  if (r === false || r === null || r === undefined) return { ok: false }
  if (typeof r === 'string') return OK_WORDS.has(r) ? { ok: true, result: r } : { ok: false, reason: r }
  if (typeof r !== 'object') return { ok: true }
  const o = r as Record<string, unknown>
  const canceled = o.canceled === true || o.reason === 'cancelled' ? true : undefined
  // What landed: a paste's `pasted`, a move's `moved`, an add's `added`,
  // Save copies' `saved`, an extraction's `written`.
  const landedRaw = typeof o.pasted === 'number' ? o.pasted : Array.isArray(o.moved) ? o.moved : Array.isArray(o.added) ? o.added : Array.isArray(o.saved) ? o.saved : Array.isArray(o.restored) ? o.restored : typeof o.deleted === 'number' ? o.deleted : o.written
  const landed = count(landedRaw)
  const failed = o.failed === true ? undefined : count(o.failed)
  const fields = defined({
    landed,
    failed: failed || undefined,
    skipped: count(o.skipped) || undefined,
    clashes: count(o.clashes) || undefined,
    busy: count(o.busy) || undefined,
    refused: o.refused === true ? true : undefined,
    empty: o.empty === true ? true : undefined,
    to: str(o.path) ?? str(o.dest) ?? (typeof o.saved === 'string' ? o.saved : undefined),
    reason: str(o.reason),
    message: str(o.message)?.slice(0, 200),
    failures: Array.isArray(o.failures) && o.failures.length ? o.failures.slice(0, 10) : undefined,
    canceled
  })
  let ok: boolean
  if (typeof o.ok === 'boolean') ok = o.ok
  else ok = !canceled && o.failed !== true && !fields.refused && !fields.empty && !(typeof failed === 'number' && failed > 0)
  return { ok, ...fields }
}

/** What each operation channel was asked, as fields; and its name. Copy and
 *  paste are not here: they write their own, richer lines. */
export const OP_CHANNELS: Record<string, { op: (a: unknown[]) => string; args: (a: unknown[]) => Record<string, unknown> }> = {
  [CALL.fileRename]: { op: () => 'rename', args: (a) => defined({ path: str(a[0]), name: str(a[1]) }) },
  [CALL.fileTrash]: { op: () => 'trash', args: (a) => defined({ path: str(a[0]) }) },
  [CALL.filePurge]: { op: () => 'purge', args: (a) => defined({ path: str(a[0]) }) },
  [CALL.fileMove]: { op: () => 'move', args: (a) => defined({ ...pathsField(a[0]), into: str(a[1]), onClash: str(a[2]) }) },
  [CALL.fileCopyInto]: { op: () => 'drop-copy', args: (a) => defined({ to: str(a[0]), ...pathsField(a[1]) }) },
  [CALL.fileDuplicate]: { op: () => 'duplicate', args: (a) => defined({ path: str(a[0]) }) },
  [CALL.fileNewFolder]: { op: () => 'new-folder', args: (a) => defined({ in: str(a[0]), name: str(a[1]) }) },
  [CALL.fileBinIfEmpty]: { op: () => 'undo-new-folder', args: (a) => defined({ path: str(a[0]) }) },
  [CALL.fileRestore]: { op: () => 'restore', args: (a) => defined({ ...pathsField(a[0]) }) },
  [CALL.binRestore]: { op: () => 'bin-restore', args: (a) => defined({ ...pathsField(a[0]), onClash: str(a[1]) }) },
  [CALL.binDelete]: { op: () => 'bin-delete', args: (a) => defined({ ...pathsField(a[0]) }) },
  [CALL.binEmpty]: { op: () => 'bin-empty', args: () => ({}) },
  [CALL.fileWrite]: {
    op: () => 'save-text',
    args: (a) => defined({ path: str(a[0]), chars: typeof a[1] === 'string' ? a[1].length : undefined })
  },
  [CALL.archiveAdd]: {
    op: () => 'zip-add',
    args: (a) => defined({ zip: str(a[0]), ...pathsField(a[1]), into: str(a[2]) })
  },
  [CALL.archiveMoveMembers]: {
    op: () => 'zip-move',
    args: (a) => defined({ zip: str(a[0]), ...pathsField(a[1]), into: str(a[2]) })
  },
  [CALL.archiveExtractTo]: {
    op: () => 'extract-to',
    args: (a) => defined({ zip: str(a[0]), ...pathsField(a[1]), into: str(a[2]) })
  },
  [CALL.archiveExtractMembersPicked]: {
    op: () => 'extract-picked',
    args: (a) => defined({ zip: str(a[0]), ...pathsField(a[1]) })
  },
  [CALL.archiveExtractAll]: {
    op: (a) => (a[1] === true ? 'extract-here' : 'extract-all'),
    args: (a) => defined({ zip: str(a[0]) })
  },
  [CALL.archiveExtractDir]: {
    op: () => 'extract-folder',
    args: (a) => defined({ zip: str(a[0]), entry: str(a[1]), here: a[2] === true ? true : undefined })
  },
  [CALL.archiveStageMembers]: {
    op: () => 'zip-to-zip',
    // a[2] is the password: never logged.
    args: (a) => defined({ zip: str(a[0]), ...pathsField(a[1]), toZip: str(a[3]) })
  },
  [CALL.archiveMemberOut]: { op: () => 'member-out', args: (a) => defined({ path: str(a[0]) }) },
  [CALL.archiveRename]: {
    op: () => 'zip-rename',
    // a[3] is the password: never logged.
    args: (a) => defined({ zip: str(a[0]), entry: str(a[1]), name: str(a[2]) })
  },
  [CALL.archiveDelete]: { op: () => 'zip-delete', args: (a) => defined({ zip: str(a[0]), entry: str(a[1]) }) },
  [CALL.imageSaveCopies]: {
    op: () => 'save-copies',
    args: (a) => defined({ ...pathsField(a[0]), format: str(a[1]) })
  },
  [CALL.imageSaveCopy]: {
    op: () => 'save-copy',
    // a[0] is the picture's bytes: never logged.
    args: (a) => defined({ name: str(a[1]), format: str(a[2]), from: str(a[3]) })
  },
  [CALL.dragOut]: { op: () => 'drag-out', args: () => ({}) },
  // The press that extracts a zip's members ahead of a drag out (#103), and
  // a member pulled out for a copy or a view: the first half of the owner's
  // "copying from zip" (review, 2026-11-06).
  [CALL.dragPrepare]: {
    op: () => 'drag-prepare',
    args: (a) => {
      const req = (a[0] ?? {}) as { kind?: unknown; archive?: unknown; entries?: unknown; paths?: unknown }
      return req.kind === 'members'
        ? defined({ zip: str(req.archive), ...pathsField(req.entries) })
        : defined({ ...pathsField(req.paths) })
    }
  },
  [CALL.archiveExtract]: {
    op: () => 'extract-member',
    // a[2] is the password: never logged.
    args: (a) => defined({ zip: str(a[0]), entry: str(a[1]) })
  }
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200)

/**
 * Wrap `ipcMain.handle` so every operation channel registered after this
 * writes one `op` line when its call settles. The answer (or the throw) goes
 * back unchanged; a line that cannot be made never breaks the call.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function watchOps(
  ipc: { handle(channel: string, listener: (event: any, ...args: any[]) => any): unknown },
  write: (fields: OpFields) => void = writeOp,
  clock: () => number = () => performance.now()
): void {
  const handle = ipc.handle.bind(ipc)
  ipc.handle = (channel: string, listener: (event: any, ...args: any[]) => any): unknown => {
    const spec = OP_CHANNELS[channel]
    if (!spec) return handle(channel, listener)
    return handle(channel, (event: any, ...args: any[]) => {
      const t0 = clock()
      const say = (fields: Record<string, unknown> & { ok: boolean }): void => {
        try {
          write({ op: spec.op(args), ...spec.args(args), ...fields, ms: Math.round(clock() - t0) })
        } catch {
          /* the log never breaks an operation */
        }
      }
      let out: unknown
      try {
        out = listener(event, ...args)
      } catch (e) {
        say({ ok: false, reason: reasonOf(e) })
        throw e
      }
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        return (out as Promise<unknown>).then(
          (r) => {
            say(opResult(r))
            return r
          },
          (e: unknown) => {
            say({ ok: false, reason: reasonOf(e) })
            throw e
          }
        )
      }
      say(opResult(out))
      return out
    })
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Where copied paths live, for the line: on disk, a zip's member Prism
 *  extracted, or both. */
export type CopySourceKind = 'disk' | 'zip-member'

/** A copy (or cut, or Copy address) to the clipboard, once its Windows write
 *  settled, or at once when the wall refused it. */
export function copyLine(c: {
  paths: string[]
  cut: boolean
  kinds: CopySourceKind[]
  address?: boolean
  refused?: boolean
  write?: ClipWrite
}): OpFields {
  const kinds = [...new Set(c.kinds)]
  const w = c.write
  return {
    op: c.address ? 'copy-address' : c.cut ? 'cut' : 'copy',
    ok: !c.refused && !!w?.ok,
    ...pathsField(c.paths),
    source: kinds.length > 1 ? 'mixed' : (kinds[0] ?? 'disk'),
    ...(c.refused
      ? { reason: 'refused' }
      : w
        ? defined({
            via: w.via,
            ms: w.ms,
            attempts: w.attempts,
            reason: w.reason,
            phase: w.phase,
            firstReason: w.firstReason,
            firstPhase: w.firstPhase,
            superseded: w.superseded
          })
        : {})
  }
}

/** A paste (or a cut's move), once it ran. */
export function pasteLine(p: {
  to: string
  result: {
    pasted: number
    failed: number
    refused?: boolean
    empty?: boolean
    moved?: boolean
    paths: string[]
    failures?: Array<{ name: string; reason: string }>
  }
  source?: { from: string; why: string }
  moving: boolean
  n: number
  ms: number
}): OpFields {
  const r = p.result
  const ok = !r.refused && !r.empty && r.failed === 0 && r.pasted > 0
  return {
    op: p.moving || r.moved ? 'cut-paste' : 'paste',
    ok,
    to: p.to,
    n: p.n,
    ...defined({
      landed: r.refused || r.empty ? undefined : r.pasted,
      failed: r.refused || r.empty ? undefined : r.failed,
      failures: r.failures?.length ? r.failures.slice(0, 10) : undefined,
      refused: r.refused ? true : undefined,
      empty: r.empty ? true : undefined,
      reason: r.empty ? 'nothing on the clipboard' : r.refused ? 'refused' : undefined,
      source: p.source?.from,
      why: p.source?.why
    }),
    ms: Math.round(p.ms)
  }
}
