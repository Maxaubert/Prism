import type { BrowseSearchResult } from '@shared/browse'

/** Half-window overlap lets ordinary wheel and keyboard movement stay cached. */
export function searchWindowOffset(first: number): number {
  return Math.floor(Math.max(0, first - 128) / 256) * 256
}

export function mergeSearchWindows(
  pages: BrowseSearchResult[],
  latest: BrowseSearchResult,
  selectedPage?: BrowseSearchResult
) {
  const folders = new Map<string, BrowseSearchResult['listing']['folders'][number]>()
  const files = new Map<string, BrowseSearchResult['listing']['files'][number]>()
  for (const page of selectedPage ? [selectedPage, ...pages] : pages) {
    for (const folder of page.listing.folders) folders.set(folder.path, folder)
    for (const file of page.listing.files) files.set(file.path, file)
  }
  return {
    result: { ...latest, listing: { folders: [...folders.values()], files: [...files.values()] } },
    windows: pages.flatMap((page) => (page.window ? [page.window] : []))
  }
}
