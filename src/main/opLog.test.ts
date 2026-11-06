import { describe, expect, it } from 'vitest'
import { CALL } from '@shared/channels'
import { OP_CHANNELS, copyLine, opResult, pasteLine, watchOps } from './opLog'

/** The way the clipboard was written, as the log names it (a word, never a process started here). */
const PS = 'powershell'

describe('what an operation answered, as one log line (owner, 2026-11-06)', () => {
  it('reads every answer shape main gives', () => {
    expect(opResult(true)).toEqual({ ok: true })
    expect(opResult(false)).toEqual({ ok: false })
    expect(opResult(null)).toEqual({ ok: false })
    expect(opResult('binned')).toEqual({ ok: true, result: 'binned' })
    expect(opResult('encrypted')).toEqual({ ok: false, reason: 'encrypted' })
    expect(opResult({ ok: true, path: 'C:\\d\\b.txt' })).toEqual({ ok: true, to: 'C:\\d\\b.txt' })
    expect(opResult({ ok: false, reason: 'clash', message: 'taken', suggestion: 'b (2).txt' })).toEqual({
      ok: false,
      reason: 'clash',
      message: 'taken'
    })
    expect(opResult({ ok: false, reason: 'cancelled' })).toEqual({ ok: false, reason: 'cancelled', canceled: true })
    expect(opResult({ ok: true, written: 3, paths: ['a', 'b', 'c'] })).toEqual({ ok: true, landed: 3 })
  })

  it('counts a move: landed, clashes, failures, the wall', () => {
    expect(opResult({ moved: [{ from: 'a', to: 'b' }], clashes: [], failed: [], replaced: [], busy: [] })).toEqual({
      ok: true,
      landed: 1
    })
    expect(
      opResult({ moved: [], clashes: [], failed: ['C:\\x'], replaced: [], busy: ['C:\\x'], refused: true })
    ).toEqual({ ok: false, landed: 0, failed: 1, busy: 1, refused: true })
    expect(opResult({ moved: [], clashes: [{ path: 'a', name: 'a' }], failed: [], replaced: [], busy: [] })).toEqual({
      ok: true,
      landed: 0,
      clashes: 1
    })
  })

  it('counts an add to a zip, Save copies and Save a copy', () => {
    expect(opResult({ added: [{ src: 'a', entry: 'a' }], clashes: [], failed: ['b'] })).toEqual({
      ok: false,
      landed: 1,
      failed: 1
    })
    expect(opResult({ saved: ['a', 'b'], failed: 2, skipped: 1, canceled: false })).toEqual({
      ok: false,
      landed: 2,
      failed: 2,
      skipped: 1
    })
    expect(opResult({ saved: 'C:\\p\\x.png' })).toEqual({ ok: true, to: 'C:\\p\\x.png' })
    expect(opResult({ canceled: true })).toEqual({ ok: false, canceled: true })
    expect(opResult({ failed: true, reason: 'source' })).toEqual({ ok: false, reason: 'source' })
  })

  it('a paste: where to, what landed, what failed and why, and where the files came from', () => {
    const line = pasteLine({
      to: 'C:\\d',
      result: {
        pasted: 0,
        failed: 1,
        paths: [],
        failures: [{ name: 'a.txt', reason: 'ENOENT' }]
      },
      source: { from: 'prism', why: 'write-failed' },
      moving: false,
      n: 1,
      ms: 12.4
    })
    expect(line).toEqual({
      op: 'paste',
      ok: false,
      to: 'C:\\d',
      n: 1,
      landed: 0,
      failed: 1,
      failures: [{ name: 'a.txt', reason: 'ENOENT' }],
      source: 'prism',
      why: 'write-failed',
      ms: 12
    })
    expect(
      pasteLine({ to: 'C:\\d', result: { pasted: 0, failed: 0, empty: true, paths: [] }, source: { from: 'windows', why: 'changed-outside' }, moving: false, n: 0, ms: 700 })
    ).toMatchObject({ op: 'paste', ok: false, empty: true, reason: 'nothing on the clipboard', source: 'windows' })
    expect(
      pasteLine({ to: 'C:\\d', result: { pasted: 2, failed: 0, paths: ['x', 'y'], moved: true }, source: { from: 'windows', why: 'no-prism-copy' }, moving: true, n: 2, ms: 5 })
    ).toMatchObject({ op: 'cut-paste', ok: true, landed: 2 })
  })

  it('a copy to the clipboard: count, where the files are, how it went', () => {
    expect(
      copyLine({
        paths: ['C:\\Users\\x\\AppData\\Local\\Temp\\prism-members\\a.txt'],
        cut: false,
        kinds: ['zip-member'],
        write: { ok: false, ms: 10023, via: PS, attempts: 2, reason: 'timeout', phase: 'loaded', firstReason: 'timeout' }
      })
    ).toEqual({
      op: 'copy',
      ok: false,
      n: 1,
      paths: ['C:\\Users\\x\\AppData\\Local\\Temp\\prism-members\\a.txt'],
      source: 'zip-member',
      via: PS,
      ms: 10023,
      attempts: 2,
      reason: 'timeout',
      phase: 'loaded',
      firstReason: 'timeout'
    })
    expect(copyLine({ paths: ['a', 'b'], cut: true, kinds: ['disk', 'zip-member'], write: { ok: true, ms: 400, via: PS, attempts: 1 } })).toMatchObject({
      op: 'cut',
      ok: true,
      source: 'mixed'
    })
    expect(copyLine({ paths: Array.from({ length: 9 }, (_, i) => `p${i}`), cut: false, kinds: ['disk'], refused: true })).toEqual({
      op: 'copy',
      ok: false,
      n: 9,
      paths: ['p0', 'p1', 'p2', 'p3', 'p4'],
      source: 'disk',
      reason: 'refused'
    })
  })

  it('never logs a password, file text or picture bytes', () => {
    const stage = OP_CHANNELS[CALL.archiveStageMembers].args(['C:\\z.zip', ['a'], 'hunter2', 'C:\\y.zip'])
    expect(JSON.stringify(stage)).not.toContain('hunter2')
    const rename = OP_CHANNELS[CALL.archiveRename].args(['C:\\z.zip', 'a', 'b', 'hunter2'])
    expect(JSON.stringify(rename)).not.toContain('hunter2')
    const write = OP_CHANNELS[CALL.fileWrite].args(['C:\\a.txt', 'secret text'])
    expect(JSON.stringify(write)).not.toContain('secret')
    const save = OP_CHANNELS[CALL.imageSaveCopy].args([new ArrayBuffer(8), 'x.png', 'png', 'C:\\x.heic'])
    expect(save).toEqual({ name: 'x.png', format: 'png', from: 'C:\\x.heic' })
  })

  it('wraps only the operation channels, logs one line each with its time, and passes answers and throws through', async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    const ipc = { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void handlers.set(ch, fn) }
    const lines: Array<Record<string, unknown>> = []
    let t = 0
    watchOps(ipc, (l) => lines.push(l), () => t)
    ipc.handle(CALL.fileRename, async (_e, _p: unknown, name: unknown) => {
      t = 30
      return { ok: true, path: `C:\\d\\${String(name)}` }
    })
    ipc.handle(CALL.browseDirectory, () => 'a listing')
    ipc.handle(CALL.fileTrash, () => Promise.reject(new Error('locked')))
    expect(await handlers.get(CALL.fileRename)!({}, 'C:\\d\\a.txt', 'b.txt', 'ask')).toEqual({ ok: true, path: 'C:\\d\\b.txt' })
    expect(handlers.get(CALL.browseDirectory)!({})).toBe('a listing')
    await expect(handlers.get(CALL.fileTrash)!({}, 'C:\\d\\b.txt')).rejects.toThrow('locked')
    expect(lines).toEqual([
      { op: 'rename', ok: true, path: 'C:\\d\\a.txt', name: 'b.txt', to: 'C:\\d\\b.txt', ms: 30 },
      { op: 'trash', ok: false, path: 'C:\\d\\b.txt', reason: 'locked', ms: 0 }
    ])
  })

  it('an extract here and an extract to a picked folder are told apart', () => {
    expect(OP_CHANNELS[CALL.archiveExtractAll].op(['C:\\z.zip', true])).toBe('extract-here')
    expect(OP_CHANNELS[CALL.archiveExtractAll].op(['C:\\z.zip'])).toBe('extract-all')
  })
})
