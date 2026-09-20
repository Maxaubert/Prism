import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { MAX_BODY_CHARS } from 'prism-term-core/shared/releaseNotes'
import type { UpdateInfo } from 'prism-term-core/shared/updateTypes'

// The in-app update check. Releases publish themselves on every push to main
// (release.yml), so the app's half is small: notice a newer v<version> on
// GitHub, offer it in the title bar, and on Install download the installer and
// hand off to it. No feed, no signatures beyond what GitHub serves - the same
// trust as downloading the release by hand.
//
// The offer carries the release's NOTES since #168 (owner, 2026-09-19: the chip
// "opens like a pop window, which shows the change log or like patch notes for
// the new update, and then you can choose cancel or install"). They travel RAW
// and are never rendered: prism-term-core's `releaseNotes` turns them into
// plain entries in the page, and the dialog prints those as text. What is
// Prism's own in this file is only where to look (the repo, the installer's
// name) and the other-windows guard on the way to the installer; the chip, its
// window and the preview are the core's, the same in Prism Terminal.

const REPO = 'Maxaubert/Prism'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

// The shape is the core's, because the chip and the window that show it are.
export type { UpdateInfo }

/**
 * What this file has DONE this session: release checks sent and installs
 * attempted. Read only by the e2e (`e2e:update-calls`), whose `updateWindow`
 * scenario runs a whole preview, fake install included, and then asserts both
 * are still 0. "The preview touches nothing" is otherwise a claim about code
 * that did not run, and those are the claims that rot.
 */
const calls = { checks: 0, installs: 0 }
export const updateCalls = (): { checks: number; installs: number } => ({ ...calls })

/** True when `a` names a strictly newer x.y.z than `b`. Non-numeric parts
 *  compare as 0, so a malformed tag never claims to be an upgrade. */
export function newerVersion(a: string, b: string): boolean {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map((n) => (Number.isFinite(Number(n)) ? Number(n) : 0))
  const [pa, pb] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

type ReleaseAsset = { name?: string; browser_download_url?: string }

/** The installer electron-builder publishes: Prism-Setup-x64-<version>.exe.
 *  Anchored at both ends, so the sibling app's `PrismTerminal-Setup-x64-...`
 *  and a `.exe.blockmap` are not it. */
export function isInstallerName(name: string): boolean {
  return /^Prism-Setup-x64-.*\.exe$/i.test(name)
}

/** The newest published release, when it beats the running version. */
export async function latestUpdate(): Promise<UpdateInfo | null> {
  calls.checks += 1
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Prism-update-check' }
  })
  if (!res.ok) return null
  const rel = (await res.json()) as { tag_name?: string; body?: unknown; assets?: ReleaseAsset[] }
  const version = String(rel.tag_name ?? '').replace(/^v/i, '')
  const asset = rel.assets?.find((a) => isInstallerName(a.name ?? ''))
  if (!version || !asset?.browser_download_url) return null
  if (!newerVersion(version, app.getVersion())) return null
  // The body is somebody else's JSON: anything but a string is "no notes". Only
  // the head crosses to the page, since the head is all the parser reads.
  const notes = typeof rel.body === 'string' ? rel.body.slice(0, MAX_BODY_CHARS) : ''
  return { version, url: asset.browser_download_url, notes }
}

/** Only installers this repo's releases actually serve: parsed, not pattern
 *  matched, so the checked fields are exactly what fetch will use. */
export function isReleaseAssetUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  return (
    u.protocol === 'https:' &&
    u.hostname === 'github.com' &&
    u.pathname.startsWith(`/${REPO}/releases/download/`) &&
    u.pathname.toLowerCase().endsWith('.exe') &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash
  )
}

/**
 * Start watching: once now, then every few hours. PACKAGED BUILDS ONLY: a dev
 * or e2e build never asks the network. What an unpackaged build shows instead
 * is the core's PREVIEW (index.ts decides, prism-term-core's updatePreview is
 * the fake), which replaced the inert mock this function used to send: a chip
 * that could be seen but opened nothing was no way to look at the window
 * behind it.
 */
export function watchForUpdates(send: (info: UpdateInfo) => void): void {
  if (!app.isPackaged) return
  const tick = (): void =>
    void latestUpdate()
      .then((u) => u && send(u))
      .catch(() => {}) // offline is not an event; the next tick tries again
  tick()
  setInterval(tick, CHECK_EVERY_MS).unref()
}

/**
 * Download the installer to temp and hand off: a detached PowerShell waits
 * out the silent install, then starts the new build from the same path this
 * one runs at (per-user NSIS reinstalls in place). The app quits under it.
 */
export async function installUpdate(
  url: string,
  onPct: (pct: number) => void,
  canInstall: () => Promise<boolean> = async () => true
): Promise<boolean> {
  calls.installs += 1
  if (!isReleaseAssetUrl(url)) return false
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Prism-update-check' } })
    if (!res.ok || !res.body) return false
    const total = Number(res.headers.get('content-length')) || 0
    const file = join(await mkdtemp(join(tmpdir(), 'prism-update-')), 'Prism-Setup.exe')
    let got = 0
    const body = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
    body.on('data', (c: Buffer) => {
      got += c.length
      if (total) onPct(Math.min(99, Math.round((got / total) * 100)))
    })
    await pipeline(body, createWriteStream(file))
    if (!(await canInstall())) return false
    onPct(100)
    // Single-quoted with quotes doubled, PowerShell's own escaping; both
    // paths are ours (temp dir, execPath) but interpolation stays safe anyway.
    const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
    spawn(
      'powershell',
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Process -Wait -FilePath ${q(file)} -ArgumentList '/S'; Start-Process -FilePath ${q(process.execPath)}`
      ],
      { detached: true, stdio: 'ignore' }
    ).unref()
    // A beat for the progress frame to land, then get out of the installer's way.
    setTimeout(() => app.quit(), 400)
    return true
  } catch {
    return false
  }
}
