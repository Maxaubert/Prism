import type { JSX } from 'react'
import { Icon } from './Icon'
import { PLACE_PATHS, type PlaceIconName } from './placePaths'

/**
 * The places panel's line glyphs (#296), drawn from the themes mockup the
 * owner picked (2026-10-06: "with the icons"): one per Windows Known Folder,
 * and the drive. One stroke family, the colour of the row's dim ink.
 */
export type { PlaceIconName }

/** `size` is the phone's (2026-10-14): its places rows are thumb-sized. */
export function PlaceIcon({ name, size = 16 }: { name: PlaceIconName; size?: number }): JSX.Element {
  return <Icon d={PLACE_PATHS[name]} size={size} className="browse-place-icon" data-place-icon={name} />
}
