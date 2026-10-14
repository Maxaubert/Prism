import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import { ContextMenu } from './ContextMenu'
import { parentDir } from '@shared/path'
import { markdownMenu } from '../menus/viewers/markdown'
import { touchesFile } from '../lib/fileReload'
import { DocFind } from './DocFind'
import { LoadingState } from './LoadingState'
import { useFindShortcut } from '../hooks/useFindShortcut'
import { openDocAt, rememberDocPos, saveDocPos } from '../lib/docPosition'

/** How far the reader must move before the position is written to disk. */
const SAVE_STEP = 200
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
    'picture',
    'source',
    'video',
    'audio',
    'details',
    'summary',
    'kbd'
  ],
  attributes: {
    ...defaultSchema.attributes,
    img: [
      ...(defaultSchema.attributes?.img ?? []),
      'src',
      'srcSet',
      'width',
      'height',
      'align',
      'title'
    ],
    source: ['src', 'srcSet', 'type', 'media'],
    video: ['src', 'poster', 'controls', 'loop', 'muted', 'playsInline', 'width', 'height'],
    audio: ['src', 'controls', 'loop'],
    details: ['open'],
    // 'checked' only: the default schema already pins input to a disabled
    // checkbox, and adding 'type' back unrestricted would let text inputs in.
    input: [...(defaultSchema.attributes?.input ?? []), 'checked'],
    div: [...(defaultSchema.attributes?.div ?? []), 'align'],
    p: [...(defaultSchema.attributes?.p ?? []), 'align'],
    h1: ['align'],
    h2: ['align'],
    h3: ['align'],
    h4: ['align'],
    h5: ['align'],
    h6: ['align'],
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
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-')

const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node as { props: { children?: unknown } }).props.children)
  return ''
}

/** Resolve every candidate in a srcset (sanitize saw it whole; the entries
 *  inside still need the same per-URL policy as src). */
function fixSrcSet(
  srcSet: string | undefined,
  baseDir: string,
  toUrl: (path: string) => string
): string | undefined {
  if (!srcSet) return undefined
  const fixed = srcSet
    .split(',')
    .map((part) => {
      const [url, ...desc] = part.trim().split(/\s+/)
      const r = resolveMdUrl(url, baseDir, toUrl)
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
  /** Which path the restore has run for, so it happens once per file. */
  const restoredFor = useRef<string | null>(null)
  const lastSaved = useRef(0)
  const [finding, setFinding] = useState(false)
  // The bar belongs to the document it was opened on. Paging to the next file
  // left it up, still counting matches in a document that is no longer there:
  // its Ranges point at detached nodes, so the arrows scrolled nothing. Done
  // while RENDERING, the way the viewer resets everything else per file - an
  // effect would show one frame of the old bar over the new document.
  const [findFor, setFindFor] = useState(path)
  if (findFor !== path) {
    setFindFor(path)
    setFinding(false)
  }
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // The folder the document lives in, which its relative paths resolve against.
  const baseDir = useMemo(() => parentDir(path), [path])
  const text = loaded?.path === path ? loaded.text : null
  /**
   * The local files this document's links name, by the url each became
   * (#106). `resolveMdUrl` builds a local url through the bridge's own
   * `mediaUrl` now, which on the phone is `/m/<path>?t=<token>` and cannot be
   * read back by prefix the way fsmedia:// could, so the mapping is kept as
   * the links are resolved. A ref, because it is written from inside the
   * render that resolves them; emptied when the path changes, which lands
   * before the new document's text has arrived and so before any of its
   * links are resolved.
   */
  const localHrefs = useRef(new Map<string, string>())
  useEffect(() => {
    localHrefs.current.clear()
  }, [path])
  const toUrl = useCallback((p: string): string => {
    const u = window.prism.mediaUrl(p)
    localHrefs.current.set(u, p)
    return u
  }, [])

  /** Reads in flight, so a slow one landing late never overwrites a newer
   *  document with an older one. */
  const readGen = useRef(0)
  const read = useCallback((): void => {
    const mine = ++readGen.current
    void window.prism.readText(path).then((r) => {
      if (readGen.current !== mine) return
      setLoaded({
        path,
        text:
          'text' in r
            ? r.text
            : r.error === 'too-large'
              ? '_This document is too large to render (over 64MB)._'
              : '_This document could not be read._'
      })
    })
  }, [path])

  useEffect(() => read(), [read])

  // A rendered document has no unsaved state, so a rewrite from outside Prism
  // is simply the document changing: re-read it (2026-08-31). No stamp check
  // and no dialog - the worst case is one extra read of a file that did not
  // move, which for the folder the user is looking at is nothing.
  useEffect(
    () =>
      window.prism.onDirChanged((c) => {
        if (touchesFile(path, c)) read()
      }),
    [path, read]
  )

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
      // Main's window-open handler routes this to the browser. On the phone it
      // is a real tab, so it gets no handle back to this page (review,
      // 2026-10-14: an opened site could otherwise redirect the Prism tab).
      window.open(href, '_blank', 'noopener,noreferrer')
    } else if (isAnchor(href)) {
      followAnchor(href.slice(1))
    } else {
      // A relative link, already resolved by urlTransform: back to its path.
      // The prefix is the fallback for an fsmedia:// link written into the
      // document itself, which passes through the transform untouched.
      const local =
        localHrefs.current.get(href) ??
        (href.startsWith('fsmedia://local/')
          ? decodeURIComponent(href.slice('fsmedia://local/'.length))
          : null)
      if (local !== null) onOpenLocal(local)
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
      h1: heading('h1'),
      h2: heading('h2'),
      h3: heading('h3'),
      h4: heading('h4'),
      h5: heading('h5'),
      h6: heading('h6'),
      img: ({ srcSet, ...rest }) => <img {...rest} srcSet={fixSrcSet(srcSet, baseDir, toUrl)} />,
      source: ({ srcSet, ...rest }) => (
        <source {...rest} srcSet={fixSrcSet(srcSet, baseDir, toUrl)} />
      )
    }
  }, [baseDir, toUrl])

  /**
   * Open where you left off, and Ctrl+F.
   *
   * This view had no scroll handling at all: switching between two markdown
   * files kept the previous file's scrollTop on the reused div, so a long
   * README opened halfway down for no reason anyone could see. The restore
   * fixes that as well as remembering the place.
   */
  useEffect(() => {
    if (text === null) return
    if (restoredFor.current === path) return
    restoredFor.current = path
    const el = box.current
    if (!el) return
    requestAnimationFrame(() => {
      const want = openDocAt(path)
      el.scrollTo({ top: want > 0 ? want : 0 })
    })
  }, [text, path])

  // Ctrl+F opens the find bar over the document you are looking at.
  useFindShortcut(box, () => setFinding(true))

  return (
    <div
      className="relative h-full w-full"
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {finding && <DocFind scroller={box} onClose={() => setFinding(false)} />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={markdownMenu({ path, find: () => setFinding(true) })}
        />
      )}
      <div
        ref={box}
        // 0, not -1: Tab is the keyboard's way into the document, and clicking
        // anywhere inside lands focus here too.
        tabIndex={0}
        data-doc-scroller
        onClick={onClick}
        onAuxClick={onAuxClick}
        onScroll={(e) => {
          const el = e.currentTarget
          rememberDocPos(path, el.scrollTop)
          if (Math.abs(el.scrollTop - lastSaved.current) < SAVE_STEP) return
          lastSaved.current = el.scrollTop
          saveDocPos(path, el.scrollTop, el.scrollHeight - el.clientHeight)
        }}
        className="h-full w-full overflow-y-auto outline-none select-text"
      >
        {text === null ? (
          <LoadingState className="h-full" />
        ) : (
          <div className="p-md mx-auto max-w-[780px] px-6 py-10">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA]]}
              urlTransform={(url) => resolveMdUrl(url, baseDir, toUrl)}
              components={components}
            >
              {text}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
