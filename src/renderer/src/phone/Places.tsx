import { useCallback, useEffect, useState, type JSX } from 'react'
import { ROUTE, routePath, type PhoneDrive, type PlacesAnswer } from '@shared/phoneWire'
import { formatBytes } from '../lib/format'
import { PlaceIcon, type PlaceIconName } from '../components/icons/PlaceIcon'
import { FolderFill } from '../components/icons/Icon'
import { getJson } from './api'
import { ROW_CLASS } from './rows'

/**
 * THE EXPLORER'S PLACES, ON THE PHONE (2026-10-14, owner: the drawer shows
 * "Explorer's places", and the phone is "not tied down to a specific
 * project"). Quick access (the Known Folders, then the user's own pins, in the
 * PC's order) and This PC with each drive and how full it is - what the
 * Explorer's side panel lists. It is both the THIS PC PAGE (the top of every
 * path, `asPage`) and the drawer behind the hamburger. Read fresh every time
 * it is shown, since a drive comes and goes; only the page tells the PC that
 * This PC is where the phone now is.
 */
export function Places({
  asPage,
  onPick
}: {
  /** The This PC page rather than the drawer: showing it moves the phone here. */
  asPage: boolean
  onPick: (path: string) => void
}): JSX.Element {
  const [places, setPlaces] = useState<PlacesAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A promise chain, the shape the shell uses: state is set only in the
  // callbacks the network hands back to.
  const load = useCallback(
    (): Promise<void> =>
      getJson<PlacesAnswer>(routePath(ROUTE.places), asPage ? { here: '1' } : {}).then(
        (p) => {
          setPlaces(p)
          setError(null)
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e))
      ),
    [asPage]
  )
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex flex-col pb-[env(safe-area-inset-bottom)]" data-phone-places>
      {error && (
        <p className="px-4 py-3 text-red-400" role="alert">
          {error}
        </p>
      )}
      {places === null && !error && <p className="px-4 py-3 opacity-70">Loading...</p>}
      {places && (
        <>
          <Heading>Quick access</Heading>
          <ul className="flex flex-col px-2" role="list">
            {places.quick.map((q) => (
              <li key={q.path}>
                <button className={`${ROW_CLASS} rounded-xl`} onClick={() => onPick(q.path)} data-phone-place={q.path}>
                  {q.known ? (
                    <span className="grid w-[26px] shrink-0 place-items-center opacity-80">
                      <PlaceIcon name={q.known as PlaceIconName} size={22} />
                    </span>
                  ) : (
                    <FolderFill size={26} />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">{q.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <Heading>This PC</Heading>
          <ul className="flex flex-col px-2" role="list">
            {places.drives.map((d) => (
              <li key={d.path}>
                <DriveRow drive={d} onPick={() => onPick(d.path)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Heading({ children }: { children: string }): JSX.Element {
  return (
    <h3 className="px-4 pb-1 pt-4 text-[13px] font-semibold uppercase tracking-wide text-[var(--p-text-soft)]">
      {children}
    </h3>
  )
}

/** A drive as the Explorer's drive rows draw it: the label and letter, and a
 *  bar of how full it is with the free space under it when Windows said. */
function DriveRow({ drive, onPick }: { drive: PhoneDrive; onPick: () => void }): JSX.Element {
  const kind = drive.kind === 'removable' ? 'usb' : 'drive'
  const named = drive.label ? `${drive.label} (${drive.name})` : drive.name
  const sized = !!drive.total && drive.free !== undefined
  const used = sized ? Math.min(1, Math.max(0, (drive.total! - drive.free!) / drive.total!)) : 0
  return (
    <button className={`${ROW_CLASS} rounded-xl`} onClick={onPick} data-phone-drive={drive.path}>
      <span className="grid w-[26px] shrink-0 place-items-center opacity-80">
        <PlaceIcon name={kind} size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{named}</span>
        {sized && (
          <>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-[var(--p-hover)]" aria-hidden>
              <span
                className="block h-full rounded-full bg-[var(--color-accent-hi)]"
                style={{ width: `${Math.round(used * 100)}%` }}
              />
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-[var(--p-text-soft)]">
              {formatBytes(drive.free!)} free of {formatBytes(drive.total!)}
            </span>
          </>
        )}
      </span>
    </button>
  )
}
