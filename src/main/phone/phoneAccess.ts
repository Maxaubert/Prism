import { realpath } from 'fs'
import { isAbsolute } from 'path'
import { promisify } from 'util'

const finalPath = promisify(realpath.native)
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

/**
 * NOTHING ON ANOTHER COMPUTER (security review 2026-10-14; owner, 2026-10-15:
 * "we can do the phone security thing"). `localPath` reads the spelling, and a
 * mapped network drive is spelled like a local one (`Z:\`), as is a folder
 * that is a link to a share. Where the path really is decides: the OS's own
 * final path, which for a mapped drive and for a link to a share is the share
 * (`\\server\share\...`, measured with a drive mapped to `\\localhost\C$`).
 * A phone never makes the PC fetch from another computer, and never reads
 * what the PC's own network login can. A path that cannot be resolved (gone,
 * a disconnected drive) is not on this PC either.
 */
export async function phoneOnThisPc(
  p: string,
  real: (p: string) => Promise<string> = (x) => finalPath(x)
): Promise<boolean> {
  if (!localPath(p)) return false
  try {
    return localPath(await real(p))
  } catch {
    return false
  }
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
