// The session's ids, out of App.tsx (structure cleanup, 2026-10-12), so the
// hooks App is made of mint them from one counter each.

// Tab ids only have to be unique within a session and stable while a tab lives:
// they are React keys and the handle every tab action names, never anything
// persisted. A counter is enough and, unlike a path, survives a rename.
//
// UNIQUE ACROSS WINDOWS (tab tear-off step 1, 2026-10-29): main keys each
// tab's folder grants, its folder watch and its listing runs by this id, for
// the whole process. Two windows each minting `tab-<ms>-1` would share them,
// and closing one tab would release the other's. So the id carries the
// window's own key (`w1`, `w2`, ...), which main hands each page in its argv.
let tabSeq = 0
const windowKey = (): string => {
  try {
    return (typeof window !== 'undefined' && window.prism?.windowKey) || ''
  } catch {
    return ''
  }
}
export const nextTabId = (): string => {
  const key = windowKey()
  return `tab-${key ? `${key}-` : ''}${Date.now()}-${(tabSeq += 1)}`
}
