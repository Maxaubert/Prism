import { app, ipcMain } from 'electron'
import { readFile } from 'fs/promises'
import { networkInterfaces } from 'os'
import { isRoot } from '../dirList'
import { openRoots } from '../roots'
import { DEFAULT_PORT, PhoneServer } from './server'
import type { HlsJobs } from './jobs'
import type { Positions } from '../positions'
import { parseStore, serializeStore, type PhoneStore } from './store'
import { lanAddresses } from './lan'
import { pairLink } from './routes'
import { qrSvg } from './qr'
import { forget as forgetPhone } from './pairing'
import { writeAtomic } from '../latestWrite'
import { userPaths } from '../paths'
import type { PhoneState, FileMemoryPatch } from '@shared/types'
import { E2E, appState } from '../appState'

/**
 * Prism on your phone, main's side (stage 9c of the structure cleanup,
 * 2026-10-12, out of index.ts): the switch, the pairing store, the server's
 * life and the phone:* messages the dialog sends. What the server answers
 * with (listings, media, documents, archives) is built by index.ts, which
 * owns those bodies; this file hands it the two hooks only it knows.
 */
export interface PhoneHooks {
  /** A pairing or a phone's root changed: save, and tell the dialog. */
  onChange: () => void
  /** Is this root one a tab holds right now. */
  rootOpen: (root: string) => boolean
}

export type PhoneServerDeps = ConstructorParameters<typeof PhoneServer>[0]

export function startPhoneService(opts: {
  deps: (hooks: PhoneHooks) => PhoneServerDeps
  hlsJobs: HlsJobs | null
}): void {
  /**
   * PRISM ON YOUR PHONE (2026-09-06, #104). The server lives for as long as
   * the switch is on; the switch, the port it settled on and the paired
   * phones persist in phone.json. Every change the dialog could care about
   * is pushed as `phone:changed`, and the dialog re-reads with `phone:get`,
   * which is what keeps the two from drifting: the switch reflects what the
   * server IS, not what was clicked.
   *
   * Nothing here is synchronous: the file is read once with fs/promises
   * (the handlers wait on that read), and every write goes through one
   * chained async writer so two pairings a moment apart cannot interleave.
   */
  let phoneStore: PhoneStore = parseStore('')
  let phoneWrite: Promise<void> = Promise.resolve()
  const savePhone = (): void => {
    const text = serializeStore(phoneStore)
    phoneWrite = phoneWrite
      .then(async () => {
        await writeAtomic(userPaths.phone(), text)
      })
      .catch(() => {
        /* a failed write loses the pairing, not the session */
      })
  }
  let phone: PhoneServer | null = null
  let phoneError = ''
  const phoneChanged = (): void => appState.mainWindow?.webContents.send('phone:changed')
  const rootIsOpen = (root: string): boolean => openRoots().some((r) => isRoot(r, root))
  const startPhone = async (): Promise<void> => {
    if (phone) return
    const s = new PhoneServer(
      opts.deps({
        onChange: () => {
          savePhone()
          phoneChanged()
        },
        rootOpen: rootIsOpen
      }),
      phoneStore.pairing
    )
    try {
      phoneStore.port = await s.start(phoneStore.port ?? DEFAULT_PORT)
      phone = s
      phoneError = ''
    } catch (err) {
      phoneError = `Could not open a port: ${String((err as Error)?.message ?? err)}`
      phoneStore.on = false
    }
    savePhone()
    phoneChanged()
  }
  const stopPhone = async (): Promise<void> => {
    const s = phone
    phone = null
    if (s) await s.stop()
    phoneChanged()
  }
  // Read once; the switch that was on comes back on. The handlers wait on
  // this so a dialog opened in the first moments sees the file, not the
  // empty default.
  const phoneReady: Promise<void> = readFile(userPaths.phone(), 'utf8')
    .catch(() => '')
    .then((raw) => {
      phoneStore = parseStore(raw)
      if (phoneStore.on) void startPhone()
    })
  const phoneState = async (root: string | null): Promise<PhoneState> => {
    await phoneReady
    const state: PhoneState = {
      on: !!phone,
      port: phone?.port ?? null,
      addresses: E2E ? ['127.0.0.1'] : lanAddresses(networkInterfaces()),
      phones: phoneStore.pairing.phones.map((p) => ({ ...p })),
      watching: phone?.watching() ?? [],
      error: phoneError || undefined
    }
    // A code is for a root a tab holds: a phone paired to a closed folder
    // would only ever see the "scan again" screen.
    if (phone && root && rootIsOpen(root) && state.addresses[0]) {
      const now = Date.now()
      const live = phoneStore.pairing.codes.find((c) => c.root === root && c.expires > now)
      const { code, expires } = live ?? phone.issue(root)
      const link = pairLink(state.addresses[0], phone.port ?? DEFAULT_PORT, code)
      state.code = { code, link, svg: await qrSvg(link), expires }
    }
    return state
  }
  const rootArg = (root: unknown): string | null => (typeof root === 'string' ? root : null)
  ipcMain.handle('phone:get', (_e, root: unknown) => phoneState(rootArg(root)))
  ipcMain.handle('phone:set-on', async (_e, on: unknown, root: unknown) => {
    await phoneReady
    phoneStore.on = on === true
    savePhone()
    if (phoneStore.on) await startPhone()
    else await stopPhone()
    return phoneState(rootArg(root))
  })
  ipcMain.handle('phone:code', async (_e, root: unknown) => {
    await phoneReady
    const r = rootArg(root)
    if (phone && r && rootIsOpen(r)) phone.issue(r)
    return phoneState(r)
  })
  ipcMain.handle('phone:forget', async (_e, token: unknown, root: unknown) => {
    await phoneReady
    if (typeof token === 'string' && forgetPhone(phoneStore.pairing, token)) {
      // Its grants go with it (#106): a forgotten phone keeps nothing.
      phone?.dropGrants(token)
      savePhone()
      phoneChanged()
    }
    return phoneState(rootArg(root))
  })
  app.on('will-quit', () => {
    void phone?.stop()
    // The server's stop kills them too; this covers jobs left by a server
    // that was already off, and an ffmpeg with no app is an orphan.
    void opts.hlsJobs?.stopAll()
  })
}

/** Where you had got to in each film (#118): one store, by file path, that the
 *  window reaches over IPC and the phone over /api/pos. */
export function registerPositionsIpc(positions: Positions): void {
  ipcMain.handle('pos:get', (_e, path: string) => positions.get(String(path)))
  ipcMain.on('pos:set', (_e, path: string, patch: unknown) => {
    if (patch && typeof patch === 'object') positions.set(String(path), patch as FileMemoryPatch)
  })
}
