import { isAbsolute } from 'path'
import { grantDesktopDirectory, ownsDirectly, releaseDesktop } from '../desktopAccess'

/**
 * WHAT A PAIRED PHONE MAY READ (2026-10-14, owner: "change up how remote works
 * so its basically just on the explorer, meaning youre not tied down to a
 * specific project"; asked, "the whole PC, like Explorer"). The phone is no
 * longer walled to the folders open as tabs: it reaches what the desktop
 * Explorer reaches, by the Explorer's own rule (`desktopAccess.ts`). Listing a
 * folder grants that folder; a file is readable when it sits DIRECTLY in a
 * folder this phone listed. Each phone is its own owner (`phone:<token>`), so
 * one phone's walk never opens anything for another, and because the map is
 * the desktop's, main's media wall (`insideDesktop`) serves the same bytes
 * without a hole of its own.
 *
 * Paths are LOCAL: a drive letter and an absolute path. A UNC share and a
 * device path (`\\?\`, `\\.\`) are refused for the phone even where the
 * desktop accepts them.
 */
const owner = (token: string): string => `phone:${token}`

/** An absolute drive-letter path, never a share or a device path. */
export function localPath(p: unknown): p is string {
  return typeof p === 'string' && /^[A-Za-z]:[\\/]/.test(p) && isAbsolute(p) && !p.includes('\0')
}

/** The phone listed `dir`: it may now read the folder and its direct entries. */
export function phoneListed(token: string, dir: string): void {
  if (localPath(dir)) grantDesktopDirectory(owner(token), dir)
}

/** A folder this phone listed, or a direct entry of one. */
export function phoneMay(token: string, p: unknown): boolean {
  return localPath(p) && ownsDirectly(owner(token), p)
}

/** A forgotten phone keeps nothing. Final: that owner can never grant again,
 *  which is right for a token that no longer exists. */
export function phoneRelease(token: string): void {
  releaseDesktop(owner(token))
}
