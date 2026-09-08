/**
 * The phone's side of the tab routes (2026-09-08, #107, owner: "i should be
 * able to switch tabs without scanning a new qr code"). Two calls and no
 * state: the list is read FRESH every time it is opened, because a tab
 * closes on the PC without telling the phone, and a list held from a minute
 * ago is a list that offers a folder that is gone.
 */
import type { PhoneTab } from '@shared/types'
import { getJson, postJson } from './api'

export function listTabs(): Promise<PhoneTab[]> {
  return getJson<{ tabs: PhoneTab[] }>('/api/tabs').then((r) => r.tabs)
}

/** Move this phone to `root`. Rejects with the PC's own reason when it does
 *  not hold that folder any more, which is what the list then shows. */
export function switchTab(root: string): Promise<{ root: string; name: string }> {
  return postJson<{ root: string; name: string }>('/api/tab', { root })
}
