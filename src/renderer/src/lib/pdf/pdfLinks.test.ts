import { describe, expect, it } from 'vitest'
import { classifyAnnotation, linkLabel, rectToPercent, type RawAnnot } from './pdfLinks'

/** A Link annotation with whatever the case is adding. */
const link = (extra: Partial<RawAnnot>): RawAnnot => ({
  annotationType: 2,
  subtype: 'Link',
  ...extra
})

describe('what a PDF is allowed to make clickable', () => {
  it('allows an https link', () => {
    expect(classifyAnnotation(link({ url: 'https://example.com/a' }))).toEqual({
      kind: 'url',
      url: 'https://example.com/a'
    })
  })

  it('allows plain http as well', () => {
    expect(classifyAnnotation(link({ url: 'http://example.com/' }))?.kind).toBe('url')
  })

  it('allows an internal destination, named or explicit', () => {
    expect(classifyAnnotation(link({ dest: 'chapter-3' }))).toEqual({
      kind: 'dest',
      dest: 'chapter-3'
    })
    expect(
      classifyAnnotation(link({ dest: [{ num: 9, gen: 0 }, { name: 'XYZ' }, 0, 700, null] }))?.kind
    ).toBe('dest')
  })

  it('refuses anything that is not a Link', () => {
    // 20 is WIDGET: a form field, which is not a thing to click through to.
    expect(
      classifyAnnotation({ annotationType: 20, subtype: 'Widget', url: 'https://x.test/' })
    ).toBeNull()
    expect(
      classifyAnnotation({ annotationType: 2, subtype: 'Popup', url: 'https://x.test/' })
    ).toBeNull()
  })

  it('refuses a Launch, a GoToR and a JavaScript action - which arrive looking like a URL', () => {
    // This is the reason the allowlist is by shape. pdf.js flattens the action
    // name away: all three write the same `url` field, so the only defence is
    // that the resulting string is not http(s).
    expect(classifyAnnotation(link({ url: 'file:///C:/Windows/System32/calc.exe' }))).toBeNull()
    expect(classifyAnnotation(link({ url: 'C:\\Windows\\System32\\calc.exe' }))).toBeNull()
    expect(classifyAnnotation(link({ url: 'javascript:alert(1)' }))).toBeNull()
  })

  it('refuses the schemes pdf.js passes but Prism cannot open', () => {
    // ftp:, mailto: and tel: survive pdf.js's own filter and are dropped
    // silently by openExternal - a box that does nothing is worse than none.
    expect(classifyAnnotation(link({ url: 'ftp://files.test/x' }))).toBeNull()
    expect(classifyAnnotation(link({ url: 'mailto:a@b.test' }))).toBeNull()
    expect(classifyAnnotation(link({ url: 'tel:+4712345678' }))).toBeNull()
  })

  it('refuses every field that means something other than "go here"', () => {
    expect(classifyAnnotation(link({ action: 'NextPage' }))).toBeNull()
    expect(classifyAnnotation(link({ attachment: {}, url: 'https://x.test/' }))).toBeNull()
    expect(classifyAnnotation(link({ attachmentId: 'a1', url: 'https://x.test/' }))).toBeNull()
    expect(classifyAnnotation(link({ setOCGState: {}, url: 'https://x.test/' }))).toBeNull()
    expect(classifyAnnotation(link({ resetForm: {}, url: 'https://x.test/' }))).toBeNull()
    expect(classifyAnnotation(link({ actions: {}, url: 'https://x.test/' }))).toBeNull()
  })

  it('never falls back to unsafeUrl', () => {
    // The raw string out of the file, set whenever anything url-shaped was
    // parsed. A Link with only that is a Link with nothing.
    expect(classifyAnnotation(link({ unsafeUrl: 'C:/Windows/System32/calc.exe' }))).toBeNull()
    expect(
      classifyAnnotation(link({ unsafeUrl: 'https://evil.test/', url: 'not-a-url' }))
    ).toBeNull()
  })

  it('refuses a Link that points nowhere', () => {
    expect(classifyAnnotation(link({}))).toBeNull()
    expect(classifyAnnotation(link({ dest: 42 as unknown as string }))).toBeNull()
  })
})

describe('what the box says on hover', () => {
  it('names the host of an external link', () => {
    expect(linkLabel({ kind: 'url', url: 'https://docs.example.com/a/b?c=1' })).toBe(
      'docs.example.com'
    )
  })

  it('falls back rather than throwing on something URL() will not parse', () => {
    expect(linkLabel({ kind: 'url', url: 'https://' })).toBe('https://')
  })

  it('says nothing about a host for an internal one', () => {
    expect(linkLabel({ kind: 'dest', dest: 'x' })).toBe('In this document')
  })
})

describe('the geometry', () => {
  it('turns a rect into percentages of the page', () => {
    expect(rectToPercent([10, 20], [110, 70], 200, 100)).toEqual({
      left: 5,
      top: 20,
      width: 50,
      height: 50
    })
  })

  it('normalises a rect written corner-first the other way round', () => {
    // The spec only says the two corners are opposite, not which is which.
    expect(rectToPercent([110, 70], [10, 20], 200, 100)).toEqual({
      left: 5,
      top: 20,
      width: 50,
      height: 50
    })
  })

  it('drops a zero-area rect, which would take the hover and be unhittable', () => {
    expect(rectToPercent([10, 20], [10, 70], 200, 100)).toBeNull()
    expect(rectToPercent([10, 20], [110, 20], 200, 100)).toBeNull()
  })

  it('drops a page with no size, rather than dividing by it', () => {
    expect(rectToPercent([10, 20], [110, 70], 0, 100)).toBeNull()
  })

  it('drops a rect with a non-number in it', () => {
    expect(rectToPercent([10, NaN], [110, 70], 200, 100)).toBeNull()
    expect(rectToPercent([10], [110, 70], 200, 100)).toBeNull()
  })
})
