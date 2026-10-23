import { DGCH } from '../shared/channels'
import type { IpcRendererLike } from './api'

/**
 * The preload half of the DIAGNOSTICS bridge (#140), for both hosts. A host
 * spreads it into its bridge beside the terminal's; `startDiagnostics` in
 * main is the other half. Every member is fire and forget except the two the
 * Settings page reads back.
 */

/** One line the page hands main: its kind, when (epoch ms), and fields. */
export interface DiagPageLine {
  k: string
  at: number
  [field: string]: unknown
}

export interface DiagInfo {
  verbose: boolean
  /** The log folder, shown on the Settings page; '' where nothing is logged. */
  dir: string
}

export interface DiagApi {
  diagBatch(lines: DiagPageLine[]): void
  diagBeat(): void
  diagInfo(): Promise<DiagInfo>
  diagSetVerbose(on: boolean): Promise<boolean>
  diagOpenFolder(): void
  diagMark(note?: string): void
}

export function createDiagApi(ipc: IpcRendererLike): DiagApi {
  return {
    diagBatch: (lines) => ipc.send(DGCH.batch, lines),
    diagBeat: () => ipc.send(DGCH.beat),
    diagInfo: () => ipc.invoke(DGCH.info) as Promise<DiagInfo>,
    diagSetVerbose: (on) => ipc.invoke(DGCH.setVerbose, on) as Promise<boolean>,
    diagOpenFolder: () => ipc.send(DGCH.openFolder),
    diagMark: (note) => ipc.send(DGCH.mark, note)
  }
}
