import { afterAll, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { convertDoc } from './docConvert'

// mammoth still converts a .docx with the overridden @xmldom/xmldom (audit #35).

let dir = ''
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('docx conversion through mammoth', () => {
  it('turns a minimal .docx into html', async () => {
    dir = await mkdtemp(join(tmpdir(), 'prism-docx-'))
    const zip = new AdmZip()
    zip.addFile(
      '[Content_Types].xml',
      Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    )
    zip.addFile(
      '_rels/.rels',
      Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    )
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:body><w:p><w:r><w:t>Hello Prism</w:t></w:r></w:p></w:body></w:document>'
      )
    )
    const file = join(dir, 'a.docx')
    await writeFile(file, zip.toBuffer())
    const html = await convertDoc(file)
    expect(html).toContain('Hello Prism')
  })
})