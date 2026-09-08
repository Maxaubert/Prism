import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import { ContextMenu } from './ContextMenu'
import { fileVerbs } from '../lib/fileVerbs'
import { touchesFile } from '../lib/fileReload'
import { DocFind } from './DocFind'
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
  const baseDir = useMemo(() => path.replace(/[\\/][^\\/]*$/, ''), [path])
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
      window.open(href) // main's window-open handler routes this to the browser
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

  /**
   * Ctrl+F belongs to the document you are LOOKING at (2026-08-30).
   *
   * A window listener is right - nothing focuses a document on arrival, so
   * this key has to work without focus - but "the window" holds more than one
   * viewer: split view mounts up to four, and the media deck keeps others
   * alive behind the strip. Without an ownership test every mounted document
   * opened its own find bar, and the last one to register won the focus, so
   * pressing Ctrl+F over a PDF opened the markdown pane's bar instead.
   *
   * Three tests, cheapest first: not covered by Settings (`[inert]`, the same
   * check PdfView makes), not in a hidden tab, and either this pane holds the
   * focus or nothing in another pane does.
   */
  const ownsKeys = (): boolean => {
    const el = box.current
    if (!el || el.closest('[inert]') || el.closest('[hidden]')) return false
    if (!el.isConnected || !el.offsetParent) return false
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body) {
      // Somebody has the focus: only the pane containing it may answer.
      const pane = active.closest('[data-doc-scroller], .cm-editor, [data-pdf-scroller]')
      if (pane && pane !== el && !el.contains(active)) return false
    }
    return true
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey && (e.key === 'f' || e.key === 'F'))) return
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return
      if (!ownsKeys()) return
      e.preventDefault()
      e.stopPropagation()
      setFinding(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

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
          items={[
            { label: 'Find', hint: 'Ctrl+F', onPick: () => setFinding(true) },
            ...fileVerbs(path)
          ]}
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
          <div className="delayed-loader grid h-full place-items-center">
            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
          </div>
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
