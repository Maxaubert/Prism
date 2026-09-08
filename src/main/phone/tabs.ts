/**
 * The tabs a phone is offered (2026-09-08, #107, owner: "i should be able to
 * switch tabs without scanning a new qr code. i should be able to see the
 * available tabs and switch"). Pure: the roots are handed in from main's own
 * open set and the current one from the phone's pairing, and nothing here
 * reads the disk or decides who may see what - the routes do that.
 */
import type { PhoneTab } from '@shared/types'

/**
 * The folder name to show for a root. A DRIVE ROOT has no basename, so it
 * keeps its whole path, which is the rule the tab strip already follows
 * (`renderer/lib/tabs.ts`). Nothing disambiguates two folders of the same
 * name here, where the strip adds the parent: the phone's list carries the
 * full path under the name, and the strip has no room for one.
 */
export function rootName(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean)
  return parts.length > 1 ? parts[parts.length - 1] : root
}

/**
 * The list, in the order the PC opened them, with the phone's own root
 * marked. `same` is main's `isRoot`, so a trailing separator and a different
 * case are the same folder here as they are to the wall.
 */
export function tabList(
  roots: readonly string[],
  current: string,
  same: (a: string, b: string) => boolean
): PhoneTab[] {
  return roots.map((root) => ({ root, name: rootName(root), current: same(root, current) }))
}
