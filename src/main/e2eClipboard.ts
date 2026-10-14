/**
 * THE E2E NEVER TOUCHES THE REAL CLIPBOARD (#356, 2026-10-14). The suite runs
 * while the owner works, and its copies (Copy path, a file copied with
 * Ctrl+C, a picture) used to land on the Windows clipboard: a screenshot the
 * owner took mid-run pasted as three fixture paths, and an image on the
 * clipboard was never put back. Under `--e2e` every clipboard the app has is
 * this one, in memory:
 *   - Electron's `clipboard` in main, patched in place, so the app, the
 *     terminal core and the harness (`app.evaluate(({ clipboard }) => ...)`)
 *     all read and write the same fake;
 *   - the file drop list (`fileClipboard.ts`), which is otherwise PowerShell;
 *   - the page's `navigator.clipboard` and the preload's image copy, which
 *     reach this over `e2e:clipboard` (see `renderer/src/lib/e2eClipboard.ts`).
 * Like the real one, a write REPLACES what was there.
 */
export interface FakeClip {
  text: string
  html: string
  image: { png: Buffer; empty: boolean } | null
  files: { paths: string[]; cut: boolean } | null
  buffers: Map<string, Buffer>
}

const clip: FakeClip = { text: '', html: '', image: null, files: null, buffers: new Map() }

function reset(): void {
  clip.text = ''
  clip.html = ''
  clip.image = null
  clip.files = null
  clip.buffers.clear()
}

/** What the fake holds, for the file half (`fileClipboard.ts`). */
export function fakeFiles(): FakeClip['files'] {
  return clip.files
}

/** A file copy: the paths (and, for "Copy address", the path as text). */
export function fakeCopyFiles(paths: string[], cut: boolean, text?: string): void {
  reset()
  clip.files = { paths: [...paths], cut }
  if (text) clip.text = text
}

export function fakeText(): string {
  return clip.text
}

export function fakeWriteText(text: string): void {
  reset()
  clip.text = text
}

export function fakeWriteImage(png: Buffer): void {
  reset()
  clip.image = { png, empty: png.length === 0 }
}

/** The formats a reader sees, in the names Electron reports. */
export function fakeFormats(): string[] {
  const out: string[] = []
  if (clip.text) out.push('text/plain')
  if (clip.html) out.push('text/html')
  if (clip.image && !clip.image.empty) out.push('image/png')
  if (clip.files) out.push('text/uri-list')
  out.push(...clip.buffers.keys())
  return out
}

interface NativeImageLike {
  toPNG(): Buffer
  isEmpty(): boolean
}

/**
 * Patch Electron's clipboard object in place. `image` builds a NativeImage
 * from PNG bytes (`nativeImage.createFromBuffer`), passed in so this file
 * needs no Electron to be tested.
 */
export function installFakeClipboard(
  target: Record<string, unknown>,
  image: (png: Buffer) => NativeImageLike
): void {
  const fns: Record<string, (...a: never[]) => unknown> = {
    readText: () => clip.text,
    writeText: (t: string) => fakeWriteText(String(t ?? '')),
    readHTML: () => clip.html,
    writeHTML: (h: string) => {
      reset()
      clip.html = String(h ?? '')
    },
    readImage: () => image(clip.image?.png ?? Buffer.alloc(0)),
    writeImage: (img: NativeImageLike) => fakeWriteImage(img.isEmpty() ? Buffer.alloc(0) : img.toPNG()),
    write: (data: { text?: string; html?: string; image?: NativeImageLike }) => {
      reset()
      if (data.text) clip.text = data.text
      if (data.html) clip.html = data.html
      if (data.image && !data.image.isEmpty()) clip.image = { png: data.image.toPNG(), empty: false }
    },
    clear: () => reset(),
    availableFormats: () => fakeFormats(),
    has: (format: string) => fakeFormats().includes(format),
    readBuffer: (format: string) => clip.buffers.get(format) ?? Buffer.alloc(0),
    writeBuffer: (format: string, buf: Buffer) => {
      reset()
      clip.buffers.set(format, Buffer.from(buf))
    },
    readBookmark: () => ({ title: '', url: '' }),
    writeBookmark: () => {},
    readFindText: () => '',
    writeFindText: () => {},
    readRTF: () => '',
    writeRTF: () => {}
  }
  for (const [name, fn] of Object.entries(fns)) {
    try {
      Object.defineProperty(target, name, { value: fn, configurable: true, writable: true })
    } catch {
      target[name] = fn
    }
  }
}

/** Tests only. */
export function resetFakeClipboard(): void {
  reset()
}

/**
 * Under --e2e only: patch main's clipboard and answer the page's and the
 * preload's clipboard over `e2e:clipboard`, so all of them share the fake.
 */
export function registerE2eClipboard(deps: {
  clipboard: object
  image: (png: Buffer) => NativeImageLike
  handle: (channel: string, fn: (e: unknown, ...a: unknown[]) => unknown) => void
}): void {
  installFakeClipboard(deps.clipboard as Record<string, unknown>, deps.image)
  deps.handle('e2e:clipboard', (_e, verb, value) => {
    if (verb === 'readText') return fakeText()
    if (verb === 'writeText') return void fakeWriteText(String(value ?? ''))
    if (verb === 'writeImage') return void fakeWriteImage(Buffer.from(value as ArrayBuffer))
    return undefined
  })
}
