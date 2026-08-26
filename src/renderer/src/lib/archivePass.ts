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
