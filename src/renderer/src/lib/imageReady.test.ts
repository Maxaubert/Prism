import { describe, expect, it } from 'vitest'
import { isHugeImage, readyImage, type ReadyDeps } from './imageReady'
import type { LoadedImage } from './imageLoader'

const pic = (width: number, height: number): LoadedImage => ({
  objectUrl: `blob:${width}x${height}`,
  blob: new Blob([]),
  width,
  height
})

/** A step the test releases by hand, to see what waits on what. */
function gate<T>(): { promise: Promise<T>; open: (v: T) => void; fail: (e: unknown) => void } {
  let open!: (v: T) => void
  let fail!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    open = res
    fail = rej
  })
  return { promise, open, fail }
}

const settled = async (p: Promise<unknown>): Promise<boolean> => {
  let done = false
  void p.then(
    () => (done = true),
    () => (done = true)
  )
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return done
}

describe('the next picture is drawable before it replaces the last (#28)', () => {
  it('routes past 40 MP to the canvas', () => {
    expect(isHugeImage(pic(8000, 6000))).toBe(true)
    expect(isHugeImage(pic(6000, 4000))).toBe(false)
    expect(isHugeImage(pic(0, 0))).toBe(false)
  })

  it('waits for an ordinary picture to decode', async () => {
    const decoded = gate<{ w: number; h: number }>()
    const deps: ReadyDeps = {
      decode: () => decoded.promise,
      bitmap: () => Promise.reject(new Error('not this path'))
    }
    const ready = readyImage(pic(400, 300), deps)
    expect(await settled(ready)).toBe(false)
    decoded.open({ w: 400, h: 300 })
    expect(await ready).toMatchObject({ bitmap: null, natural: { w: 400, h: 300 } })
  })

  it('waits for a huge picture to be a bitmap, at most 2560 on its long edge', async () => {
    const made = gate<ImageBitmap>()
    let asked: { w: number; h: number } | null = null
    const deps: ReadyDeps = {
      decode: () => Promise.reject(new Error('not this path')),
      bitmap: (_blob, w, h) => {
        asked = { w, h }
        return made.promise
      }
    }
    const ready = readyImage(pic(16000, 4000), deps)
    expect(await settled(ready)).toBe(false)
    expect(asked).toEqual({ w: 2560, h: 640 })
    const bmp = { width: 2560, height: 640, close: () => {} } as unknown as ImageBitmap
    made.open(bmp)
    expect((await ready).bitmap).toBe(bmp)
  })

  it('still swaps when the early decode refuses, so the element can say why', async () => {
    const deps: ReadyDeps = {
      decode: () => Promise.reject(new Error('EncodingError')),
      bitmap: () => Promise.reject(new Error('not this path'))
    }
    expect(await readyImage(pic(10, 10), deps)).toMatchObject({ bitmap: null, natural: null })
  })

  it('fails a huge picture whose bitmap cannot be made', async () => {
    const deps: ReadyDeps = {
      decode: () => Promise.reject(new Error('not this path')),
      bitmap: () => Promise.reject(new Error('too big'))
    }
    await expect(readyImage(pic(10000, 10000), deps)).rejects.toThrow('too big')
  })
})
