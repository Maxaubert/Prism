import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { acknowledgeWinE, announceWinE, createWinERequests, winERequest } from './winERequests'

const id = 'a1234567-1234-4567-89ab-123456789abc'
afterEach(() => vi.useRealTimers())
describe('Win+E launch handoff', () => {
  it('accepts only local generated request tokens', () => {
    expect(winERequest(['app', `--win-e=${id}`])).toBe(id)
    expect(winERequest(['app', '--win-e=\\remote\\pipe\\foo'])).toBeNull()
    expect(winERequest(['app', '--win-e', id])).toBeNull()
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
    expect(dispatch).toHaveBeenCalledWith(id)
    requests.ready(id)
    requests.ready(id)
    expect(ack).toHaveBeenCalledExactlyOnceWith(id)
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
    const requests = createWinERequests(vi.fn(), ack, vi.fn())
    requests.restored()
    requests.listen()
    requests.enqueue(id)
    vi.advanceTimersByTime(45001)
    requests.ready(id)
    expect(ack).not.toHaveBeenCalled()
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
