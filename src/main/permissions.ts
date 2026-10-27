import { session } from 'electron'

/**
 * WHAT THE PAGE MAY ASK ELECTRON FOR (moved out of ipc/terminal.ts, 2026-10-26,
 * when dictation was the one thing that wanted the microphone).
 *
 * Everything keeps Electron's default (granted), because this app leans on
 * several permissions (clipboard, fullscreen, window management) and a closed
 * list here would be a guess. The one thing refused is `media`: the microphone
 * and the camera. Prism is a viewer, nothing in it records, and a viewer that
 * can be prompted for the mic is a viewer that looks like it is listening.
 * Pure so a unit test can hold it.
 */
export function permissionAllowed(permission: string): boolean {
  return permission !== 'media'
}

/** Writes the answer down on the default session; call once, after ready. */
export function installPermissionHandler(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permissionAllowed(permission))
  })
}
