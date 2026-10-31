import { describe, expect, it, vi } from 'vitest'
import { fitIcon, folderIconFromFile, iconPng, ICON_REFUSED, type IconCodec } from './iconFromFile'

// The fixture bytes: a 1 x 1 PNG (what the e2e picks) and a viewBox-only SVG.
const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M9QDwADgQF/e5IkGQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>')

/** A codec that records what it was asked to decode and where it drew. */
function fakeCodec(size: { width: number; height: number } | Error) {
  const drawn: number[][] = []
  const decoded: Array<{ type: string; bytes: number }> = []
  const close = vi.fn()
  const codec: IconCodec = {
    decode: async (bytes, type) => {
      decoded.push({ type, bytes: bytes.length })
      if (size instanceof Error) throw size
      return { source: {} as CanvasImageSource, ...size, close }
    },
    encode: async (box, draw) => {
      const ctx = {
        drawImage: (_s: unknown, ...at: number[]) => drawn.push([box, ...at])
      } as unknown as CanvasRenderingContext2D
      draw(ctx)
      return new Uint8Array([1, 2, 3])
    }
  }
  return { codec, drawn, decoded, close }
}

describe('fitIcon', () => {
  it('fills the 64 square, aspect kept, centred', () => {
    expect(fitIcon(1, 1)).toEqual({ x: 0, y: 0, w: 64, h: 64 })
    expect(fitIcon(256, 256)).toEqual({ x: 0, y: 0, w: 64, h: 64 })
    expect(fitIcon(200, 100)).toEqual({ x: 0, y: 16, w: 64, h: 32 })
    expect(fitIcon(30, 90)).toEqual({ x: 21, y: 0, w: 21, h: 64 })
  })

  it('a picture with no size of its own (a viewBox-only SVG) fills the box', () => {
    expect(fitIcon(0, 0)).toEqual({ x: 0, y: 0, w: 64, h: 64 })
    expect(fitIcon(NaN, 10)).toEqual({ x: 0, y: 0, w: 64, h: 64 })
  })

  it('never draws thinner than a pixel', () => {
    expect(fitIcon(10000, 1)).toEqual({ x: 0, y: 31, w: 64, h: 1 })
  })
})

describe('iconPng', () => {
  it('decodes, draws the fit into 64 px and closes the picture', async () => {
    const f = fakeCodec({ width: 1, height: 1 })
    expect(await iconPng(PNG_1PX, 'image/png', f.codec)).toEqual(new Uint8Array([1, 2, 3]))
    expect(f.decoded).toEqual([{ type: 'image/png', bytes: PNG_1PX.length }])
    expect(f.drawn).toEqual([[64, 0, 0, 64, 64]])
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('an SVG goes to the decoder as SVG', async () => {
    const f = fakeCodec({ width: 0, height: 0 })
    await iconPng(SVG, 'image/svg+xml', f.codec)
    expect(f.decoded[0].type).toBe('image/svg+xml')
    expect(f.drawn).toEqual([[64, 0, 0, 64, 64]])
  })

  it('what does not decode is null', async () => {
    expect(await iconPng(new Uint8Array([1]), 'image/png', fakeCodec(new Error('bad')).codec)).toBeNull()
  })
})

describe('folderIconFromFile', () => {
  const api = (pick: unknown, save: unknown = { id: 'a'.repeat(64), url: 'data:image/png;base64,AA' }) => ({
    pickFolderIcon: vi.fn(async () => pick as never),
    saveFolderIcon: vi.fn(async () => save as never)
  })

  it('a cancel is nothing', async () => {
    const kept = vi.fn()
    expect(await folderIconFromFile(api(null), kept, fakeCodec({ width: 1, height: 1 }).codec)).toBeNull()
    expect(kept).not.toHaveBeenCalled()
  })

  it('picks, draws, keeps, and names the copy', async () => {
    const a = api({ bytes: PNG_1PX, type: 'image/png' })
    const kept = vi.fn()
    const r = await folderIconFromFile(a, kept, fakeCodec({ width: 1, height: 1 }).codec)
    expect(r).toEqual({ file: 'a'.repeat(64) })
    expect(a.saveFolderIcon).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
    expect(kept).toHaveBeenCalledWith('a'.repeat(64), 'data:image/png;base64,AA')
  })

  it("says why: main's refusals, a file that does not decode, a copy main would not keep", async () => {
    const ok = fakeCodec({ width: 1, height: 1 }).codec
    expect(await folderIconFromFile(api({ refused: 'not-picture' }), vi.fn(), ok)).toEqual({
      refused: "That file isn't a picture Prism can use."
    })
    expect(await folderIconFromFile(api({ refused: 'too-big' }), vi.fn(), ok)).toEqual({ refused: ICON_REFUSED['too-big'] })
    expect(await folderIconFromFile(api({ refused: 'unreadable' }), vi.fn(), ok)).toEqual({ refused: ICON_REFUSED.unreadable })
    const broken = fakeCodec(new Error('bad')).codec
    expect(await folderIconFromFile(api({ bytes: SVG, type: 'image/svg+xml' }), vi.fn(), broken)).toEqual({
      refused: ICON_REFUSED['not-picture']
    })
    const kept = vi.fn()
    expect(
      await folderIconFromFile(api({ bytes: PNG_1PX, type: 'image/png' }, { refused: 'not-picture' }), kept, ok)
    ).toEqual({ refused: ICON_REFUSED['not-picture'] })
    expect(kept).not.toHaveBeenCalled()
  })

  it('the refusals read as plain words', () => {
    expect(ICON_REFUSED).toEqual({
      'not-picture': "That file isn't a picture Prism can use.",
      'too-big': 'That picture is over 16 MB, too big for an icon.',
      'too-large': 'That picture is over 8,192 pixels wide or tall, too big for an icon.',
      unreadable: "Prism couldn't read that file."
    })
  })
})
