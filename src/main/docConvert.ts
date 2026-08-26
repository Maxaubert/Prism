import { readFileSync } from 'fs'
import { extname } from 'path'

/**
 * Office and ebook documents, turned into HTML the viewer can show.
 *
 * Prism renders PDF itself and markdown through react-markdown; everything
 * else here is a container of XML that has to be walked. The results are
 * honest about their limits: a .docx keeps its structure, a spreadsheet
 * becomes one table per sheet, a presentation becomes its slides' text and
 * pictures in order. None of this is a re-implementation of Office, and it
 * does not pretend to be - it is a VIEWER, for reading a file you were sent.
 *
 * Everything is sanitised HERE, in main, before it reaches the renderer: the
 * XHTML inside an epub is somebody else's markup, and the renderer it would
 * land in can reach window.prism.
 */

export type DocKind = 'word' | 'sheet' | 'slides' | 'book' | 'rtf'

const KINDS: Record<string, DocKind> = {
  '.docx': 'word',
  '.docm': 'word',
  '.odt': 'word',
  '.rtf': 'rtf',
  '.xlsx': 'sheet',
  '.xlsm': 'sheet',
  '.xls': 'sheet',
  '.ods': 'sheet',
  '.pptx': 'slides',
  '.ppsx': 'slides',
  '.odp': 'slides',
  '.epub': 'book'
}

export function docKind(ext: string): DocKind | null {
  return KINDS[ext.toLowerCase()] ?? null
}

export const docExtensions = (): string[] => Object.keys(KINDS)

/** Escape text for dropping into HTML. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// RTF
// ---------------------------------------------------------------------------

/**
 * RTF to plain paragraphs.
 *
 * RTF is a control-word format with no document tree worth reconstructing for
 * a viewer, so this keeps what a reader needs - the words, the paragraph
 * breaks, and the accented characters - and drops the formatting. Anything
 * cleverer would be a word processor.
 */
export function rtfToHtml(rtf: string): string {
  return paragraphs(rtfText(rtf))
}

/** Groups that hold no readable text: their whole contents are skipped. */
const RTF_SKIP =
  /^\\\*?\\?(fonttbl|colortbl|stylesheet|generator|info|pict|object|themedata|colorschememapping|latentstyles|listtable|rsidtbl|xmlnstbl|datastore|mmath)\b/

/**
 * The readable text of an RTF.
 *
 * Walked brace by brace rather than pattern-matched: `{\fonttbl{\f0 Arial;}}`
 * nests, and a regex that stops at the first `}` leaves "Arial;" sitting in
 * the middle of the document. Formatting is dropped on purpose - this is a
 * viewer, and rebuilding a word processor's model to show someone a letter is
 * not the job.
 */
function rtfText(rtf: string): string {
  let out = ''
  let i = 0
  // One entry per open brace: true while inside a group we are ignoring.
  const stack: boolean[] = []
  const skipping = (): boolean => stack.some(Boolean)
  while (i < rtf.length) {
    const c = rtf[i]
    if (c === '{') {
      stack.push(RTF_SKIP.test(rtf.slice(i + 1, i + 40)))
      i++
      continue
    }
    if (c === '}') {
      stack.pop()
      i++
      continue
    }
    if (c !== '\\') {
      if (!skipping() && c !== '\r' && c !== '\n') out += c
      i++
      continue
    }
    const hex = /^\\'([0-9a-f]{2})/i.exec(rtf.slice(i))
    if (hex) {
      if (!skipping()) out += String.fromCharCode(parseInt(hex[1], 16))
      i += hex[0].length
      continue
    }
    const word = /^\\([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i))
    if (word) {
      const name = word[1].toLowerCase()
      if (!skipping()) {
        if (name === 'par' || name === 'pard' || name === 'line') out += '\n'
        else if (name === 'tab') out += '\t'
        else if (name === 'u') out += String.fromCharCode(Number(word[2]) & 0xffff)
      }
      i += word[0].length
      // \uN is followed by a replacement character for readers that cannot do
      // unicode; it must not appear twice.
      if (name === 'u' && rtf[i] === '?') i++
      continue
    }
    // An escaped literal: \{, \} or \\.
    if (!skipping() && rtf[i + 1]) out += rtf[i + 1]
    i += 2
  }
  return out
}

/** Non-empty lines, as escaped paragraphs. */
function paragraphs(text: string): string {
  return text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('\n')
}

// ---------------------------------------------------------------------------
// OpenDocument (odt / odp) - zipped XML
// ---------------------------------------------------------------------------

/** Text runs out of an ODF body, one paragraph per text:p / text:h. */
export function odfToHtml(xml: string): string {
  const body = /<office:body[^>]*>([\s\S]*)<\/office:body>/.exec(xml)?.[1] ?? xml
  const out: string[] = []
  for (const m of body.matchAll(/<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\1>/g)) {
    const heading = m[1] === 'h'
    const text = m[2]
      .replace(/<text:s\/>/g, ' ')
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!text) continue
    out.push(heading ? `<h2>${esc(unent(text))}</h2>` : `<p>${esc(unent(text))}</p>`)
  }
  return out.join('\n')
}

/** The five XML entities, back to their characters. */
function unent(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

// ---------------------------------------------------------------------------
// PowerPoint - one section per slide
// ---------------------------------------------------------------------------

/** The text of one slide's XML, in reading order, as paragraphs. */
export function slideToHtml(xml: string): string {
  const lines: string[] = []
  for (const p of xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const text = [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => unent(t[1])).join('')
    if (text.trim()) lines.push(text.trim())
  }
  if (!lines.length) return ''
  // The first line of a slide is its title far more often than not.
  const [title, ...rest] = lines
  return (
    `<h2>${esc(title)}</h2>` + (rest.length ? '\n' + rest.map((l) => `<p>${esc(l)}</p>`).join('\n') : '')
  )
}

/** Slide files in the order PowerPoint numbers them, not the order zip lists. */
export function slideOrder(names: string[]): string[] {
  return names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0))
}

// ---------------------------------------------------------------------------
// EPUB - the spine, in order
// ---------------------------------------------------------------------------

/** Where the OPF lives, from META-INF/container.xml. */
export function opfPath(containerXml: string): string | null {
  return /full-path="([^"]+)"/.exec(containerXml)?.[1] ?? null
}

/** The reading order: spine idrefs resolved through the manifest. */
export function spineFiles(opf: string, opfDir: string): string[] {
  const manifest = new Map<string, string>()
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /id="([^"]+)"/.exec(m[0])?.[1]
    const href = /href="([^"]+)"/.exec(m[0])?.[1]
    if (id && href) manifest.set(id, href)
  }
  const out: string[] = []
  for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/g)) {
    const href = manifest.get(m[1])
    if (href) out.push(opfDir ? `${opfDir}/${href}` : href)
  }
  return out
}

/** The body of one XHTML chapter, with its own <head> and scripts dropped. */
export function chapterBody(xhtml: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(xhtml)?.[1] ?? xhtml
  return body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

interface ZipLike {
  getEntries: () => Array<{ entryName: string; isDirectory: boolean; getData: () => Buffer }>
}

/** Read one named member of an open zip as text. */
function readText(zip: ZipLike, name: string): string | null {
  const hit = zip.getEntries().find((e) => e.entryName === name || e.entryName.replace(/^\.\//, '') === name)
  return hit ? hit.getData().toString('utf8') : null
}

/**
 * Turn a document into HTML. Returns the body only - the viewer supplies the
 * page around it - or null when the file is not one of these.
 */
export async function convertDoc(path: string): Promise<string | null> {
  const kind = docKind(extname(path))
  if (!kind) return null
  const AdmZip = (await import('adm-zip')).default
  const ext = extname(path).toLowerCase()

  if (kind === 'rtf') return rtfToHtml(readFileSync(path, 'latin1'))

  if (kind === 'word' && (ext === '.docx' || ext === '.docm')) {
    const mammoth = await import('mammoth')
    const r = await mammoth.convertToHtml(
      { path },
      {
        // Pictures come through as data URIs: there is nowhere else to put
        // them, and the page must not reach for anything off disk.
        convertImage: mammoth.images.imgElement(async (image) => {
          const buf = await image.read('base64')
          return { src: `data:${image.contentType};base64,${buf}` }
        })
      }
    )
    return r.value
  }

  if (kind === 'word' || (kind === 'slides' && ext === '.odp')) {
    const zip = new AdmZip(path) as unknown as ZipLike
    const xml = readText(zip, 'content.xml')
    return xml ? odfToHtml(xml) : null
  }

  if (kind === 'sheet') {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(readFileSync(path), { type: 'buffer' })
    return wb.SheetNames.map((name) => {
      const html = XLSX.utils.sheet_to_html(wb.Sheets[name], { id: 'sheet' })
      const table = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1] ?? ''
      return `<h2>${esc(name)}</h2>\n<table>${table}</table>`
    }).join('\n')
  }

  if (kind === 'slides') {
    const zip = new AdmZip(path) as unknown as ZipLike
    const names = zip.getEntries().map((e) => e.entryName)
    const slides = slideOrder(names)
    if (!slides.length) return null
    return slides
      .map((n, i) => {
        const body = slideToHtml(readText(zip, n) ?? '')
        return `<section><p class="slide-no">Slide ${i + 1}</p>\n${body || '<p><em>No text on this slide.</em></p>'}</section>`
      })
      .join('\n<hr />\n')
  }

  // epub
  const zip = new AdmZip(path) as unknown as ZipLike
  const container = readText(zip, 'META-INF/container.xml')
  const opfName = container ? opfPath(container) : null
  const opf = opfName ? readText(zip, opfName) : null
  if (!opf || !opfName) return null
  const dir = opfName.includes('/') ? opfName.slice(0, opfName.lastIndexOf('/')) : ''
  const files = spineFiles(opf, dir)
  if (!files.length) return null
  // A whole book at once is what a reader wants to scroll; a 900-page one is
  // also a lot of DOM, so it is capped and says so.
  const MAX = 400
  const parts = files.slice(0, MAX).map((f) => chapterBody(readText(zip, f) ?? ''))
  if (files.length > MAX) parts.push(`<p><em>Showing the first ${MAX} sections of ${files.length}.</em></p>`)
  return parts.join('\n<hr />\n')
}
