import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { isAnchor, isExternal, resolveMdUrl } from '../lib/mdUrl'
import '../assets/md.css'

// The markdown viewer: a document, not a code dump. GFM plus the inline HTML a
// README leans on (badges, <picture> films, <video>, alignment), sanitized so a
// downloaded file can never run anything, with local assets served over
// fsmedia:// and web links opened in the system browser.

// What sanitize keeps beyond its GitHub-style defaults: presentational media and
// structure only. Scripts, styles, iframes and event handlers stay stripped.
const SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'picture', 'source', 'video', 'audio', 'details', 'summary', 'kbd'
  ],
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'srcSet', 'width', 'height', 'align', 'title'],
    source: ['src', 'srcSet', 'type', 'media'],
    video: ['src', 'poster', 'controls', 'loop', 'muted', 'playsInline', 'width', 'height'],
    audio: ['src', 'controls', 'loop'],
    details: ['open'],
    // 'checked' only: the default schema already pins input to a disabled
    // checkbox, and adding 'type' back unrestricted would let text inputs in.
    input: [...(defaultSchema.attributes?.input ?? []), 'checked'],
    div: [...(defaultSchema.attributes?.div ?? []), 'align'],
    p: [...(defaultSchema.attributes?.p ?? []), 'align'],
    h1: ['align'], h2: ['align'], h3: ['align'], h4: ['align'], h5: ['align'], h6: ['align'],
    td: [...(defaultSchema.attributes?.td ?? []), 'align'],
    th: [...(defaultSchema.attributes?.th ?? []), 'align']
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), 'data', 'fsmedia']
  }
}

/** GitHub's heading anchor, near enough: lowercase, spaces to dashes. */
const slug = (text: string): string =>
  text.toLowerCase().trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-')

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node as { props: { children?: unknown } }).props.children)
  return ''
}

/** Resolve every candidate in a srcset (sanitize saw it whole; the entries
 *  inside still need the same per-URL policy as src). */
function fixSrcSet(srcSet: string | undefined, baseDir: string): string | undefined {
  if (!srcSet) return undefined
  const fixed = srcSet
    .split(',')
    .map((part) => {
      const [url, ...desc] = part.trim().split(/\s+/)
      const r = resolveMdUrl(url, baseDir)
      return r ? [r, ...desc].join(' ') : ''
    })
    .filter(Boolean)
    .join(', ')
  return fixed || undefined
}

export function MarkdownView({
  path,
  onOpenLocal
}: {
  path: string
  /** A relative link pointed at a local file; App decides whether it opens. */
  onOpenLocal: (path: string) => void
}): JSX.Element {
  // Keyed by path so a stale document never shows for the wrong file: the load
  // effect fills it in, and the render below ignores an entry for another path.
  const [loaded, setLoaded] = useState<{ path: string; text: string } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  // The folder the document lives in, which its relative paths resolve against.
  const baseDir = useMemo(() => path.replace(/[\\/][^\\/]*$/, ''), [path])
  const text = loaded?.path === path ? loaded.text : null

  useEffect(() => {
    let alive = true
    void window.prism
      .readText(path)
      .then((t) => alive && setLoaded({ path, text: t ?? '(could not read file)' }))
    return () => {
      alive = false
    }
  }, [path])

  // Deliberately NOT focused on open. A document earns the vertical keys by
  // being clicked into (or tabbed to), never by merely being on screen: taking
  // them on arrival is what used to leave Up/Down dead while the user was only
  // paging through the folder from the sidebar. Escape gives them back.

  const followAnchor = (fragment: string): void => {
    const raw = decodeURIComponent(fragment)
    let target =
      document.getElementById(raw) ??
      document.getElementById(`user-content-${raw}`) ??
      document.getElementById(slug(raw))
    if (!target) {
      // GitHub disambiguates duplicate headings as slug-1, slug-2...; our
      // headings share the plain slug, so the suffix picks among them here.
      const m = /^(.+)-(\d+)$/.exec(slug(raw))
      if (m) {
        const twins = document.querySelectorAll(`[id="${CSS.escape(m[1])}"]`)
        target = (twins[Number(m[2])] as HTMLElement | undefined) ?? null
      }
    }
    target?.scrollIntoView({ block: 'start' })
  }

  const followLink = (e: MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    e.preventDefault()
    if (isExternal(href)) {
      window.open(href) // main's window-open handler routes this to the browser
    } else if (isAnchor(href)) {
      followAnchor(href.slice(1))
    } else if (href.startsWith('fsmedia://local/')) {
      // A relative link, already resolved by urlTransform: back to its path.
      onOpenLocal(decodeURIComponent(href.slice('fsmedia://local/'.length)))
    }
  }

  const onClick = followLink
  // Middle-click would otherwise ask the browser to open the href in a new
  // window, which main forwards to the OS - nonsense for an fsmedia:// URL.
  const onAuxClick = (e: MouseEvent): void => {
    if (e.button === 1) followLink(e)
  }

  const components = useMemo<Components>(() => {
    const heading =
      (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
      ({ children, ...rest }: JSX.IntrinsicElements['h1']): JSX.Element => (
        <Tag id={slug(textOf(children))} {...rest}>
          {children}
        </Tag>
      )
    return {
      h1: heading('h1'), h2: heading('h2'), h3: heading('h3'),
      h4: heading('h4'), h5: heading('h5'), h6: heading('h6'),
      img: ({ srcSet, ...rest }) => <img {...rest} srcSet={fixSrcSet(srcSet, baseDir)} />,
      source: ({ srcSet, ...rest }) => <source {...rest} srcSet={fixSrcSet(srcSet, baseDir)} />
    }
  }, [baseDir])

  return (
    <div
      ref={box}
      // 0, not -1: Tab is the keyboard's way into the document, and clicking
      // anywhere inside lands focus here too.
      tabIndex={0}
      data-doc-scroller
      onClick={onClick}
      onAuxClick={onAuxClick}
      className="h-full w-full overflow-y-auto outline-none select-text"
    >
      {text === null ? (
        <div className="delayed-loader grid h-full place-items-center">
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
        </div>
      ) : (
        <div className="p-md mx-auto max-w-[780px] px-6 py-10">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
            urlTransform={(url) => resolveMdUrl(url, baseDir)}
            components={components}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}
