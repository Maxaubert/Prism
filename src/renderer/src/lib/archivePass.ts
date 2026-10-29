// The password a user has already given for an archive, keyed by its path.
// Module-level rather than component state (#70): dragging a member OUT to a
// folder is handled by the SIDEBAR, which has no idea what the archive view
// asked for, and asking twice for one archive in one session reads as a bug.
// Session-lived and never persisted: it dies with the window.

const passwords = new Map<string, string>()

const key = (archivePath: string): string => archivePath.toLowerCase()

export function archivePassword(archivePath: string): string | undefined {
  return passwords.get(key(archivePath))
}

export function rememberArchivePassword(archivePath: string, password: string): void {
  passwords.set(key(archivePath), password)
}

/**
 * The passwords given for archives a tab is in or has been in: what a torn-off
 * tab carries to its new window (tab tear-off step 3), so a zip unlocked once
 * is not asked about again there. An archive counts when one of `paths` is it
 * or lies inside it.
 */
export function archivePasswordsUnder(paths: readonly string[]): Array<{ path: string; password: string }> {
  const keys = paths.map(key)
  const out: Array<{ path: string; password: string }> = []
  for (const [archive, password] of passwords)
    if (keys.some((p) => p === archive || p.startsWith(archive + '\\') || p.startsWith(archive + '/')))
      out.push({ path: archive, password })
  return out
}
