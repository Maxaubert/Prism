import { app, ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import { readFile } from 'fs/promises'
import { networkInterfaces } from 'os'
import { localPath } from './phoneAccess'
import { parsePins, type PhonePin } from './places'
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
import { E2E, windows } from '../appState'

/**
 * Prism on your phone, main's side (stage 9c of the structure cleanup,
 * 2026-10-12, out of index.ts): the switch, the pairing store, the server's
 * life and the phone:* messages the dialog sends. What the server answers
 * with (listings, media, documents, archives) is built by index.ts, which
 * owns those bodies; this file hands it the two hooks only it knows.
 */
export interface PhoneHooks {
  /** A pairing or a phone's folder changed: save, and tell the dialog. */
  onChange: () => void
  /** The user's own Quick access pins, as the window last reported them
   *  (`phone:pins`): the phone's drawer lists them after the Known Folders. */
  pins: () => readonly PhonePin[]
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
  // Every window's Settings shows the phone (2026-10-29).
  const phoneChanged = (): void => void windows.sendToAll(PUSH.phoneChanged)
  let pins: PhonePin[] = []
  // The window's Quick access pins (2026-10-14): fire-and-forget, kept here
  // for the drawer. Main never reads the renderer's storage itself.
  ipcMain.on(CALL.phonePins, (_e, raw: unknown) => {
    pins = parsePins(raw)
  })
  const startPhone = async (): Promise<void> => {
    if (phone) return
    const s = new PhoneServer(
      opts.deps({
        onChange: () => {
          savePhone()
          phoneChanged()
        },
        pins: () => pins
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
  const phoneState = async (start: string | null): Promise<PhoneState> => {
    await phoneReady
    const state: PhoneState = {
      on: !!phone,
      port: phone?.port ?? null,
      addresses: E2E ? ['127.0.0.1'] : lanAddresses(networkInterfaces()),
      phones: phoneStore.pairing.phones.map((p) => ({ ...p })),
      watching: phone?.watching() ?? [],
      error: phoneError || undefined
    }
    // A code from ANY tab (2026-10-14): it carries the folder that tab is
    // showing as the phone's first stop, or nothing (This PC).
    if (phone && state.addresses[0]) {
      const now = Date.now()
      const live = phoneStore.pairing.codes.find((c) => c.start === start && c.expires > now)
      const { code, expires } = live ?? phone.issue(start)
      const link = pairLink(state.addresses[0], phone.port ?? DEFAULT_PORT, code)
      state.code = { code, link, svg: await qrSvg(link), expires }
    }
    return state
  }
  /** The folder in front, when it is a local one; anything else is This PC. */
  const startArg = (start: unknown): string | null => (localPath(start) ? start : null)
  ipcMain.handle(CALL.phoneGet, (_e, start: unknown) => phoneState(startArg(start)))
  ipcMain.handle(CALL.phoneSetOn, async (_e, on: unknown, start: unknown) => {
    await phoneReady
    phoneStore.on = on === true
    savePhone()
    if (phoneStore.on) await startPhone()
    else await stopPhone()
    return phoneState(startArg(start))
  })
  ipcMain.handle(CALL.phoneCode, async (_e, start: unknown) => {
    await phoneReady
    const at = startArg(start)
    phone?.issue(at)
    return phoneState(at)
  })
  // A CODE DIES WITH THE DIALOG (security review 2026-10-14; owner,
  // 2026-10-15). It used to stay redeemable for the rest of its two minutes
  // after the QR was gone, with nothing on the PC to say a phone had paired.
  // Codes are never saved, so emptying the list is the whole of it.
  ipcMain.on(CALL.phoneCodeDrop, () => {
    phoneStore.pairing.codes.length = 0
  })
  ipcMain.handle(CALL.phoneForget, async (_e, token: unknown, start: unknown) => {
    await phoneReady
    if (typeof token === 'string' && forgetPhone(phoneStore.pairing, token)) {
      // Its grants go with it (#106): a forgotten phone keeps nothing.
      phone?.dropGrants(token)
      savePhone()
      phoneChanged()
    }
    return phoneState(startArg(start))
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
  ipcMain.handle(CALL.posGet, (_e, path: string) => positions.get(String(path)))
  ipcMain.on(CALL.posSet, (_e, path: string, patch: unknown) => {
    if (patch && typeof patch === 'object') positions.set(String(path), patch as FileMemoryPatch)
  })
}
