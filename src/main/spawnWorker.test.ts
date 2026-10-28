import { describe, expect, it } from 'vitest'
import { execFile, launch, run, spawnStream } from './spawnWorker'

// The worker is real here: a real thread starting real processes. node itself
// is the child, so the test needs nothing installed.
const NODE = process.execPath

describe('the process worker', () => {
  it('answers with stdout, as node execFile does', async () => {
    const { stdout } = await run(NODE, ['-e', 'process.stdout.write("hi")'])
    expect(stdout).toBe('hi')
  })

  it('writes input to stdin and closes it, so a reader never waits for ever', async () => {
    const { stdout } = await run(NODE, ['-e', 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(s.toUpperCase()))'], { input: 'abc' })
    expect(stdout).toBe('ABC')
    // No input at all: stdin is still closed, so this ends instead of hanging.
    const empty = await run(NODE, ['-e', 'process.stdin.resume().on("end",()=>process.stdout.write("end"))'], { timeout: 5000 })
    expect(empty.stdout).toBe('end')
  })

  it('hands back bytes for encoding buffer', async () => {
    const out = await new Promise<Buffer>((resolve, reject) =>
      execFile(NODE, ['-e', 'process.stdout.write(Buffer.from([0,255,1]))'], { encoding: 'buffer' }, (err, stdout) =>
        err ? reject(err) : resolve(stdout)
      )
    )
    expect(Buffer.isBuffer(out)).toBe(true)
    expect([...out]).toEqual([0, 255, 1])
  })

  it('reports a failing exit with its code and keeps stdout', async () => {
    const err = await run(NODE, ['-e', 'process.stdout.write("state");process.exit(3)']).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe(3)
    expect(err.stdout).toBe('state')
  })

  it('reports a missing program as an error, never a throw', async () => {
    const err = await run('Z:/no/such/program.exe', []).catch((e) => e)
    expect(err.code).toBe('ENOENT')
  })

  it('stops the process on abort and answers once', async () => {
    const ac = new AbortController()
    let answers = 0
    const done = new Promise<{ code?: unknown }>((resolve) =>
      execFile(NODE, ['-e', 'setTimeout(()=>{},20000)'], { signal: ac.signal }, (err) => {
        answers++
        resolve(err ?? {})
      })
    )
    setTimeout(() => ac.abort(), 100)
    const err = await done
    expect(err.code).toBe('ABORT_ERR')
    await new Promise((r) => setTimeout(r, 200))
    expect(answers).toBe(1)
  })

  it('launches detached and gives the pid', async () => {
    const pid = await launch(NODE, ['-e', 'setTimeout(()=>{},300)'])
    expect(typeof pid).toBe('number')
    await expect(launch('Z:/no/such/program.exe', [])).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('hands back a big buffer whole (moved, not copied: review, 2026-10-28)', async () => {
    const n = 3 * 1024 * 1024
    const out = await new Promise<Buffer>((resolve, reject) =>
      execFile(
        NODE,
        ['-e', `process.stdout.write(Buffer.alloc(${n}, 7))`],
        { encoding: 'buffer', maxBuffer: 16 << 20 },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      )
    )
    expect(out.length).toBe(n)
    expect(out[0]).toBe(7)
    expect(out[n - 1]).toBe(7)
  })
})

// A child main STREAMS from (review, 2026-10-28): started in the worker, its
// stdout chunks passed over, so CreateProcess never runs on main's thread.
describe('a streaming child', () => {
  it('streams stdout, ends, and closes with the exit code', async () => {
    const child = spawnStream(NODE, [
      '-e',
      'process.stdout.write("ab");setTimeout(()=>{process.stdout.write("cd");process.exit(2)},30)'
    ])
    const chunks: Buffer[] = []
    let spawned = false
    let ended = false
    child.on('spawn', () => (spawned = true))
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stdout.on('end', () => (ended = true))
    const code = await new Promise((r) => child.once('close', r))
    expect(spawned).toBe(true)
    expect(typeof child.pid).toBe('number')
    expect(ended).toBe(true)
    expect(Buffer.concat(chunks).toString()).toBe('abcd')
    expect(code).toBe(2)
    expect(child.exitCode).toBe(2)
  })

  it('kills on request and still closes once', async () => {
    const child = spawnStream(NODE, ['-e', 'setInterval(()=>process.stdout.write("x"),10)'])
    let closes = 0
    const closed = new Promise((r) => child.on('close', () => r(++closes)))
    await new Promise((r) => child.stdout.once('data', r))
    child.stdout.pause()
    child.stdout.resume()
    expect(child.kill()).toBe(true)
    expect(child.kill()).toBe(false)
    await closed
    await new Promise((r) => setTimeout(r, 100))
    expect(closes).toBe(1)
    expect(child.killed).toBe(true)
  })

  it('reports a missing program as an error event, then closes', async () => {
    const child = spawnStream('Z:/no/such/program.exe', [])
    const err = await new Promise<{ code?: unknown }>((r) => child.on('error', r))
    expect(err.code).toBe('ENOENT')
    await new Promise((r) => child.once('close', r))
  })

  it('passes stderr on only when asked', async () => {
    const child = spawnStream(NODE, ['-e', 'process.stderr.write("oops")'], { stderr: true })
    let err = ''
    child.stderr.on('data', (c: Buffer) => (err += c.toString()))
    await new Promise((r) => child.once('close', r))
    expect(err).toBe('oops')
  })
})
