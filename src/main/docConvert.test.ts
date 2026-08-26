import { describe, expect, it } from 'vitest'
import { chapterBody, docKind, odfToHtml, opfPath, rtfToHtml, slideOrder, slideToHtml, spineFiles } from './docConvert'
import { sanitizeDoc } from './docSanitize'

describe('which files are documents', () => {
  it('claims the office and ebook formats', () => {
    for (const e of ['.docx', '.odt', '.rtf', '.xlsx', '.ods', '.pptx', '.odp', '.epub']) {
      expect(docKind(e), e).not.toBeNull()
    }
  })

  it('leaves everything else alone', () => {
    // .pdf has its own viewer; .md and .txt are the text viewer's.
    for (const e of ['.pdf', '.md', '.txt', '.zip', '.png']) expect(docKind(e), e).toBeNull()
  })

  it('is case-insensitive, as Windows is', () => {
    expect(docKind('.DOCX')).toBe('word')
  })
})

describe('RTF', () => {
  it('keeps the words and the paragraph breaks', () => {
    const rtf = '{\\rtf1\\ansi\\deff0 Hello there\\par Second line\\par}'
    const html = rtfToHtml(rtf)
    expect(html).toContain('<p>Hello there</p>')
    expect(html).toContain('<p>Second line</p>')
  })

  it('drops the tables that carry no readable text', () => {
    const rtf = '{\\rtf1{\\fonttbl{\\f0 Arial;}}{\\colortbl;\\red0\\green0\\blue0;}Body text\\par}'
    expect(rtfToHtml(rtf)).toBe('<p>Body text</p>')
  })

  it('brings back accented and unicode characters', () => {
    expect(rtfToHtml("{\\rtf1 caf\\'e9\\par}")).toContain('café')
    expect(rtfToHtml('{\\rtf1 \\u8212? dash\\par}')).toContain('—')
  })

  it('escapes what it finds rather than trusting it', () => {
    expect(rtfToHtml('{\\rtf1 <script>alert(1)</script>\\par}')).not.toContain('<script>')
  })
})

describe('OpenDocument', () => {
  const odt = `<?xml version="1.0"?><office:document-content><office:body><office:text>
    <text:h text:outline-level="1">The Title</text:h>
    <text:p>First paragraph with <text:span>a span</text:span> inside.</text:p>
    <text:p/>
    <text:p>Caf&#233; &amp; cream</text:p>
  </office:text></office:body></office:document-content>`

  it('turns headings into headings and paragraphs into paragraphs', () => {
    const html = odfToHtml(odt)
    expect(html).toContain('<h2>The Title</h2>')
    expect(html).toContain('<p>First paragraph with a span inside.</p>')
  })

  it('skips empty paragraphs rather than filling the page with blanks', () => {
    expect(odfToHtml(odt).match(/<p>/g)?.length).toBe(2)
  })

  it('decodes entities', () => {
    expect(odfToHtml(odt)).toContain('Café &amp; cream')
  })
})

describe('PowerPoint', () => {
  it('reads slides in the order PowerPoint numbers them', () => {
    // Zip order is arbitrary, and slide10 sorts before slide2 as text.
    const names = ['ppt/slides/slide10.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide1.xml', 'ppt/theme/theme1.xml']
    expect(slideOrder(names)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide10.xml'
    ])
  })

  it('takes the first line as the slide title', () => {
    const xml = '<p:sld><a:p><a:r><a:t>Quarterly results</a:t></a:r></a:p><a:p><a:r><a:t>Revenue up</a:t></a:r></a:p></p:sld>'
    const html = slideToHtml(xml)
    expect(html).toContain('<h2>Quarterly results</h2>')
    expect(html).toContain('<p>Revenue up</p>')
  })

  it('joins the runs a single line is split across', () => {
    // PowerPoint splits a line at every formatting change.
    const xml = '<a:p><a:r><a:t>Hello </a:t></a:r><a:r><a:t>world</a:t></a:r></a:p>'
    expect(slideToHtml(xml)).toContain('<h2>Hello world</h2>')
  })

  it('says nothing for a slide with no text', () => {
    expect(slideToHtml('<p:sld><p:pic/></p:sld>')).toBe('')
  })
})

describe('EPUB', () => {
  it('finds the OPF from the container', () => {
    expect(opfPath('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')).toBe(
      'OEBPS/content.opf'
    )
    expect(opfPath('<container/>')).toBeNull()
  })

  it('reads the spine in reading order, not manifest order', () => {
    const opf = `<package><manifest>
        <item id="c2" href="ch2.xhtml"/>
        <item id="c1" href="ch1.xhtml"/>
        <item id="css" href="style.css"/>
      </manifest><spine>
        <itemref idref="c1"/><itemref idref="c2"/>
      </spine></package>`
    expect(spineFiles(opf, 'OEBPS')).toEqual(['OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml'])
  })

  it('takes the body of a chapter and drops its script and style', () => {
    const x = '<html><head><style>p{}</style></head><body><p>Chapter one</p><script>evil()</script></body></html>'
    const body = chapterBody(x)
    expect(body).toContain('<p>Chapter one</p>')
    expect(body).not.toContain('evil()')
  })
})

describe('the sanitiser between a document and the window', async () => {
  it('keeps the structure a reader needs', async () => {
    const html = await sanitizeDoc('<h1>Title</h1><p>Body <strong>bold</strong></p><table><tr><td>1</td></tr></table>')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<td>1</td>')
  })

  it('strips script, however it is spelled', async () => {
    expect(await sanitizeDoc('<script>alert(1)</script>')).not.toContain('alert')
    expect(await sanitizeDoc('<SCRIPT>alert(1)</SCRIPT>')).not.toContain('alert')
    expect(await sanitizeDoc('<div><script src="x.js"></script></div>')).not.toContain('script')
  })

  it('strips event handlers', async () => {
    const out = await sanitizeDoc('<p onclick="steal()" onerror="steal()">text</p>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('steal')
  })

  it('refuses an image that would fetch from anywhere but the document itself', async () => {
    // The converter emits data: URIs; anything else is somebody phoning home.
    expect(await sanitizeDoc('<img src="https://tracker.example/pixel.png">')).not.toContain('tracker')
    expect(await sanitizeDoc('<img src="file:///C:/Windows/win.ini">')).not.toContain('win.ini')
    expect(await sanitizeDoc('<img src="data:image/png;base64,AAAA">')).toContain('data:image/png')
  })

  it('drops iframes, objects and forms outright', async () => {
    expect(await sanitizeDoc('<iframe src="data:text/html,x"></iframe>')).not.toContain('iframe')
    expect(await sanitizeDoc('<object data="x"></object>')).not.toContain('object')
    expect(await sanitizeDoc('<form action="x"><input name="p"></form>')).not.toContain('<form')
  })

  it('drops links: a document must not navigate the viewer', async () => {
    const out = await sanitizeDoc('<a href="javascript:evil()">click</a>')
    expect(out).not.toContain('href')
    expect(out).not.toContain('javascript')
    expect(out).toContain('click') // the words survive; the link does not
  })
})
