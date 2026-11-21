/** A folder read, or null when Windows would not let it be read (audit #88):
 *  main answers an access-denied folder with `listing.unreadable`, not null, so
 *  a bare truthiness test took it for a folder that opened. */
export function readableDirectory<T extends { listing: { unreadable?: boolean } }>(
  directory: T | null | undefined
): T | null {
  return directory && !directory.listing.unreadable ? directory : null
}
