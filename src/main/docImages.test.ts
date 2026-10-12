import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeAll, describe, expect, it } from 'vitest'
import { documentImages, isMarkdownPath } from './docImages'

let docs: string
let assets: string

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'prism-docimg-'))
  docs = join(root, 'docs')
  assets = join(root, 'assets')
  mkdirSync(docs, { recursive: true })
  mkdirSync(assets, { recursive: true })
  writeFileSync(join(assets, 'logo.png'), '')
  writeFileSync(join(assets, 'a b.png'), '')
  writeFileSync(join(assets, 'secrets.txt'), '')
  writeFileSync(join(docs, 'here.png'), '')
})

const doc = (): string => join(docs, 'README.md')

describe('what a document is allowed to show', () => {
  it('grants a picture ABOVE its own folder, which the wall refused', async () => {
    expect(await documentImages(doc(), '![logo](../assets/logo.png)')).toEqual([join(assets, 'logo.png')])
  })

  it('grants one beside it too', async () => {
    expect(await documentImages(doc(), '![](./here.png)')).toEqual([join(docs, 'here.png')])
  })

  it('reads an <img> tag as well as markdown', async () => {
    expect(await documentImages(doc(), '<img src="../assets/logo.png" alt="x">')).toEqual([
      join(assets, 'logo.png')
    ])
  })

  it('decodes a percent-escaped name', async () => {
    expect(await documentImages(doc(), '![](../assets/a%20b.png)')).toEqual([join(assets, 'a b.png')])
  })

  it('ignores a url, a data: image and a protocol-relative one', async () => {
    const text = '![](https://x/y.png) ![](data:image/png;base64,AAA) ![](//cdn/z.png)'
    expect(await documentImages(doc(), text)).toEqual([])
  })

  it('grants nothing that is not an image file', async () => {
    expect(await documentImages(doc(), '![](../assets/secrets.txt)')).toEqual([])
  })

  it('grants nothing that does not exist', async () => {
    expect(await documentImages(doc(), '![](../assets/missing.png)')).toEqual([])
  })

  it('never grants the same file twice', async () => {
    const text = '![](../assets/logo.png)' + String.fromCharCode(10) + '![again](../assets/logo.png)'
    expect(await documentImages(doc(), text)).toEqual([join(assets, 'logo.png')])
  })

  it('drops the fragment and the query a url may carry', async () => {
    expect(await documentImages(doc(), '![](../assets/logo.png?v=2#top)')).toEqual([
      join(assets, 'logo.png')
    ])
  })

  it('grants nothing named by an ABSOLUTE path', async () => {
    // A document points at what sits beside it. An absolute reference would
    // let any .md open a picture anywhere on the disk.
    expect(await documentImages(doc(), '![](' + join(assets, 'logo.png') + ')')).toEqual([])
    expect(await documentImages(doc(), '![](/assets/logo.png)')).toEqual([])
  })

  it('stops at the cap, counting only files that exist', async () => {
    const refs: string[] = []
    for (let i = 0; i < 150; i++) refs.push(`![](../assets/missing-${i}.png)`)
    for (let i = 0; i < 260; i++) {
      writeFileSync(join(assets, `n${i}.png`), '')
      refs.push(`![](../assets/n${i}.png)`)
    }
    const got = await documentImages(doc(), refs.join(' '))
    expect(got).toHaveLength(200)
    expect(got[0]).toBe(join(assets, 'n0.png'))
    expect(got[199]).toBe(join(assets, 'n199.png'))
  })

  it('knows a markdown file when it sees one', () => {
    expect(isMarkdownPath('a/b/README.md')).toBe(true)
    expect(isMarkdownPath('notes.markdown')).toBe(true)
    expect(isMarkdownPath('code.ts')).toBe(false)
  })
})
