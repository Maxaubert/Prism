import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import {
  WIN_E_FIRST,
  acknowledgeWinE,
  announceWinE,
  browseRequest,
  createWinERequests,
  winERequest
} from './winERequests'

const id = 'a1234567-1234-4567-89ab-123456789abc'
afterEach(() => vi.useRealTimers())
describe('Win+E launch handoff', () => {
  it('accepts only local generated request tokens', () => {
    expect(winERequest(['app', `--win-e=${id}`])).toBe(id)
    expect(winERequest(['app', '--win-e=\\remote\\pipe\\foo'])).toBeNull()
    expect(winERequest(['app', '--win-e', id])).toBeNull()
  })
  it('a folder-verb request carries only an absolute Windows folder (#393)', () => {
    expect(browseRequest(['app', `--win-e=${id}`, '--browse=C:\\Users\\a b'])).toBe('C:\\Users\\a b')
    expect(browseRequest(['app', '--browse=D:\\'])).toBe('D:\\')
    expect(browseRequest(['app', '--browse=\\\\server\\share\\x'])).toBe('\\\\server\\share\\x')
    expect(browseRequest(['app', '--browse=relative\\x'])).toBeNull()
    expect(browseRequest(['app', '--browse=::{20D04FE0-3AEA-1069-A2D8-08002B30309D}'])).toBeNull()
    expect(browseRequest(['app', '--browse=C:'])).toBeNull()
    expect(browseRequest(['app', `--win-e=${id}`])).toBeNull()
  })
  it('waits for both session restoration and renderer subscription before dispatch/ack', () => {
    const dispatch = vi.fn(),
      ack = vi.fn(async () => {})
    const announce = vi.fn()
    const requests = createWinERequests(dispatch, ack, announce)
    requests.enqueue(id)
    // "started" goes to the helper at once, long before the window is ready,
    // so a cold start after boot is waited for rather than given up on.
    expect(announce).toHaveBeenCalledExactlyOnceWith(id)
    requests.ready(id)
    requests.listen()
    expect(dispatch).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
    requests.restored()
    expect(dispatch).toHaveBeenCalledWith(id, WIN_E_FIRST, null)
    requests.ready(id)
    requests.ready(id)
    expect(ack).toHaveBeenCalledExactlyOnceWith(id)
  })
  // Tab tear-off step 2 (2026-10-29): a Win+E while Prism runs opens a new
  // window in this process, and the request is THAT window's alone.
  it('a request named for its own window waits for that window and only it may answer', () => {
    const dispatch = vi.fn(),
      ack = vi.fn(async () => {})
    const requests = createWinERequests(dispatch, ack, vi.fn())
    // The first window is up and restored: a request for another window is
    // not its to take.
    requests.listen()
    requests.restored()
    expect(requests.enqueue(id, id)).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    // A retransmitted token never opens a second window.
    expect(requests.enqueue(id, id)).toBe(false)
    requests.listen(id)
    expect(dispatch).not.toHaveBeenCalled()
    requests.restored(id)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(id, id, null)
    // The first window's page cannot answer it, nor can the first window's
    // reload take it back.
    requests.ready(id)
    requests.reload()
    expect(ack).not.toHaveBeenCalled()
    requests.ready(id, id)
    expect(ack).toHaveBeenCalledExactlyOnceWith(id)
  })
  it("one window's reload resends only its own requests, and a forgotten host takes none", () => {
    const other = 'b1234567-1234-4567-89ab-123456789abc'
    const dispatch = vi.fn()
    const drop = vi.fn()
    const requests = createWinERequests(dispatch, vi.fn(async () => {}), vi.fn(), drop)
    for (const host of [id, other]) {
      requests.listen(host)
      requests.restored(host)
      requests.enqueue(host, host)
    }
    expect(dispatch).toHaveBeenCalledTimes(2)
    requests.reload(id)
    requests.listen(id)
    requests.restored(id)
    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(dispatch).toHaveBeenLastCalledWith(id, id, null)
    // A host whose window went takes its requests with it: each pipe is let
    // go so the helper falls back at once (review, 2026-10-29), not after
    // its 45 s patience, and nothing is sent to a window that is not there.
    requests.reload(other)
    requests.forget(other)
    expect(drop).toHaveBeenCalledExactlyOnceWith(other)
    requests.listen(other)
    requests.restored(other)
    expect(dispatch).toHaveBeenCalledTimes(3)
    // The other window's request is untouched.
    requests.ready(id, id)
    expect(drop).toHaveBeenCalledTimes(1)
  })
  it('the folder a request carries travels with it, and a retransmission cannot change it (#393)', () => {
    const dispatch = vi.fn()
    const requests = createWinERequests(dispatch, vi.fn(async () => {}), vi.fn(), vi.fn())
    expect(requests.enqueue(id, id, 'C:\\first')).toBe(true)
    expect(requests.enqueue(id, id, 'D:\\other')).toBe(false)
    requests.listen(id)
    requests.restored(id)
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(id, id, 'C:\\first')
  })
  it('deduplicates pending requests and replays only after reload is ready', () => {
    const dispatch = vi.fn(),
      ack = vi.fn(async () => {})
    const requests = createWinERequests(dispatch, ack, vi.fn())
    requests.restored()
    requests.listen()
    requests.enqueue(id)
    requests.enqueue(id)
    expect(dispatch).toHaveBeenCalledTimes(1)
    requests.reload()
    requests.ready(id)
    requests.listen()
    expect(ack).not.toHaveBeenCalled()
    requests.restored()
    expect(dispatch).toHaveBeenCalledTimes(2)
    requests.ready(id)
  })
  it('expires unacknowledged requests and rejects unsolicited replies', () => {
    vi.useFakeTimers()
    const ack = vi.fn(async () => {})
    const drop = vi.fn()
    const requests = createWinERequests(vi.fn(), ack, vi.fn(), drop)
    requests.restored()
    requests.listen()
    requests.enqueue(id)
    vi.advanceTimersByTime(45001)
    // The expired request's pipe is let go, not held for the process's life.
    expect(drop).toHaveBeenCalledExactlyOnceWith(id)
    requests.ready(id)
    expect(ack).not.toHaveBeenCalled()
  })
  it('an answered request keeps its pipe for the ready line', () => {
    const drop = vi.fn()
    const ack = vi.fn(async () => {})
    const requests = createWinERequests(vi.fn(), ack, vi.fn(), drop)
    requests.restored()
    requests.listen()
    requests.enqueue(id)
    requests.ready(id)
    requests.forget(WIN_E_FIRST)
    expect(ack).toHaveBeenCalledExactlyOnceWith(id)
    expect(drop).not.toHaveBeenCalled()
  })
})

// #350: the helper's pipe server only READS (PipeDirection.In), so the client
// end sees end-of-file at once. With Node's default (allowHalfOpen false) that
// closed the held socket a few ms after "started", the helper read the close
// as a dead Prism and opened File Explorer too, on every press (MEASURED: read
// at 4 ms, closed at 9 ms). The server here IS the helper's: a .NET read-only
// pipe, started through PowerShell, reporting each read and when it closed.
// One line of statements: a multi-line -Command never created the pipe.
const HELPER_SERVER = [
  "$pipe = New-Object System.IO.Pipes.NamedPipeServerStream(('PrismWinE.' + $env:TOKEN), [System.IO.Pipes.PipeDirection]::In, 1, [System.IO.Pipes.PipeTransmissionMode]::Byte, [System.IO.Pipes.PipeOptions]::Asynchronous)",
  "[Console]::Out.WriteLine('listening'); [Console]::Out.Flush()",
  '$pipe.WaitForConnection()',
  '$clock = [Diagnostics.Stopwatch]::StartNew(); $buf = New-Object byte[] 256',
  "while ($true) { $n = $pipe.Read($buf, 0, 256); if ($n -eq 0) { [Console]::Out.WriteLine('closed ' + $clock.ElapsedMilliseconds); [Console]::Out.Flush(); break }; [Console]::Out.WriteLine('read ' + $clock.ElapsedMilliseconds + ' ' + [Convert]::ToBase64String($buf, 0, $n)); [Console]::Out.Flush() }"
].join('; ')
describe.runIf(process.platform === 'win32')('the held pipe (#350)', () => {
  it('keeps the socket open after "started" so the ready line arrives on it', async () => {
    const token = randomUUID()
    const server = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', HELPER_SERVER], {
      env: { ...process.env, TOKEN: token },
      windowsHide: true
    })
    let output = ''
    server.stdout.on('data', (chunk) => (output += String(chunk)))
    const exited = new Promise((done) => server.on('exit', done))
    const until = async (test: () => boolean): Promise<void> => {
      for (let i = 0; i < 300 && !test(); i++) await new Promise((done) => setTimeout(done, 50))
    }
    await until(() => output.includes('listening'))
    announceWinE(token)
    await new Promise((done) => setTimeout(done, 500))
    await acknowledgeWinE(token)
    await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))])
    server.kill()
    const lines = output.trim().split(/\r?\n/).slice(1)
    const reads = lines.filter((l) => l.startsWith('read '))
    const text = reads.map((l) => Buffer.from(l.split(' ')[2], 'base64').toString()).join('')
    const closedAt = Number(lines.find((l) => l.startsWith('closed '))?.split(' ')[1] ?? NaN)
    // ONE connection carried both lines (the helper accepts one), so the
    // socket was held through the wait; the old one closed after "started".
    expect(text).toBe(`${token} started\n${token}\n`)
    // And it closed only AFTER the ready line, read in the helper's own
    // order. Not a wall-clock floor: the helper's clock starts when the
    // connection is accepted, which on a slow runner was most of the 500 ms
    // after the announce (117 ms measured, ci 2026-10-13), not the wait.
    const lastReadAt = Math.max(...reads.map((l) => Number(l.split(' ')[1])))
    expect(closedAt).toBeGreaterThanOrEqual(lastReadAt)
    expect(reads.length).toBeGreaterThanOrEqual(1)
  }, 20_000)
})
