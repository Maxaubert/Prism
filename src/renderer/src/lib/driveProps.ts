import type { BrowseDriveUsage } from '@shared/browse'
import type { PropRow } from './fileProps'
import { formatBytes } from './format'
import { usedFraction } from './driveUsage'

const KIND: Record<NonNullable<BrowseDriveUsage['kind']>, string> = {
  local: 'Local disk',
  removable: 'Removable drive',
  network: 'Network drive',
  optical: 'CD drive'
}

/**
 * A DRIVE'S PROPERTIES (owner, 2026-10-12: "most things should have a
 * properties menu at least files and folders and drives"). The facts the
 * places panel already holds, so the window answers at once: a folder's
 * Properties would walk the whole disk for its size.
 */
export function driveProps(drive: BrowseDriveUsage): PropRow[] {
  const used = usedFraction(drive.total, drive.free)
  const sized = used !== null && drive.total !== undefined && drive.free !== undefined
  return [
    { label: 'Type', value: KIND[drive.kind ?? 'local'] + (drive.system ? ' (Windows)' : '') },
    { label: 'Location', value: drive.path },
    ...(drive.label ? [{ label: 'Label', value: drive.label }] : []),
    ...(sized
      ? [
          { label: 'Capacity', value: formatBytes(drive.total!) },
          { label: 'Used', value: `${formatBytes(drive.total! - drive.free!)} (${Math.round(used * 100)}%)` },
          { label: 'Free', value: formatBytes(drive.free!) }
        ]
      : [{ label: 'Size', value: 'Not known' }])
  ]
}
