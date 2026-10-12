import type { JSX } from 'react'
import type { BrowseDriveUsage } from '@shared/browse'
import type { DriveDetails } from '@shared/props'
import { driveName } from '../../lib/driveUsage'
import { donutBytes } from '../../lib/donut'
import { DriveDonut } from './DriveDonut'
import { DriveGlyph } from './glyphs'
import { Facts, Footer, FooterButton, Header, type Fact } from './parts'
import { useLoaded } from './useLoaded'

/** "NVMe SSD": the bus and the media together, whichever Windows gave. */
function connectionOf(details: DriveDetails): string {
  return [details.bus, details.media].filter(Boolean).join(' ')
}

/**
 * A DRIVE (owner, 2026-10-12, round 2 layout 1): the drive's own model under
 * its name, the donut of its top-level folders, the facts, and the one
 * footer with more than Close: Windows' Disk Cleanup on the left. No Open:
 * a Properties window says what a thing is, it never opens it (owner, same
 * day: "remove the open button. that should never be in properties").
 * Until main answers (and on the phone, where it never does) the places
 * panel's own numbers stand in, so the window is never empty.
 */
export function DriveBody({
  drive,
  onOpenFolder,
  onClose
}: {
  drive: BrowseDriveUsage
  onOpenFolder?: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const loaded = useLoaded(drive.path, () => window.prism.driveDetails(drive.path), null)
  const details: DriveDetails | undefined =
    loaded === undefined
      ? undefined
      : {
          ...loaded,
          total: loaded?.total ?? drive.total,
          free: loaded?.free ?? drive.free,
          folders: loaded?.folders ?? null
        }

  const connection = details ? connectionOf(details) : ''
  const sub = details ? [details.model, connection, details.fs].filter(Boolean).join(' · ') : drive.path
  const network = drive.kind === 'network'
  const rows: Fact[] = details
    ? [
        ...(details.model ? [{ label: 'Drive', value: details.model }] : []),
        ...(connection || network
          ? [
              {
                label: 'Connection',
                // "internal" says the disk is in the machine: not a USB stick,
                // not a share.
                value: network
                  ? 'Network'
                  : details.bus === 'USB' || drive.kind === 'removable'
                    ? connection
                    : `${connection}, internal`
              }
            ]
          : []),
        ...(details.fs ? [{ label: 'File system', value: details.fs }] : []),
        ...(details.total ? [{ label: 'Capacity', value: donutBytes(details.total) }] : [])
      ]
    : []

  return (
    <div data-props-body="drive">
      <Header icon={<DriveGlyph />} title={driveName(drive.path, drive)} sub={sub} />
      {details ? (
        <div className="mt-4">
          <DriveDonut details={details} onOpenFolder={onOpenFolder ?? (() => {})} />
        </div>
      ) : (
        <div className="mt-4 grid h-[150px] place-items-center italic text-[var(--p-dim2)]">Reading…</div>
      )}
      {rows.length > 0 && <Facts rows={rows} />}
      <Footer
        onClose={onClose}
        left={<FooterButton quiet label="Disk Cleanup" onClick={() => void window.prism.driveCleanup(drive.path)} />}
      />
    </div>
  )
}
