/**
 * Build the e2e fixture folder: a copy of the README with the local assets it
 * references (same relative layout), a hand-authored three-page PDF with known
 * text, and enough mixed media for the navigation-filter scenarios.
 *
 * The PDF is written object by object with a computed xref, so it is a fully
 * valid file, with exactly five case-mixed "grape" tokens across its pages.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
export const FIXTURES = join(ROOT, '.e2e', 'fixtures')

/** Serif-free single-font PDF: `pages` is an array of line arrays. */
function makePdf(pages) {
  const objects = []
  const pageRefs = pages.map((_, i) => `${4 + i * 2} 0 R`)
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages.length} >>\nendobj\n`
  )
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`)
  pages.forEach((lines, i) => {
    const content = [
      'BT',
      '/F1 18 Tf',
      '72 720 Td',
      '22 TL',
      ...lines.map((l) => `(${l.replace(/[\\()]/g, (c) => '\\' + c)}) Tj T*`),
      'ET'
    ].join('\n')
    objects.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>\nendobj\n`
    )
    objects.push(
      `${5 + i * 2} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`
    )
  })

  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const o of objects) {
    offsets.push(pdf.length)
    pdf += o
  }
  const xrefAt = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// A real (tiny) PNG: 1x1 indigo pixel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M9QDwADgQF/e5IkGQAAAABJRU5ErkJggg==',
  'base64'
)

export function buildFixtures() {
  rmSync(FIXTURES, { recursive: true, force: true })
  mkdirSync(FIXTURES, { recursive: true })

  // The README, with its local assets where it expects them.
  cpSync(join(ROOT, 'README.md'), join(FIXTURES, 'README.md'))
  mkdirSync(join(FIXTURES, 'build'), { recursive: true })
  cpSync(join(ROOT, 'build', 'icon.png'), join(FIXTURES, 'build', 'icon.png'))
  mkdirSync(join(FIXTURES, 'docs', 'media'), { recursive: true })
  for (const f of ['prism.webp', 'prism.avif']) {
    cpSync(join(ROOT, 'docs', 'media', f), join(FIXTURES, 'docs', 'media', f))
  }

  // Three known pages; exactly five case-insensitive "grape" tokens in all.
  writeFileSync(
    join(FIXTURES, 'sample.pdf'),
    makePdf([
      ['Prism sample document', 'A grape and another GRAPE sit on page one.'],
      ['The second page mentions grape once.'],
      ['The last page ends with grape and Grape.']
    ])
  )

  // Mixed kinds for the filter scenarios: 2 images + 1 audio (media) and
  // pdf + md (documents) = 5 viewables in "all".
  writeFileSync(join(FIXTURES, 'one.png'), PNG)
  writeFileSync(join(FIXTURES, 'two.png'), PNG)
  writeFileSync(join(FIXTURES, 'song.mp3'), Buffer.alloc(128)) // listed by extension
  return FIXTURES
}
