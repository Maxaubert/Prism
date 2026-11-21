/**
 * What a path dropped from Windows is (audit #23). `statFile` answers null for
 * a path outside the granted folders, which is every Desktop drop until the
 * Desktop was opened, so a null there must not read as "ignore it". A folder
 * answers its own read (which also grants it); a file does not.
 */
export async function droppedKind(
  path: string,
  ask: {
    stat: (p: string) => Promise<{ isFolder: boolean } | null>
    probe: (p: string) => Promise<unknown | null>
  }
): Promise<'folder' | 'file'> {
  const st = await ask.stat(path).catch(() => null)
  if (st) return st.isFolder ? 'folder' : 'file'
  return (await ask.probe(path).catch(() => null)) ? 'folder' : 'file'
}