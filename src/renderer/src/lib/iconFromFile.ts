import { ICON_PX, type IconRefusal } from '@shared/folderIconFiles'

/**
 * A PICTURE FROM A FILE BECOMES A 64 PX PNG (folder icons, 2026-10-31). Main
 * hands over the picked file's bytes; here they are decoded (a bitmap for the
 * raster kinds and ICO, an `<img>` on a blob URL for SVG, where no script
 * runs), drawn centred into a 64 x 64 square with their aspect kept and a
 * transparent margin, and encoded as PNG for main to keep. A GIF gives its
 * first frame. A decode is full size, so main has already refused a picture
 * over 8,192 px a side by its header (review M2).
 */

/** What the user is told when a file cannot be an icon (a NoticeDialog). */
export const ICON_REFUSED: Readonly<Record<IconRefusal, string>> = {
  'not-picture': "That file isn't a picture Prism can use.",
  'too-big': 'That picture is over 16 MB, too big for an icon.',
  'too-large': 'That picture is over 8,192 pixels wide or tall, too big for an icon.',
  unreadable: "Prism couldn't read that file."
}

/** Where a `width` x `height` picture sits in a `box` square: as large as
 *  fits, aspect kept, centred. A size of 0 (an SVG with only a viewBox) fills
 *  the box. */
export function fitIcon(
  width: number,
  height: number,
  box = ICON_PX
): { x: number; y: number; w: number; h: number } {
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0, w: box, h: box }
  const scale = Math.min(box / width, box / height)
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  return { x: Math.floor((box - w) / 2), y: Math.floor((box - h) / 2), w, h }
}

/** A decoded picture: something a canvas can draw, and its own size. */
export interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  close?: () => void
}

/** The browser's halves, swapped out by the tests. */
export interface IconCodec {
  decode: (bytes: Uint8Array, type: string) => Promise<Decoded>
  /** Draw into a `box` square canvas and give back its PNG. */
  encode: (box: number, draw: (ctx: CanvasRenderingContext2D) => void) => Promise<Uint8Array>
}

async function viaImg(blob: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
}

export const browserCodec: IconCodec = {
  async decode(bytes, type) {
    const blob = new Blob([bytes as BlobPart], { type })
    if (type === 'image/svg+xml') return viaImg(blob)
    try {
      const bmp = await createImageBitmap(blob)
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch {
      // Not every decoder sits behind createImageBitmap; an <img> tries them all.
      return viaImg(blob)
    }
  },
  async encode(box, draw) {
    const canvas = document.createElement('canvas')
    canvas.width = box
    canvas.height = box
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d canvas')
    draw(ctx)
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'))
    if (!blob) throw new Error('no PNG')
    return new Uint8Array(await blob.arrayBuffer())
  }
}

/** The picture as a 64 px PNG, or null when it does not decode. */
export async function iconPng(
  bytes: Uint8Array,
  type: string,
  codec: IconCodec = browserCodec
): Promise<Uint8Array | null> {
  let pic: Decoded
  try {
    pic = await codec.decode(bytes, type)
  } catch {
    return null
  }
  try {
    const at = fitIcon(pic.width, pic.height)
    return await codec.encode(ICON_PX, (ctx) => {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(pic.source, at.x, at.y, at.w, at.h)
    })
  } catch {
    return null
  } finally {
    pic.close?.()
  }
}

/** What "From a file..." ends in: a kept copy's id, a refusal to say, or
 *  nothing (the user cancelled). */
export type FromFile = { file: string } | { refused: string } | null

/** The whole "From a file..." flow over the bridge: pick, draw, keep. */
export async function folderIconFromFile(
  api: Pick<Window['prism'], 'pickFolderIcon' | 'saveFolderIcon'>,
  kept: (id: string, url: string) => void,
  codec: IconCodec = browserCodec
): Promise<FromFile> {
  const pick = await api.pickFolderIcon()
  if (!pick) return null
  if ('refused' in pick) return { refused: ICON_REFUSED[pick.refused] }
  const png = await iconPng(pick.bytes, pick.type, codec)
  if (!png) return { refused: ICON_REFUSED['not-picture'] }
  const saved = await api.saveFolderIcon(png)
  if ('refused' in saved) return { refused: ICON_REFUSED['not-picture'] }
  kept(saved.id, saved.url)
  return { file: saved.id }
}
