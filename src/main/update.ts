import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// The in-app update check. Releases publish themselves on every push to main
// (release.yml), so the app's half is small: notice a newer v<version> on
// GitHub, offer it in the title bar, and on click download the installer and
// hand off to it. No feed, no signatures beyond what GitHub serves - the same
// trust as downloading the release by hand.

const REPO = 'Maxaubert/Prism'
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

export type UpdateInfo = { version: string; url: string; mock?: boolean }

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

/** The newest published release, when it beats the running version. */
export async function latestUpdate(): Promise<UpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Prism-update-check' }
  })
  if (!res.ok) return null
  const rel = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] }
  const version = String(rel.tag_name ?? '').replace(/^v/i, '')
  const asset = rel.assets?.find((a) => /^Prism-Setup-x64-.*\.exe$/i.test(a.name ?? ''))
  if (!version || !asset?.browser_download_url) return null
  return newerVersion(version, app.getVersion())
    ? { version, url: asset.browser_download_url }
    : null
}

/** Only installers this repo's releases actually serve. */
export function isReleaseAssetUrl(url: string): boolean {
  return new RegExp(`^https://github\\.com/${REPO}/releases/download/[^?#]+\\.exe$`, 'i').test(url)
}

/**
 * Start watching: once now, then every few hours. Unpackaged builds (dev,
 * e2e) never hit the network and instead report a MOCK update immediately,
 * so the title-bar chip can be seen and placed; the packaged app only ever
 * shows a real one.
 */
export function watchForUpdates(send: (info: UpdateInfo) => void): void {
  if (!app.isPackaged) {
    send({ version: app.getVersion(), url: '', mock: true })
    return
  }
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
export async function installUpdate(url: string, onPct: (pct: number) => void): Promise<boolean> {
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
    onPct(100)
    spawn(
      'powershell',
      [
        '-NoProfile',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `Start-Process -Wait -FilePath '${file}' -ArgumentList '/S'; Start-Process -FilePath '${process.execPath}'`
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
