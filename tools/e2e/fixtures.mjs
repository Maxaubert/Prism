/**
 * Build the e2e fixture folder: a copy of the README with the local assets it
 * references (same relative layout), a hand-authored three-page PDF with known
 * text, and enough mixed media for the navigation-filter scenarios.
 *
 * The PDF is written object by object with a computed xref, so it is a fully
 * valid file, with exactly five case-mixed "grape" tokens across its pages.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import AdmZip from 'adm-zip'
import { spawnSync } from 'node:child_process'
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
  // pdf + md + txt (documents) = 6 viewables in "all".
  writeFileSync(join(FIXTURES, 'one.png'), PNG)
  writeFileSync(join(FIXTURES, 'two.png'), PNG)
  writeFileSync(join(FIXTURES, 'song.mp3'), Buffer.alloc(128)) // listed by extension
  writeFileSync(join(FIXTURES, 'notes.txt'), 'alpha beta\n') // the edit scenario's canvas

  // A folder of source files for the code scenario. It lives one level down so
  // the root counts the filter scenario asserts on stay put. Name order is
  // bad.json, broken.ts, hello.sh, main.py - the paging order the tests use.
  mkdirSync(join(FIXTURES, 'code'), { recursive: true })
  writeFileSync(
    join(FIXTURES, 'code', 'main.py'),
    'import sys\n\n\nclass Greeter:\n    """Says hello."""\n\n    def __init__(self, name: str) -> None:\n        self.name = name\n\n    def greet(self, times=1):\n        for i in range(times):\n            print(f"hello {self.name} #{i}")\n        return 42\n\n\nif __name__ == "__main__":\n    Greeter(sys.argv[1]).greet(3)\n'
  )
  // One unmistakable syntax error: an opening paren that never closes.
  writeFileSync(
    join(FIXTURES, 'code', 'broken.ts'),
    'export function add(a: number, b: number {\n  return a + b\n}\n'
  )
  // A trailing comma, the mistake JSON.parse explains better than the grammar.
  writeFileSync(join(FIXTURES, 'code', 'bad.json'), '{\n  "name": "prism",\n  "ok": true,\n}\n')
  // A subfolder, so the tree cursor has a folder row to step onto and walk into.
  mkdirSync(join(FIXTURES, 'code', 'nested', 'level-two'), { recursive: true })
  writeFileSync(join(FIXTURES, 'code', 'nested', 'level-two', 'buried.py'), 'VALUE = 42\n')

  // Stream-lexed: coloured, never underlined, however odd it looks.
  writeFileSync(
    join(FIXTURES, 'code', 'hello.sh'),
    '#!/usr/bin/env bash\nset -euo pipefail\nfor f in *.txt; do\n  echo "$f"\ndone\n'
  )

  // Two short "episodes" for the player scenario (ffmpeg test pattern), and a
  // sidecar subtitle for the first, named the way the whole world names them.
  for (const ep of ['ep1', 'ep2']) {
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1.5:size=320x240:rate=10', '-pix_fmt', 'yuv420p', join(FIXTURES, `${ep}.mp4`)],
      { windowsHide: true }
    )
    if (r.status !== 0) throw new Error('ffmpeg is needed to build the player fixtures')
  }
  // A file Prism cannot show, in its own folder so the root counts the filter
  // scenario asserts on stay put. It is never listed by listDir, so opening it
  // is the only way to reach it - which is exactly the case being tested.
  mkdirSync(join(FIXTURES, 'misc'), { recursive: true })
  mkdirSync(join(FIXTURES, 'zips'), { recursive: true })
  // (.7z since #68: .zip opens for real now and has its own scenario.)
  const zip = Buffer.alloc(2048)
  zip.write('PK', 'latin1')
  writeFileSync(join(FIXTURES, 'misc', 'archive.7z'), zip)
  // A REAL zip for the archive scenario: known members, sizes and nesting.
  const bundle = new AdmZip()
  bundle.addFile('readme.txt', Buffer.from('hello from inside the zip'))
  bundle.addFile('notes/todo.md', Buffer.from('# todo\n- try prism\n'))
  bundle.addFile('notes/deep/extra.txt', Buffer.from('deep'))
  bundle.writeZip(join(FIXTURES, 'zips', 'bundle.zip'))
  // Somewhere for a member dragged OUT of the archive to land (#70), and a
  // little tree of its own for the sidebar's move.
  mkdirSync(join(FIXTURES, 'zips', 'out'), { recursive: true })
  // Its own zip for the drag scenario: the archive scenario mutates bundle.zip.
  const dragzip = new AdmZip()
  dragzip.addFile('carry.txt', Buffer.from('carried out of the zip'))
  dragzip.addFile('sub/nested.txt', Buffer.from('nested'))
  dragzip.writeZip(join(FIXTURES, 'zips', 'dragzip.zip'))
  mkdirSync(join(FIXTURES, 'dragbox', 'into'), { recursive: true })
  writeFileSync(join(FIXTURES, 'dragbox', 'movable.txt'), 'drag me')
  writeFileSync(join(FIXTURES, 'dragbox', 'anchor.txt'), 'stay')

  writeFileSync(
    join(FIXTURES, 'ep1.en.srt'),
    '1\r\n00:00:00,200 --> 00:00:01,300\r\nHELLO SUBS\r\n'
  )
  return FIXTURES
}
