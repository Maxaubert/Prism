import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { WHOLE_BUFFER_MAX, createMediaServer, madeImageBody } from './mediaProtocol'

// fsmedia:// (stage 9b): the wall answers first, and a Range request is a
// 206 with exactly the bytes asked for, so media can seek.

const dir = mkdtempSync(join(tmpdir(), 'prism-media-'))
const file = join(dir, 'clip.mp4')
writeFileSync(file, Buffer.from('0123456789'))
const url = (p: string): string => `fsmedia://local/${encodeURIComponent(p)}`

function server(allowed = (p: string) => p === file) {
  return createMediaServer({
    allowed,
    ffmpeg: () => null,
    heic: () => Promise.reject(new Error('no'))
  })
}

describe('fsmedia://', () => {
  it('refuses a path outside the wall with 403', async () => {
    const res = await server(() => false)(new Request(url(file)))
    expect(res.status).toBe(403)
  })

  it('resolves the path off the thread before the wall reads it (review, 2026-10-28)', async () => {
    const order: string[] = []
    const res = await createMediaServer({
      allowed: (p) => (order.push(`allowed ${p}`), p === file),
      warm: async (p) => void order.push(`warm ${p}`),
      ffmpeg: () => null,
      heic: () => Promise.reject(new Error('no'))
    })(new Request(url(file)))
    expect(res.status).toBe(200)
    expect(order).toEqual([`warm ${file}`, `allowed ${file}`])
  })

  it('answers 404 for a missing file inside the wall', async () => {
    const res = await server(() => true)(new Request(url(join(dir, 'gone.mp4'))))
    expect(res.status).toBe(404)
  })

  it('serves the whole file with its type and Accept-Ranges', async () => {
    const res = await server()(new Request(url(file)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.text()).toBe('0123456789')
  })

  it('answers a Range with 206 and exactly those bytes', async () => {
    const res = await server()(new Request(url(file), { headers: { range: 'bytes=2-5' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(res.headers.get('content-length')).toBe('4')
    expect(await res.text()).toBe('2345')
  })

  it('clamps an open or oversized Range to the file', async () => {
    const open = await server()(new Request(url(file), { headers: { range: 'bytes=7-' } }))
    expect(open.headers.get('content-range')).toBe('bytes 7-9/10')
    expect(await open.text()).toBe('789')
    const big = await server()(new Request(url(file), { headers: { range: 'bytes=8-999' } }))
    expect(big.headers.get('content-range')).toBe('bytes 8-9/10')
  })

  // #23 (2026-11-01): RFC 7233, and a handler that never throws.
  it('serves a suffix Range as the last bytes', async () => {
    const res = await server()(new Request(url(file), { headers: { range: 'bytes=-3' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 7-9/10')
    expect(res.headers.get('content-length')).toBe('3')
    expect(await res.text()).toBe('789')
  })

  it('answers 416 with the size for a Range past the end', async () => {
    const res = await server()(new Request(url(file), { headers: { range: 'bytes=10-' } }))
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */10')
  })

  it('ignores a Range it cannot read and serves the whole file', async () => {
    const res = await server()(new Request(url(file), { headers: { range: 'bytes=5-2' } }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('0123456789')
  })

  it('serves a 0-byte file empty, and a Range on it is a 416', async () => {
    const empty = join(dir, 'empty.mp4')
    writeFileSync(empty, '')
    const whole = await server((p) => p === empty)(new Request(url(empty)))
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-length')).toBe('0')
    expect(await whole.text()).toBe('')
    const ranged = await server((p) => p === empty)(
      new Request(url(empty), { headers: { range: 'bytes=0-' } })
    )
    expect(ranged.status).toBe(416)
    expect(ranged.headers.get('content-range')).toBe('bytes */0')
  })

  it('answers 500 instead of throwing, and a wall that throws serves nothing', async () => {
    const res = await createMediaServer({
      allowed: () => {
        throw new Error('wall broke')
      },
      ffmpeg: () => null,
      heic: () => Promise.reject(new Error('no'))
    })(new Request(url(file)))
    expect(res.status).toBe(500)
    expect(res.body).toBeNull()
  })

  it('leaves a diag line for a 500, so media that will not play has a trace (review of #23)', async () => {
    const lines: Array<{ url: string; error: string }> = []
    const res = await createMediaServer({
      allowed: () => {
        throw new Error('wall broke')
      },
      ffmpeg: () => null,
      heic: () => Promise.reject(new Error('no')),
      onError: (fields) => lines.push(fields)
    })(new Request(url(file)))
    expect(res.status).toBe(500)
    expect(lines).toEqual([{ url: url(file), error: 'wall broke' }])
  })
})

// A picture main made (decoded TIFF/PSD, raw preview, HEIC) follows the same
// 8 MB rule as a file on disk (review, 2026-10-16): one huge buffer is one
// huge IPC message and a renderer stall.
describe('a picture main made', () => {
  it('goes back whole when small', () => {
    const small = Buffer.alloc(1024)
    expect(madeImageBody(small)).toBe(small)
  })

  it('streams in chunks above 8 MB, every byte intact', async () => {
    const big = Buffer.alloc(WHOLE_BUFFER_MAX + 3 * 1024 * 1024 + 7)
    big[big.length - 1] = 0x5a
    const body = madeImageBody(big)
    expect(body).toBeInstanceOf(ReadableStream)
    const reader = (body as ReadableStream<Uint8Array>).getReader()
    let chunks = 0
    let total = 0
    let last = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks += 1
      total += value.length
      expect(value.length).toBeLessThanOrEqual(1024 * 1024)
      last = value[value.length - 1]
    }
    expect(chunks).toBeGreaterThan(8)
    expect(total).toBe(big.length)
    expect(last).toBe(0x5a)
  })

  it('is what the HEIC route answers with', async () => {
    const heic = join(dir, 'photo.heic')
    writeFileSync(heic, Buffer.from('x'))
    const jpeg = Buffer.alloc(WHOLE_BUFFER_MAX + 1)
    const res = await createMediaServer({
      allowed: () => true,
      ffmpeg: () => null,
      heic: () => Promise.resolve(jpeg)
    })(new Request(url(heic)))
    expect(res.headers.get('content-length')).toBe(String(jpeg.length))
    expect((await res.arrayBuffer()).byteLength).toBe(jpeg.length)
  })
})
