import type { BrowseDirectory } from '@shared/browse'

export const directoryKey = (path: string): string =>
  path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** Display-only snapshots. Every revisit still revalidates through main. */
export function createVisitedDirectories(maxFolders = 24, maxRows = 50_000) {
  let owner: string | undefined
  let rows = 0
  const entries = new Map<string, BrowseDirectory>()
  const size = (entry: BrowseDirectory): number =>
    entry.listing.files.length + entry.listing.folders.length
  const forget = (path: string): void => {
    const key = directoryKey(path)
    const old = entries.get(key)
    if (old) rows -= size(old)
    entries.delete(key)
  }
  return {
    use(tabId: string | undefined): void {
      if (owner === tabId) return
      owner = tabId
      entries.clear()
      rows = 0
    },
    get(tabId: string | undefined, path: string | undefined): BrowseDirectory | null {
      return tabId === owner && path ? (entries.get(directoryKey(path)) ?? null) : null
    },
    forget(tabId: string, path: string): void {
      if (tabId === owner) forget(path)
    },
    remember(tabId: string, entry: BrowseDirectory): void {
      if (tabId !== owner) return
      forget(entry.path)
      if (entry.listing.unreadable || size(entry) > maxRows) return
      entries.set(directoryKey(entry.path), entry)
      rows += size(entry)
      while (entries.size > maxFolders || rows > maxRows) forget(entries.keys().next().value!)
    }
  }
}

/** Navigation and the resulting location effect can await the same directory read. */
export function createDirectoryRequests(
  read: (tabId: string, path: string) => Promise<BrowseDirectory | null>
) {
  const pending = new Map<string, Promise<BrowseDirectory | null>>()
  return (tabId: string, path: string, generation: string): Promise<BrowseDirectory | null> => {
    const key = `${tabId}\0${directoryKey(path)}\0${generation}`
    const existing = pending.get(key)
    if (existing) return existing
    const request = read(tabId, path)
    pending.set(key, request)
    const clear = (): void => {
      if (pending.get(key) === request) pending.delete(key)
    }
    void request.then(clear, clear)
    return request
  }
}
