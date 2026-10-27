import { describe, expect, it } from 'vitest'
import { execFile, launch, run } from './spawnWorker'

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
})
