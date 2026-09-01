import type { FileKind } from '@shared/types'
import { formatBytes, formatTime } from './format'

// What the Properties popup shows: label/value rows assembled per kind. The
// cheap facts come from a stat; the interesting ones come from actually opening
// the file the way its viewer would (an image knows its pixels, a PDF its
// pages), which is why this is async and can take a beat on a network drive.

export interface PropRow {
  label: string
  value: string
}

const KIND_NAMES: Record<FileKind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  pdf: 'PDF document',
  doc: 'Document',
  text: 'Text document',
  archive: 'Archive',
  comic: 'Comic book',
  other: 'File'
}

const dims = (w: number, h: number): string => `${w} × ${h} px`

function probeImage(url: string): Promise<PropRow[]> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve([{ label: 'Dimensions', value: dims(img.naturalWidth, img.naturalHeight) }])
    img.onerror = () => resolve([])
    img.src = url
  })
}

/**
 * What the camera wrote, when it wrote anything (2026-08-31).
 *
 * Rows only for the fields that are actually there: a screenshot has no
 * camera and no lens, and eight empty rows saying so is worse than nothing.
 * Main reads it from the file, so a HEIC and a camera RAW answer as well as
 * a JPEG - their decoded copies carry no metadata at all.
 */
async function probePhoto(path: string): Promise<PropRow[]> {
  type Info = Awaited<ReturnType<typeof window.prism.photoInfo>>
  const info: Info = await window.prism.photoInfo(path).catch((): Info => ({}))
  const rows: PropRow[] = []
  if (info.camera) rows.push({ label: 'Camera', value: info.camera })
  if (info.lens) rows.push({ label: 'Lens', value: info.lens })
  if (info.exposure) rows.push({ label: 'Exposure', value: info.exposure })
  if (info.taken) rows.push({ label: 'Taken', value: info.taken })
  if (info.colour) rows.push({ label: 'Colour', value: info.colour })
  if (info.gps) {
    rows.push({ label: 'Location', value: `${info.gps.lat.toFixed(5)}, ${info.gps.lon.toFixed(5)}` })
  }
  return rows
}

function probeMedia(url: string, video: boolean): Promise<PropRow[]> {
  return new Promise((resolve) => {
    const el = document.createElement(video ? 'video' : 'audio') as HTMLVideoElement
    el.preload = 'metadata'
    const done = (rows: PropRow[]): void => {
      el.removeAttribute('src') // let the element release the file
      resolve(rows)
    }
    el.onloadedmetadata = () => {
      const rows: PropRow[] = []
      if (video && el.videoWidth) rows.push({ label: 'Dimensions', value: dims(el.videoWidth, el.videoHeight) })
      if (Number.isFinite(el.duration)) rows.push({ label: 'Duration', value: formatTime(el.duration) })
      done(rows)
    }
    el.onerror = () => done([])
    setTimeout(() => done([]), 8000) // a probe, not a promise to wait forever
    el.src = url
  })
}

async function probePdf(url: string): Promise<PropRow[]> {
  try {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const task = pdfjs.getDocument({ url })
    const doc = await task.promise
    const pages = doc.numPages
    void task.destroy() // releases the worker and the document together
    return [{ label: 'Pages', value: String(pages) }]
  } catch {
    return []
  }
}

/** What a zip holds, how hard it squeezed, and whether it is locked (#70). */
async function probeArchive(path: string, sizeOnDisk: number): Promise<PropRow[]> {
  const st = await window.prism.archiveStat(path)
  if (!st) return []
  const rows: PropRow[] = [
    {
      label: 'Contents',
      value: `${st.files} file${st.files === 1 ? '' : 's'}${st.folders ? `, ${st.folders} folder${st.folders === 1 ? '' : 's'}` : ''}`
    },
    { label: 'Uncompressed', value: formatBytes(st.uncompressed) }
  ]
  // The ratio is the point of an archive; it needs both numbers to mean
  // anything, so it only appears when the file has been measured.
  if (st.uncompressed > 0 && sizeOnDisk > 0) {
    const saved = Math.max(0, Math.round((1 - sizeOnDisk / st.uncompressed) * 100))
    rows.push({ label: 'Compression', value: `${saved}% smaller` })
  }
  rows.push({
    label: 'Encryption',
    value:
      st.encryption === 'aes'
        ? 'AES (needs 7-Zip)'
        : st.encryption === 'zipcrypto'
          ? 'Password protected'
          : 'None'
  })
  return rows
}

async function probeText(path: string): Promise<PropRow[]> {
  const read = await window.prism.readText(path)
  if (!('text' in read)) return []
  const text = read.text
  const words = text.split(/\s+/).filter(Boolean).length
  return [
    { label: 'Lines', value: String(text.split('\n').length).replace(/\B(?=(\d{3})+(?!\d))/g, ',') },
    { label: 'Words', value: String(words).replace(/\B(?=(\d{3})+(?!\d))/g, ',') },
    { label: 'Characters', value: String(text.length).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
  ]
}

/** The rows for one file (or folder), most interesting first. */
export async function propsFor(root: string, path: string, name: string, kind: FileKind, isFolder: boolean): Promise<PropRow[]> {
  const url = window.prism.mediaUrl(path)
  const ext = /\.[^.\\/]+$/.exec(name)?.[0]?.slice(1).toUpperCase()
  // An archive's compression ratio needs its size on disk, so that stat is
  // read first and the probe below is handed the number.
  const size = kind === 'archive' && !isFolder ? ((await window.prism.statFile(path))?.size ?? 0) : 0

  const [stat, special] = await Promise.all([
    window.prism.statFile(path),
    isFolder
      ? window.prism.listDir(root, path).then((l): PropRow[] =>
          l && !l.unreadable
            ? [{ label: 'Contents', value: `${l.folders.length} folders, ${l.files.length} files` }]
            : []
        )
      : kind === 'image'
        ? Promise.all([probeImage(url), probePhoto(path)]).then(([a, b]) => [...a, ...b])
        : kind === 'video'
          ? probeMedia(url, true)
          : kind === 'audio'
            ? probeMedia(url, false)
            : kind === 'pdf'
              ? probePdf(url)
              : kind === 'text'
                ? probeText(path)
                : kind === 'archive'
                  ? probeArchive(path, size)
                  : Promise.resolve([])
  ])

  const rows: PropRow[] = [
    { label: 'Kind', value: isFolder ? 'Folder' : ext ? `${KIND_NAMES[kind]} (${ext})` : KIND_NAMES[kind] },
    ...special
  ]
  if (stat && !isFolder) rows.push({ label: 'Size', value: formatBytes(stat.size) })
  // A rough bitrate falls out of size and duration; good enough for a viewer.
  if (kind === 'audio' && stat) {
    const dur = special.find((r) => r.label === 'Duration')
    if (dur) {
      const secs = dur.value.split(':').reduce((a, b) => a * 60 + Number(b), 0)
      if (secs > 0) rows.push({ label: 'Bitrate', value: `${Math.round((stat.size * 8) / secs / 1000)} kbps` })
    }
  }
  rows.push({ label: 'Location', value: path.replace(/[\\/][^\\/]*$/, '') })
  if (stat) rows.push({ label: 'Modified', value: new Date(stat.mtimeMs).toLocaleString() })
  return rows
}
