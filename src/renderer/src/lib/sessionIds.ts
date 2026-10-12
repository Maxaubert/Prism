// The session's ids, out of App.tsx (structure cleanup, 2026-10-12), so the
// hooks App is made of mint them from one counter each.

// Tab ids only have to be unique within a session and stable while a tab lives:
// they are React keys and the handle every tab action names, never anything
// persisted. A counter is enough and, unlike a path, survives a rename.
let tabSeq = 0
export const nextTabId = (): string => `tab-${Date.now()}-${(tabSeq += 1)}`
let termSeq = 0
export const nextTermId = (): string => `term-${(termSeq += 1)}`

/** The renderer half of ending a shell. Lazy: if a session exists, the chunk
 *  that owns the store is already loaded, so this import is always a cache hit. */
export const disposeSession = (id: string): void => {
  void import('prism-term-core/renderer/components/TerminalPanel').then((m) =>
    m.disposeTermSession(id)
  )
}
