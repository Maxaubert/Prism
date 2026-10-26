import { clipboard, app, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { registerTermIpc } from 'prism-term-core/main/ipc'
import { registerDictationIpc } from 'prism-term-core/main/dictationIpc'
import { ffmpegDirs } from '../ffmpeg'
import { exists } from '../fsUtil'
import { sendToPage } from '../appState'
import type { MainCtx } from './context'

/** The terminal and dictation, both prism-term-core's, with what is Prism's own.
 *  Answers dictation's stop, which index.ts calls at quit. */
export function registerTerminalIpc(ctx: MainCtx): () => void {
  const { insideWall, openLink } = ctx
  /* ----- the terminal ----- */

  // Sessions are keyed by renderer-assigned ids, like tabs. The one check on
  // spawn: the shell STARTS in an open root (it may leave; that is a shell).
  // THE TERMINAL'S BRIDGE IS THE CORE'S (prism-term-core/main/ipc, #154): the
  // channels, the argument checks, the resume shape check, the clipboard
  // read, the link opener (http(s) only, checked on both sides) and the
  // agent poll are registered there, once, for Prism and for Prism Terminal.
  // What is PRISM'S OWN is the wall: a shell STARTS in an open root or on
  // the desktop (it may leave; that is a shell), and only such a folder is
  // warmed ahead of the click or written into a used shell (#99).
  // The guard is the wall's `insideWall` (pathWall.ts).
  registerTermIpc({
    ipcMain,
    send: (ch, ...a) => sendToPage(ch, ...a),
    clipboard,
    openExternal: openLink,
    spawnDir: async (dir) => (insideWall(dir) ? dir : null),
    mayPrewarm: async (dir) => insideWall(dir),
    mayCd: insideWall
  })

  // DICTATION (#162) is prism-term-core's, the same feature Prism Terminal
  // has. What is Prism's own: where ITS installer put the speech engine, the
  // folder the two apps share for models, and the GPU question, answered by
  // Electron's own adapter list. Nothing starts until the user switches
  // dictation on and presses the key.
  const whisperDirs = process.env.PRISM_WHISPER_DIR
    ? [process.env.PRISM_WHISPER_DIR]
    : ffmpegDirs(app.isPackaged, process.resourcesPath, app.getAppPath()).map((d) =>
        // ffmpeg's own lookup, one folder over: resources/bin -> bin/whisper,
        // vendor/ffmpeg -> vendor/whisper.
        app.isPackaged ? join(d, 'whisper') : join(dirname(d), 'whisper')
      )
  // The core asks synchronously (`cpuEngineDir(): string | null`), so the
  // engine is found once, here, off main, and the answer kept (2026-10-12):
  // the installer puts it there and nothing moves it while Prism runs.
  let whisperDir: string | null | undefined
  void (async () => {
    for (const d of whisperDirs) if (await exists(join(d, 'whisper-server.exe'))) return d
    return null
  })().then((d) => (whisperDir = d))
  const stopDictation = registerDictationIpc({
    ipcMain,
    send: (ch, ...a) => sendToPage(ch, ...a),
    cpuEngineDir: () =>
      whisperDir !== undefined
        ? whisperDir
        : // sync-ok: only if dictation starts before the probe above has answered; the core's interface is synchronous
          (whisperDirs.find((d) => existsSync(join(d, 'whisper-server.exe'))) ?? null),
    sharedRoot:
      process.env.PRISM_DICTATION_ROOT ??
      join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'PrismDictation'),
    hasNvidia: async () => {
      if (process.env.PRISM_E2E_NVIDIA) return process.env.PRISM_E2E_NVIDIA === '1'
      const info = (await app.getGPUInfo('basic')) as { gpuDevice?: Array<{ vendorId?: number }> }
      return (info.gpuDevice ?? []).some((d) => d.vendorId === 0x10de)
    }
  })
  // Kills dictation's children (the speech server, the media helper) at quit.
  return stopDictation
}
