import { describe, expect, it } from 'vitest'
import { pictureSize, pngSize } from './pictureSize'

/** Headers of each kind at a given size: enough bytes for the reader. */
const headers = {
  png(width: number, height: number): Uint8Array {
    const b = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8)
    b.write('IHDR', 12, 'ascii')
    b.writeUInt32BE(width, 16)
    b.writeUInt32BE(height, 20)
    return new Uint8Array(b)
  },
  gif(width: number, height: number): Uint8Array {
    const b = Buffer.alloc(13)
    b.write('GIF89a', 0, 'ascii')
    b.writeUInt16LE(width, 6)
    b.writeUInt16LE(height, 8)
    return new Uint8Array(b)
  },
  bmp(width: number, height: number): Uint8Array {
    const b = Buffer.alloc(54)
    b.write('BM', 0, 'ascii')
    b.writeUInt32LE(40, 14)
    b.writeInt32LE(width, 18)
    b.writeInt32LE(-height, 22) // top-down
    return new Uint8Array(b)
  },
  jpeg(width: number, height: number): Uint8Array {
    // SOI, an APP0 of 16, a DQT of 4, then SOF2 (progressive).
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]
    const dqt = [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]
    const sof = [0xff, 0xc2, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3]
    return new Uint8Array([0xff, 0xd8, ...app0, 0xff, ...dqt, ...sof, ...new Array(9).fill(0)])
  },
  webpLossy(width: number, height: number): Uint8Array {
    const b = Buffer.alloc(30)
    b.write('RIFF', 0, 'ascii')
    b.write('WEBP', 8, 'ascii')
    b.write('VP8 ', 12, 'ascii')
    Buffer.from([0x9d, 0x01, 0x2a]).copy(b, 23)
    b.writeUInt16LE(width, 26)
    b.writeUInt16LE(height, 28)
    return new Uint8Array(b)
  },
  webpLossless(width: number, height: number): Uint8Array {
    const b = Buffer.alloc(30)
    b.write('RIFF', 0, 'ascii')
    b.write('WEBP', 8, 'ascii')
    b.write('VP8L', 12, 'ascii')
    b[20] = 0x2f
    b.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21)
    return new Uint8Array(b)
  },
  webpExtended(width: number, height: number): Uint8Array {
    const b = Buffer.alloc(30)
    b.write('RIFF', 0, 'ascii')
    b.write('WEBP', 8, 'ascii')
    b.write('VP8X', 12, 'ascii')
    b.writeUIntLE(width - 1, 24, 3)
    b.writeUIntLE(height - 1, 27, 3)
    return new Uint8Array(b)
  },
  /** An ICO of 32 x 32 (a BMP entry) and, if given, a PNG entry inside. */
  ico(inner?: { width: number; height: number }): Uint8Array {
    const count = inner ? 2 : 1
    const head = Buffer.alloc(6 + 16 * count)
    head.writeUInt16LE(1, 2)
    head.writeUInt16LE(count, 4)
    head[6] = 32
    head[7] = 32
    head.writeUInt32LE(head.length, 6 + 12)
    if (!inner) return new Uint8Array(head)
    const png = headers.png(inner.width, inner.height)
    head[22] = 0 // 256 in the directory, the PNG's own header says more
    head[23] = 0
    head.writeUInt32LE(head.length, 22 + 12)
    return new Uint8Array(Buffer.concat([head, Buffer.from(png)]))
  }
}

describe('pictureSize', () => {
  it('reads every kind the icon picker takes from its header', () => {
    expect(pictureSize(headers.png(640, 480))).toEqual({ width: 640, height: 480 })
    expect(pictureSize(headers.gif(300, 200))).toEqual({ width: 300, height: 200 })
    expect(pictureSize(headers.bmp(120, 90))).toEqual({ width: 120, height: 90 })
    expect(pictureSize(headers.jpeg(4000, 3000))).toEqual({ width: 4000, height: 3000 })
    expect(pictureSize(headers.webpLossy(800, 600))).toEqual({ width: 800, height: 600 })
    expect(pictureSize(headers.webpLossless(1000, 16000))).toEqual({ width: 1000, height: 16000 })
    expect(pictureSize(headers.webpExtended(16383, 2))).toEqual({ width: 16383, height: 2 })
    expect(pictureSize(headers.ico())).toEqual({ width: 32, height: 32 })
  })

  it('a PNG inside an ICO is measured by its own header (the largest entry)', () => {
    expect(pictureSize(headers.ico({ width: 40000, height: 512 }))).toEqual({ width: 40000, height: 512 })
  })

  it('goes by the bytes, not the name, and gives null for anything else', () => {
    expect(pictureSize(new TextEncoder().encode('not a picture at all, just words'))).toBeNull()
    expect(pictureSize(new Uint8Array(0))).toBeNull()
    expect(pictureSize(headers.png(0, 5))).toBeNull()
    // A JPEG cut off before its size.
    expect(pictureSize(headers.jpeg(10, 10).subarray(0, 12))).toBeNull()
    // AVIF, which no extension the picker offers should carry.
    const avif = Buffer.alloc(32)
    avif.write('ftypavif', 4, 'ascii')
    expect(pictureSize(new Uint8Array(avif))).toBeNull()
  })

  it('pngSize reads only a PNG', () => {
    expect(pngSize(headers.png(64, 32))).toEqual({ width: 64, height: 32 })
    expect(pngSize(headers.gif(64, 32))).toBeNull()
  })
})
