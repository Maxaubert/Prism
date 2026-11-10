import { lazy, Suspense, useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { formatBytes } from '../lib/format'
import { unsupportedMessage } from '../lib/unsupported'
import { Icon } from './icons/Icon'
import { PATHS } from './icons/paths'

// One page of bytes at a time, behind a lazy boundary: nobody who never
// presses the button pays for it.
const HexView = lazy(() => import('./HexView').then((m) => ({ default: m.HexView })))

const BUTTON =
  'rounded-full border border-[color:var(--p-line)] px-4 py-1.5 text-[12.5px] font-semibold text-[var(--p-text-soft)] hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]'

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
 * TWO buttons (#494; owner, 2026-11-09: "it shoudl be possible to opena exe
 * instalelr", which replaces the 2026-08-31 decision that opening elsewhere
 * was the shell's job). Open hands the file to Windows, and pressing it is a
 * deliberate open: this card is what a preview of such a file shows, and a
 * preview itself never starts anything. A file Windows handed to Prism lands
 * here too and goes back only on that press, so there is no loop. A member of
 * a zip has no Open (`openable`): what is here is Prism's temp copy.
 *
 * The other is the bytes (2026-08-31). A file Prism cannot interpret is still
 * a file Prism can READ, and a header is often the whole question: what is
 * this actually, and did it download completely.
 */
export function UnsupportedView({
  file,
  openable = true
}: {
  file: ViewerFile
  openable?: boolean
}): JSX.Element {
  const size = file.size === undefined ? '' : formatBytes(file.size)
  const [hex, setHex] = useState(false)

  if (hex) {
    return (
      <Suspense
        fallback={
          <div className="grid h-full place-items-center text-sm text-[var(--p-dim)]">Reading…</div>
        }
      >
        <HexView path={file.path} size={file.size ?? 0} onClose={() => setHex(false)} />
      </Suspense>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      {/* A hairline and nothing else, so the window's own material carries
          through it, matching EmptyState. No backdrop-filter. */}
      <div className="grid h-[72px] w-[72px] place-items-center rounded-[20px] border border-[color:var(--p-line)] text-[var(--p-accent-hi)]">
        <Icon size={30}>
          <path d={PATHS.page} />
          <path d={PATHS.pageFold} />
          <path d="M10 13l4 4m0-4l-4 4" />
        </Icon>
      </div>
      <div className="text-lg font-semibold">{unsupportedMessage(file.ext)}</div>
      {/* The filename can be enormous and is the one thing worth reading, so it
          wraps on word boundaries instead of being clipped to an ellipsis. */}
      <div className="max-w-[36rem] break-words text-sm text-[var(--p-dim)]">
        {file.name}
        {size && ` · ${size}`}
      </div>
      {/* A file in the Recycle Bin says where it was (D12): its own path is
          Windows' entry and means nothing to read. */}
      {file.binned && (
        <div className="max-w-[36rem] break-words text-sm text-[var(--p-dim)]" data-bin-from>
          Deleted from {file.binned.from}
        </div>
      )}
      {/* Desktop only (#106). `explorer` is the flag that means "there is a
          Windows around this window". On the phone the screen names the file
          and stops: nothing there can start a program on the PC. Not `write`,
          which is about changing files and would read as if the hex view
          edited. */}
      {window.prism.capabilities.explorer && (
        <div className="flex items-center gap-2">
          {openable && (
            <button
              className={BUTTON}
              onClick={(e) => {
                window.prism.openInDefault(file.path)
                // Left on it, a held Enter started the file over and over and
                // the next Space started it again (#494, `openGuards` e2e).
                e.currentTarget.blur()
              }}
            >
              Open
            </button>
          )}
          <button className={BUTTON} onClick={() => setHex(true)}>
            Show the bytes
          </button>
        </div>
      )}
    </div>
  )
}
