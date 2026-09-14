/**
 * List or grid (#135): the phone's choice, kept on the phone. A reload
 * comes back in the view you chose, the way the place in the URL does.
 * Pure over storage, so it is tested against a fake one.
 */
export type PhoneView = 'list' | 'grid'
export const VIEW_KEY = 'prism.phone.view'

export function parseView(raw: string | null | undefined): PhoneView {
  return raw === 'grid' ? 'grid' : 'list'
}

export function readView(store: Pick<Storage, 'getItem'> | null = safeStorage()): PhoneView {
  try {
    return parseView(store?.getItem(VIEW_KEY))
  } catch {
    return 'list'
  }
}

export function writeView(v: PhoneView, store: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    store?.setItem(VIEW_KEY, v)
  } catch {
    /* private mode: the choice lasts until reload */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
