import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { lintKeymap } from '@codemirror/lint'
import { isProse, langFor } from '../lib/codeLang'
import { jsonLinter, syntaxLinter } from '../lib/codeLint'
import { prismCodeTheme } from '../lib/codeTheme'

// Text and code, shown and edited in the same surface. There is no "edit mode"
// here: a .py or a .txt has no rendered form to toggle away from, so the buffer
// simply is the file. Markdown is the one exception, and it arrives here only
// because the top bar's pencil sent it (with onClose, so it can leave again).
//
// Focus decides who owns the arrow keys. A file opens with the SCROLLER focused,
// not the text: no caret, and App's handler keeps paging the folder, exactly as
// it does for an image. Click into the text and the caret appears and the arrows
// become the editor's. Escape hands focus back to the scroller. Nothing is
// discarded by blurring - unsaved text survives until you save it or navigate
// away, and App's guardEdit asks before that happens.

const langComp = new Compartment()
const lintComp = new Compartment()
const chromeComp = new Compartment()

/** Line numbers, folding and wrapping, decided per file. Prose gets none. */
function chromeFor(name: string): Extension {
  if (isProse(name)) return EditorView.lineWrapping
  return [lineNumbers(), highlightActiveLineGutter(), foldGutter(), codeFolding(), highlightActiveLine()]
}

export function CodeView({
  path,
  name,
  onClose,
  onSaved,
  onBuffer,
  getPending
}: {
  path: string
  name: string
  /** Only for the markdown pencil, the one case where editing is a mode you
   *  can leave. Absent for code and text, which are always just themselves. */
  onClose?: () => void
  /** The file on disk now holds this buffer. */
  onSaved: () => void
  /** Hand the buffer up as it changes, or null once it matches disk. App owns
   *  it from there, so leaving this file no longer throws the text away. */
  onBuffer: (path: string, text: string | null) => void
  /** Unsaved text App is already holding for this file, if any: what you typed
   *  before wandering off to another one. Asked for rather than passed, so a
   *  keystroke does not have to travel back down through a re-render. */
  getPending: (path: string) => string | undefined
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The text as it was read, so "dirty" means "differs from disk" rather than
  // "was typed in". Keyed by path: a slow read must not land in another file.
  const saved = useRef<{ path: string; text: string } | null>(null)
  // The path the update listener attributes its text to. A ref, because that
  // listener is built once and outlives every file it shows; written in an
  // effect rather than during render.
  const pathRef = useRef(path)
  useEffect(() => {
    pathRef.current = path
  }, [path])
  const [dirty, setDirty] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  // Which file the editor is actually showing. Derived rather than a `ready`
  // flag, so paging never leaves a stale spinner (or a stale file) on screen.
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const ready = loadedPath === path

  /** Report the buffer up, and keep the local flag the pill reads. */
  const report = useCallback(
    (text: string | null) => {
      setDirty((was) => (was === (text !== null) ? was : text !== null))
      onBuffer(pathRef.current, text)
    },
    [onBuffer]
  )

  // Build the editor once. Everything file-specific rides in a compartment, so
  // paging to the next file reconfigures rather than remounts: no flash, and the
  // scroll position resets deliberately rather than by accident.
  useEffect(() => {
    if (!host.current) return
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        extensions: [
          prismCodeTheme,
          chromeComp.of([]),
          langComp.of([]),
          lintComp.of([]),
          history(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          search({ top: false }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap, indentWithTab]),
          EditorView.updateListener.of((u) => {
            if (u.focusChanged) setEditing(u.view.hasFocus)
            if (!u.docChanged) return
            const disk = saved.current
            const now = u.state.doc.toString()
            report(disk !== null && now !== disk.text ? now : null)
          })
        ]
      })
    })
    // Focusable and marked as a document, on the same terms as the pdf and the
    // markdown page: if the user does put focus here, the vertical keys scroll
    // it natively; if they don't, App keeps them for paging the folder.
    // CodeMirror's key handlers sit on the content, not here, so focus at this
    // level never puts a caret in the file.
    v.scrollDOM.tabIndex = -1
    v.scrollDOM.setAttribute('data-doc-scroller', '')
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [report])

  // Load the file, and reconfigure the language, the linter and the gutters to
  // match it. Runs on every path change, since the view outlives the file.
  useEffect(() => {
    let alive = true
    const lang = langFor(name)
    void Promise.all([window.prism.readText(path), lang ? lang.load() : Promise.resolve<Extension>([])]).then(
      ([text, langExt]) => {
        const v = view.current
        if (!alive || !v) return
        const disk = text ?? '(could not read file)'
        saved.current = { path, text: disk }
        // Unsaved text App kept for this file wins over what is on disk: coming
        // back to a file you edited must show your edits, not undo them.
        const body = getPending(path) ?? disk
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: body },
          selection: { anchor: 0 },
          scrollIntoView: true,
          effects: [
            chromeComp.reconfigure(chromeFor(name)),
            langComp.reconfigure(langExt),
            // Squiggles need a grammar to be wrong against. A stream lexer has
            // none, so those languages get colour and no claims about errors.
            lintComp.reconfigure(
              /\.jsonc?$|\.json5$/i.test(name) ? [syntaxLinter, jsonLinter] : lang?.parsed ? syntaxLinter : []
            )
          ]
        })
        report(body === disk ? null : body)
        setFailed(false)
        setLoadedPath(path)
        // A fresh file is a document, not a cursor, and it takes no focus at
        // all: the arrows stay the folder's until the user clicks in.
        v.contentDOM.blur()
      }
    )
    return () => {
      alive = false
    }
    // getPending is read once per file, deliberately: it seeds this editor
    // rather than tracking it. Re-running on every keystroke would fight the
    // buffer it is feeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, name, report])

  const save = useCallback(async (): Promise<boolean> => {
    const v = view.current
    if (!v || !saved.current) return false
    const text = v.state.doc.toString()
    const ok = await window.prism.writeText(path, text)
    if (!ok) {
      setFailed(true)
      return false
    }
    saved.current = { path, text }
    report(null)
    setFailed(false)
    onSaved()
    return true
  }, [path, report, onSaved])

  // Ctrl+S and Ctrl+F belong to the open file whether or not it has focus -
  // and since nothing focuses it on arrival, that has to be a window listener
  // rather than one on this subtree, which is how the pdf viewer does it too.
  // Capture, so they land before CodeMirror's own keymap sees them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const v = view.current
      if (!v) return
      const target = e.target as HTMLElement | null
      // Some other field has the keyboard (the sidebar's search box, a dialog).
      // Its keys are its own; only the editor's own inputs come back to us.
      const ours = !!target && !!host.current?.contains(target)
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !ours) return
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        e.stopPropagation()
        void save()
      } else if (e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        e.stopPropagation()
        v.focus()
        openSearchPanel(v)
      } else if (e.key === 'Escape' && v.hasFocus) {
        // Back out to the folder's keys. The buffer keeps whatever was typed;
        // App asks about it if and when the user actually leaves the file.
        e.preventDefault()
        e.stopPropagation()
        v.contentDOM.blur()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  return (
    <div
      // Only while the caret is actually in the file: App's Escape (close the
      // window) has to yield to the editor's, but only when there is one.
      data-owns-escape={editing ? '' : undefined}
      ref={host}
      className="relative h-full w-full"
    >
      {!ready && (
        <div className="delayed-loader absolute inset-0 grid place-items-center">
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
        </div>
      )}

      {/* Quiet until there is something to say: the pill appears when the buffer
          differs from disk, or when the pencil put us in a mode to leave. */}
      {(dirty || onClose) && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1 text-[var(--p-text)]">
          {failed && <span className="px-2 text-[11.5px] text-[#d97b84]">Couldn’t save.</span>}
          {onClose && (
            <button
              className="rounded-full px-3 py-1 text-[12px] font-semibold text-[var(--p-text-soft)] hover:bg-white/15 hover:text-[var(--p-text)]"
              onClick={onClose}
              title="Stop editing"
            >
              Done
            </button>
          )}
          <button
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
              dirty
                ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:brightness-110'
                : 'text-[var(--p-dim)] hover:bg-white/15'
            }`}
            onClick={() => void save()}
            title="Save (Ctrl+S)"
          >
            Save
          </button>
        </div>
      )}
    </div>
  )
}
