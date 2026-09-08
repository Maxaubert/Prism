import { lazy, Suspense, useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { formatBytes } from '../lib/format'
import { unsupportedMessage } from '../lib/unsupported'

// One page of bytes at a time, behind a lazy boundary: nobody who never
// presses the button pays for it.
const HexView = lazy(() => import('./HexView').then((m) => ({ default: m.HexView })))

/**
 * The viewer for the 'other' kind: a file Prism was pointed at and can't show.
 *
 * It exists because Windows can always hand us one. Prism is correctly absent
 * from the recommended half of "Open with" for these types (assoc.nsh keeps
 * SupportedTypes in step with fileKind), but the dialog's "More apps" list is
 * every installed application, unfiltered, and no app can remove itself from
 * it. So this screen is the answer, and it has to read as Prism rather than as
 * a failure: it borrows EmptyState's tile, weights and colours exactly.
 *
 * ONE button (2026-08-31), and it is not "open it somewhere else" - that is
 * the shell's job and it is one Escape away. It is the bytes. A file Prism
 * cannot interpret is still a file Prism can READ, and a header is often the
 * whole question: what is this actually, and did it download completely.
 */
export function UnsupportedView({ file }: { file: ViewerFile }): JSX.Element {
  const size = formatBytes(file.size)
  const [hex, setHex] = useState(false)

  if (hex) {
    return (
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-[var(--p-dim)]">Reading…</div>
        }
      >
        <HexView path={file.path} size={file.size} onClose={() => setHex(false)} />
      </Suspense>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      {/* A hairline and nothing else, so the window's own material carries
          through it, matching EmptyState. No backdrop-filter. */}
      <div className="grid h-[72px] w-[72px] place-items-center rounded-[20px] border border-[color:var(--p-line)] text-[var(--p-accent-hi)]">
        <svg
          viewBox="0 0 24 24"
          width={30}
          height={30}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M10 13l4 4m0-4l-4 4" />
        </svg>
      </div>
      <div className="text-lg font-semibold">{unsupportedMessage(file.ext)}</div>
      {/* The filename can be enormous and is the one thing worth reading, so it
          wraps on word boundaries instead of being clipped to an ellipsis. */}
      <div className="max-w-[36rem] break-words text-sm text-[var(--p-dim)]">
        {file.name}
        {size && ` · ${size}`}
      </div>
      {/* Desktop only (#106). `explorer` is the flag that means "there is a
          Windows around this window": the tree hides unviewable files, so the
          only route to this screen is Windows handing one over, and the bytes
          are the desktop's answer to that. On the phone the screen names the
          file and stops. Not `write`, which is about changing files and
          would read as if the hex view edited. */}
      {window.prism.capabilities.explorer && (
        <button
          className="rounded-full border border-[color:var(--p-line)] px-4 py-1.5 text-[12.5px] font-semibold text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
          onClick={() => setHex(true)}
        >
          Show the bytes
        </button>
      )}
    </div>
  )
}
