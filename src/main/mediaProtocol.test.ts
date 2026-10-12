import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createMediaServer } from './mediaProtocol'

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
})
