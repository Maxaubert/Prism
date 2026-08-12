import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { Dialog } from './Dialog'

// The editor behind the top bar's pencil: the file's raw source in a textarea,
// mono, nothing clever. Markdown edits its unrendered text (the formatting only
// exists at render time), Ctrl+S overwrites the file in place, Escape backs out
// and asks first when something changed.

export function TextEdit({
  path,
  onClose,
  onSaved
}: {
  path: string
  /** Leave without saving (already confirmed if anything changed). */
  onClose: () => void
  /** The file on disk now holds the editor's text. */
  onSaved: () => void
}): JSX.Element {
  // Keyed by path so a stale read never lands in the wrong editor.
  const [loaded, setLoaded] = useState<{ path: string; text: string } | null>(null)
  const [value, setValue] = useState<string | null>(null)
  const [askDiscard, setAskDiscard] = useState(false)
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

  const original = loaded?.path === path ? loaded.text : null
  const text = value ?? original
  const dirty = value !== null && value !== original

  useEffect(() => {
    let alive = true
    void window.prism.readText(path).then((t) => {
      if (alive && t !== null) setLoaded({ path, text: t })
    })
    return () => {
      alive = false
    }
  }, [path])

  useEffect(() => {
    if (original !== null) box.current?.focus()
  }, [original])

  const save = useCallback(async (): Promise<void> => {
    if (text === null) return
    const ok = await window.prism.writeText(path, text)
    if (ok) onSaved()
    else setFailed(true)
  }, [text, path, onSaved])

  const leave = useCallback((): void => {
    if (dirty) setAskDiscard(true)
    else onClose()
  }, [dirty, onClose])

  // Ctrl+S and Escape belong to the editor wherever focus sits; the root's
  // data-owns-escape keeps the app's own Escape (close the window) away.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 's' || e.key === 'S') && e.ctrlKey) {
        e.preventDefault()
        void save()
      } else if (e.key === 'Escape' && !askDiscard) {
        e.preventDefault()
        leave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, leave, askDiscard])

  return (
    <div data-owns-escape className="group relative h-full w-full">
      {text === null ? (
        <div className="delayed-loader grid h-full place-items-center">
          <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[color:var(--p-divider)] border-t-[var(--color-accent-hi)]" />
        </div>
      ) : (
        <textarea
          ref={box}
          value={text}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          className="h-full w-full resize-none bg-transparent p-6 font-mono text-[13px] leading-relaxed text-[var(--p-text-soft)] outline-none selection:bg-[rgba(91,91,214,.45)]"
        />
      )}

      {/* The viewer's pill, holding the two verbs an editor has. Always visible:
          an editor's exits should not need discovering by hover. */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[color:var(--p-divider)] bg-[var(--p-side-flat)] px-2 py-1 text-[var(--p-text)]">
        {failed && <span className="px-2 text-[11.5px] text-[#d97b84]">Couldn’t save.</span>}
        <button
          className="rounded-full px-3 py-1 text-[12px] font-semibold text-[var(--p-text-soft)] hover:bg-white/15 hover:text-[var(--p-text)]"
          onClick={leave}
          title="Stop editing (Esc)"
        >
          Cancel
        </button>
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

      {askDiscard && (
        <Dialog
          title="Discard your changes?"
          body="The file keeps what it had; what you typed here is gone."
          onCancel={() => setAskDiscard(false)}
          choices={[
            { label: 'Keep editing', onPick: () => setAskDiscard(false) },
            { label: 'Discard', danger: true, primary: true, onPick: onClose }
          ]}
        />
      )}
    </div>
  )
}
