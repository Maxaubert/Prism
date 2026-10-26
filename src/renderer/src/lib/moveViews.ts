import type { Tab } from './tabs/tabs'
import { baseName, isInside } from '@shared/path'

export type FileMove = { from: string; to: string }

const within = (path: string, parent: string): boolean => isInside(parent, path, { orEqual: true })

export function movedPath(path: string, moves: readonly FileMove[]): string {
  const move = moves.find((entry) => within(path, entry.from))
  return move ? move.to + path.slice(move.from.length) : path
}

/** References identify only the viewers this operation actually detached. */
export function captureMoveViews(tabs: readonly Tab[], paths: readonly string[]) {
  return tabs.flatMap((tab) => {
    const affected = (path: string): boolean => paths.some((parent) => within(path, parent))
    const live = tab.index >= 0 && !!tab.files[tab.index] && affected(tab.files[tab.index].path)
    return live ? [{ tab, live }] : []
  })
}

type HeldViews = ReturnType<typeof captureMoveViews>

export function releaseMoveViews(tabs: readonly Tab[], held: HeldViews): Tab[] {
  return tabs.map((tab) => {
    const entry = held.find((item) => item.tab.id === tab.id)
    if (!entry) return tab
    const sameView = tab.files[tab.index] === entry.tab.files[entry.tab.index]
    return { ...tab, index: entry.live && sameView ? -1 : tab.index }
  })
}

/** Keep unrelated operations from invalidating another move's viewer guards. */
function mapChanged<T>(items: T[], transform: (item: T) => T): T[] {
  const next = items.map(transform)
  return next.some((item, index) => item !== items[index]) ? next : items
}

/** Restore to the original tab, retaining any navigation that happened meanwhile. */
export function restoreMoveViews(
  tabs: readonly Tab[],
  held: HeldViews,
  moves: readonly FileMove[]
): Tab[] {
  return tabs.map((tab) => {
    const entry = held.find((item) => item.tab.id === tab.id)
    const heldIndex = entry ? tab.files.indexOf(entry.tab.files[entry.tab.index]) : -1
    const restoreLive = entry?.live && tab.index === -1 && heldIndex >= 0
    const remap = (path: string): string => movedPath(path, moves)
    const files = mapChanged(tab.files, (file) => {
      const path = remap(file.path)
      return path === file.path ? file : { ...file, path, name: baseName(path) }
    })
    const history = mapChanged(tab.browse.history, (location) => {
      const path = remap(location.path)
      const selected = location.selected ? remap(location.selected) : null
      return path === location.path && selected === location.selected
        ? location
        : { ...location, path, selected }
    })
    const path = remap(tab.browse.path)
    const browse =
      path === tab.browse.path && history === tab.browse.history
        ? tab.browse
        : { ...tab.browse, path, history }
    const index = restoreLive ? heldIndex : tab.index
    if (files === tab.files && browse === tab.browse && index === tab.index) return tab
    return { ...tab, files, index, browse }
  })
}
