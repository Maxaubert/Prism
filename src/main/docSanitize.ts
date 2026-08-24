import type { Processor } from 'unified'

/**
 * The gate between somebody else's document and Prism's renderer.
 *
 * A .docx or an .epub is markup written by whoever sent it, and the window it
 * would land in can reach window.prism. So the HTML is filtered HERE, in main,
 * against an allowlist: elements that carry reading structure, and nothing
 * that can execute, navigate or fetch. Images are permitted only as the data:
 * URIs the converter itself produced.
 *
 * The unified stack is ESM-only, and main is bundled as CommonJS, so it is
 * loaded with a dynamic import the first time it is needed rather than at the
 * top of the file - a static import turns into an empty object here and the
 * app fails to start. (It did.)
 */

const schema = {
  tagNames: [
    'p', 'br', 'hr', 'div', 'span', 'section', 'article', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'img', 'figure', 'figcaption'
  ],
  attributes: {
    '*': ['className'],
    img: ['src', 'alt', 'width', 'height'],
    th: ['colSpan', 'rowSpan'],
    td: ['colSpan', 'rowSpan'],
    col: ['span']
  },
  // Only data: images. A document must not fetch anything: a remote <img> is
  // a read receipt, and file:// is somebody reading the disk.
  protocols: { src: ['data'] },
  // No links at all: a document should not be able to navigate the viewer,
  // and an <a> that goes nowhere is worse than the plain words.
  clobberPrefix: 'doc-',
  clobber: ['name', 'id'],
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  ancestors: {},
  required: {}
}

let pipeline: Processor | null = null

async function build(): Promise<Processor> {
  if (pipeline) return pipeline
  const [{ unified }, rehypeParse, rehypeSanitize, rehypeStringify] = await Promise.all([
    import('unified'),
    import('rehype-parse'),
    import('rehype-sanitize'),
    import('rehype-stringify')
  ])
  pipeline = unified()
    .use(rehypeParse.default, { fragment: true })
    .use(rehypeSanitize.default, schema)
    .use(rehypeStringify.default) as unknown as Processor
  return pipeline
}

/** Filter document HTML down to what is safe to show. */
export async function sanitizeDoc(html: string): Promise<string> {
  const p = await build()
  return String(await p.process(html))
}
