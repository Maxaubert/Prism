import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isElement, isNode, listenOn, ownDocument, ownWindow, viewerWindows, type OwnWindow } from './ownWindow'
import { addPageDocument, pageDocuments } from './pageDocuments'

/** A window that records what listens on it. */
function fakeWindow(name: string): OwnWindow & { heard: string[]; doc: Document } {
  const listeners = new Set<string>()
  const w = {
    name,
    heard: [] as string[],
    addEventListener: (type: string) => {
      listeners.add(type)
      w.heard.push(`+${type}`)
    },
    removeEventListener: (type: string) => {
      listeners.delete(type)
      w.heard.push(`-${type}`)
    }
  } as unknown as OwnWindow & { heard: string[]; doc: Document }
  const doc = { nodeType: 9, defaultView: w } as unknown as Document
  Object.assign(w, { doc, document: doc })
  return w
}

const here = fakeWindow('page')
const there = fakeWindow('preview')
const elIn = (w: { doc: Document }): Element =>
  ({ nodeType: 1, ownerDocument: w.doc }) as unknown as Element

describe('ownWindow (the preview window, owner 2026-11-08)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is the window of the node's own document", () => {
    vi.stubGlobal('window', here)
    expect(ownWindow(elIn(there))).toBe(there)
    expect(ownWindow(elIn(here))).toBe(here)
    // A document is its own.
    expect(ownWindow(there.doc)).toBe(there)
  })

  it("is this page's window for nothing, or a node with no window", () => {
    vi.stubGlobal('window', here)
    expect(ownWindow(null)).toBe(here)
    expect(ownWindow(undefined)).toBe(here)
    const loose = { nodeType: 1, ownerDocument: { nodeType: 9, defaultView: null } } as unknown as Element
    expect(ownWindow(loose)).toBe(here)
  })

  it("ownDocument follows an event's target, and is this page's for anything else", () => {
    // This page's document is the setup's (it cannot be stubbed).
    vi.stubGlobal('window', here)
    expect(ownDocument(elIn(there))).toBe(there.doc)
    expect(ownDocument(there.doc)).toBe(there.doc)
    expect(ownDocument(null)).toBe(document)
    expect(ownDocument(there as unknown as EventTarget)).toBe(document)
  })

  it('tells a node and an element from any window, where instanceof cannot', () => {
    expect(isElement(elIn(there))).toBe(true)
    expect(isNode(there.doc)).toBe(true)
    expect(isElement(there.doc)).toBe(false)
    expect(isNode(null)).toBe(false)
    expect(isNode({})).toBe(false)
    expect(isElement('div')).toBe(false)
  })
})

describe('viewerWindows and listenOn', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is this page's window alone for a viewer in this page, exactly as before", () => {
    vi.stubGlobal('window', here)
    expect(viewerWindows(here)).toEqual([here])
  })

  it("is the preview window's AND this page's for a viewer drawn in the window", () => {
    // Its own for a key pressed in it; the Explorer's, whose list sends on
    // the letters its type-to-jump did not take.
    vi.stubGlobal('window', here)
    expect(viewerWindows(there)).toEqual([there, here])
  })

  it('listens on each window and takes every listener off again', () => {
    here.heard.length = 0
    there.heard.length = 0
    const off = listenOn([there, here], 'keydown', () => {}, true)
    expect(there.heard).toEqual(['+keydown'])
    expect(here.heard).toEqual(['+keydown'])
    off()
    expect(there.heard).toEqual(['+keydown', '-keydown'])
    expect(here.heard).toEqual(['+keydown', '-keydown'])
  })
})

describe('pageDocuments', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is this page's document, and the preview window's while it is drawn into", () => {
    expect(pageDocuments()).toEqual([document])
    const undo = addPageDocument(there.doc)
    expect(pageDocuments()).toEqual([document, there.doc])
    undo()
    expect(pageDocuments()).toEqual([document])
  })
})

/**
 * THE GUARD: a viewer that can be drawn in the preview window never listens
 * on this page's `window` or `document` directly, and never looks up its own
 * elements, the focus or the selection in this page's `document`. It goes
 * through `ownWindow.ts` (`useViewerWindows` + `listenOn`, `ownWindow`,
 * `ownDocument`), or the line says why not: `// own-window-ok: <reason>` on it
 * or the line above.
 */
const VIEWERS = [
  'components/ImageView.tsx',
  'components/VideoView.tsx',
  'components/AudioView.tsx',
  'components/Transport.tsx',
  'components/Visualizer.tsx',
  'components/pdf/PdfView.tsx',
  'components/MarkdownView.tsx',
  'components/DocView.tsx',
  'components/DocFind.tsx',
  'components/CodeView.tsx',
  'components/ComicView.tsx',
  'components/browse/ArchiveCard.tsx',
  'hooks/useMediaControls.ts',
  'hooks/useFindShortcut.ts',
  'lib/autoHideChrome.ts'
]
const GLOBAL =
  /\b(window|document)\.(add|remove)EventListener\(|\bdocument\.(getElementById|querySelector|querySelectorAll|activeElement)\b|\bwindow\.getSelection\(/

describe("viewers listen on their own window (the guard)", () => {
  it.each(VIEWERS)('%s', (file) => {
    const lines = readFileSync(join(__dirname, '..', file), 'utf8').split('\n')
    const bad = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line, n }) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || !GLOBAL.test(line)) return false
        return !/own-window-ok:/.test(line) && !/own-window-ok:/.test(lines[n - 2] ?? '')
      })
      .map(({ line, n }) => `${file}:${n}: ${line.trim()}`)
    expect(bad).toEqual([])
  })
})
