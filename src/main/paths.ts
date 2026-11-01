import { app } from 'electron'
import { join } from 'path'

/**
 * Where Prism keeps its own files under userData, named once (structure
 * cleanup, 2026-10-12). Each is a function, read when asked, so the e2e's
 * profile switch at startup is always the one in force.
 */
const under = (...parts: string[]): string => join(app.getPath('userData'), ...parts)

export const userPaths = {
  root: (): string => app.getPath('userData'),
  tabs: (): string => under('tabs.json'),
  /** The phone switch, its port and the paired phones (#104). */
  phone: (): string => under('phone.json'),
  windowState: (): string => under('window-state.json'),
  positions: (): string => under('positions.json'),
  windowCrashes: (): string => under('window-crashes.log'),
  logs: (): string => under('logs'),
  hls: (): string => under('phone', 'hls'),
  phoneLog: (): string => under('phone', 'phone.log'),
  thumbs: (): string => under('thumbs'),
  /** Converted copies and synthesised MIDI wavs. */
  converted: (): string => under('converted'),
  comics: (): string => under('comics'),
  /** Folder icons from a file (2026-10-31): Prism's own 64 px copies, by hash. */
  folderIcons: (): string => under('folder-icons'),
  /** The folder the last icon was picked from (`{ "lastDir": ... }`). */
  iconPicks: (): string => under('icon-picks.json')
}
