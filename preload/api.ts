import type { DetectedAgent, ShellDef } from '../shared/types'
import { CH } from '../shared/channels'

/**
 * The preload half of the terminal's bridge, for both hosts.
 *
 * A host's preload calls this with its own `ipcRenderer` and spreads the
 * result into whatever it exposes, so the member names, the signatures and the
 * channel names exist in one place. It takes `ipcRenderer` as an argument and
 * imports nothing from `electron` itself: a sandboxed preload is bundled, and
 * the core must not decide how a host loads Electron.
 */

/** The slice of Electron's `ipcRenderer` this needs. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IpcRendererLike {
  invoke(channel: string, ...args: any[]): Promise<any>
  send(channel: string, ...args: any[]): void
  sendSync(channel: string, ...args: any[]): any
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown
  removeListener(channel: string, listener: (event: any, ...args: any[]) => void): unknown
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ClipboardRead {
  image: boolean
  text: string
  files: string[]
}

export interface TermPreloadApi {
  /** The shells main detected; the only things term:spawn will ever launch. */
  termShells(): Promise<ShellDef[]>
  /** `resume` is what the host's restore handed back for this shell, untouched.
   *  `hooks`: the page's "Exact status from Claude Code" setting (#131); main
   *  hands the shell the plugin only where its host ships one. */
  termSpawn(id: string, cwd: string, shellId?: string, resume?: string, hooks?: boolean): Promise<boolean>
  termInput(id: string, data: string): void
  termResize(id: string, cols: number, rows: number): void
  termKill(id: string): void
  /** Start a shell in `cwd` ahead of the click. Best-effort. */
  termPrewarm(cwd: string, shellId?: string, hooks?: boolean): void
  /** Move a shell to a folder it should follow (Prism's #99); main writes the line. */
  termCd(id: string, path: string): void
  onTermData(cb: (id: string, data: string) => void): () => void
  /** An AI CLI (Claude Code, codex...) appeared or left a session's shell. */
  onTermAgent(cb: (id: string, has: boolean, kind: DetectedAgent | null) => void): () => void
  /** Ask the process poll to look now, past its backoff (#73). */
  termAgentLook(): void
  /** Ask the process poll for this session's next answer, changed or not. */
  termAgentAgain(id: string): void
  /** The shell ended by itself (`exit`); a shell main was told to kill says nothing. */
  onTermExit(cb: (id: string) => void): () => void
  /**
   * What the clipboard holds RIGHT NOW, for the terminal's paste rule. An
   * image forwards the agent's image-paste key (a clipboard-aware TUI like
   * Claude Code reads the image itself); text becomes a bracketed paste; copied files paste as
   * quoted paths. The decision itself is pure and lives in lib/termPaste.
   * Synchronous, as the key handler that calls it has to be; main does the
   * reading, since a sandboxed preload has no clipboard module.
   */
  readClipboard(): ClipboardRead
  /**
   * Put TEXT on the clipboard (#12, the help panel's copy buttons). Through
   * main rather than `navigator.clipboard`: that one refuses unless the
   * document has the focus ("Document is not focused"), and a copy button
   * that works on some presses and not others is worse than none. Text only,
   * and main caps its length. Answers whether it was written.
   */
  writeClipboard(text: string): Promise<boolean>
  /**
   * A program's OSC 52 copy (#176): its own channel, capped at OSC52_MAX
   * (1 MB) rather than the help panel's 4000. Write-only: nothing in the
   * bridge lets a program read the clipboard. Answers whether it landed.
   */
  writeClipboardFromTerm(text: string): Promise<boolean>
  /** A session rang the bell (#177). What it looks like is the host's
   *  (`attention` in `registerTermIpc`); silent where it passes none. */
  termBell(id: string): void
  /** The web-links addon's click-through: external URLs go to the OS browser. */
  openExternal(url: string): void
  /** Which of these texts name a file or a folder from `cwd` (#99). Main
   *  resolves and checks; null for anything else. */
  termPathKinds(cwd: string, texts: string[]): Promise<Array<{ kind: 'file' | 'dir'; abs: string } | null>>
  /** Open, or show in Explorer, what `text` names from `cwd`. Main resolves
   *  and checks it again, and never runs a program. */
  termOpenPath(cwd: string, text: string, mode: 'open' | 'reveal'): void
}

export function createTermApi(ipc: IpcRendererLike): TermPreloadApi {
  const on = <A extends unknown[]>(channel: string, cb: (...args: A) => void): (() => void) => {
    const listener = (_e: unknown, ...args: unknown[]): void => cb(...(args as A))
    ipc.on(channel, listener)
    return () => {
      ipc.removeListener(channel, listener)
    }
  }
  return {
    termShells: () => ipc.invoke(CH.shells) as Promise<ShellDef[]>,
    termSpawn: (id, cwd, shellId, resume, hooks) =>
      ipc.invoke(CH.spawn, id, cwd, shellId, resume, hooks) as Promise<boolean>,
    termInput: (id, data) => ipc.send(CH.input, id, data),
    termResize: (id, cols, rows) => ipc.send(CH.resize, id, cols, rows),
    termKill: (id) => ipc.send(CH.kill, id),
    termPrewarm: (cwd, shellId, hooks) => ipc.send(CH.prewarm, cwd, shellId, hooks),
    termCd: (id, path) => ipc.send(CH.cd, id, path),
    onTermData: (cb) => on(CH.data, cb),
    onTermAgent: (cb) => on(CH.agent, cb),
    termAgentLook: () => ipc.send(CH.agentLook),
    termAgentAgain: (id) => ipc.send(CH.agentAgain, id),
    onTermExit: (cb) => on(CH.exit, cb),
    readClipboard: () => ipc.sendSync(CH.clipboardRead) as ClipboardRead,
    writeClipboard: (text) => ipc.invoke(CH.clipboardWrite, text) as Promise<boolean>,
    writeClipboardFromTerm: (text) => ipc.invoke(CH.clipboardTerm, text) as Promise<boolean>,
    termBell: (id) => ipc.send(CH.bell, id),
    openExternal: (url) => {
      if (/^https?:/i.test(url)) ipc.send(CH.openExternal, url)
    },
    termPathKinds: (cwd, texts) =>
      ipc.invoke(CH.pathKinds, cwd, texts) as Promise<Array<{ kind: 'file' | 'dir'; abs: string } | null>>,
    termOpenPath: (cwd, text, mode) => ipc.send(CH.openPath, cwd, text, mode)
  }
}
