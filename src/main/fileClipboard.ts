import { execFile } from './spawnWorker'
import { fakeCopyFiles, fakeFiles } from './e2eClipboard'
import type { ClipAttempt } from './clipWriter'
import { PRISM_COPY_FORMAT } from './ownClipboard'

/** Under --e2e the file drop list is the in-memory one (#356), never the system's. */
const E2E = process.argv.includes('--e2e')

/** How long one PowerShell write may take before it is stopped. */
export const CLIP_WRITE_TIMEOUT_MS = 10_000

// One persistent Windows data object lets the receiving app choose files or
// pixels. Separate clipboard writes would erase the preceding representation.
// THE PHASES (#484): each step says so on stdout as it ends, so a write
// stopped at its timeout tells the log where it hung (`phase`): `loaded`
// (the WinForms assemblies, ~50 ms warm), `data` (the data object built),
// `set` (SetDataObject returned; the clipboard has it). A hang after `set`
// is the exit, Windows' clipboard flush.
const writeClipboard = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
function Say($p) { [Console]::Out.WriteLine("phase:$p"); [Console]::Out.Flush() }
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Say 'loaded'
$paths = [System.Collections.Specialized.StringCollection]::new()
foreach ($path in $request.paths) {
  if (-not (Test-Path -LiteralPath $path)) { throw 'Source no longer exists' }
  [void]$paths.Add($path)
}
if ($paths.Count -eq 0) { throw 'No files to copy' }
$data = [System.Windows.Forms.DataObject]::new()
$data.SetFileDropList($paths)
$effect = if ($request.cut) { 2 } else { 1 }
$dropEffect = [System.IO.MemoryStream]::new([BitConverter]::GetBytes([uint32]$effect))
$data.SetData('Preferred DropEffect', $dropEffect)
# Prism's own token (#484): a paste in Prism that finds it knows the
# clipboard holds Prism's newest copy, and reads nothing back.
$token = $null
if ($request.token) {
  $token = [System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes([string]$request.token))
  $data.SetData([string]$request.format, $token)
}
# "Copy address" (2026-09-22): the folder AND its path, in one data object,
# as Explorer's own address bar does - a paste into Explorer takes the folder,
# a paste into a text field takes the path.
if ($request.text) { $data.SetText([string]$request.text) }
$picture = $null
$bitmap = $null
try {
  if (-not $request.cut -and $paths.Count -eq 1 -and
      [IO.Path]::GetExtension($paths[0]) -match '^\\.(png|jpe?g|gif|bmp|tiff?|ico)$') {
    try {
      $picture = [System.Drawing.Image]::FromFile($paths[0])
      $bitmap = [System.Drawing.Bitmap]::new($picture)
      $data.SetImage($bitmap)
    } catch {
      # An unreadable image still copies as its original file.
    }
  }
  Say 'data'
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
  Say 'set'
} finally {
  if ($bitmap) { $bitmap.Dispose() }
  if ($picture) { $picture.Dispose() }
  if ($token) { $token.Dispose() }
  $dropEffect.Dispose()
}
`

/** The last `phase:` a write said before it ended. */
export function lastPhase(stdout: string): string | undefined {
  const all = [...String(stdout ?? '').matchAll(/phase:(\w+)/g)]
  return all.length ? all[all.length - 1][1] : undefined
}

/** Why a write failed, in a few words: the timeout, a stop, or PowerShell's
 *  own error line ("Source no longer exists"). */
export function writeFailure(
  error: { code?: string | number; killed?: boolean; signal?: string | null; message?: string },
  stderr: string
): string {
  if (error.code === 'ABORT_ERR') return 'superseded'
  if (error.killed || error.signal) return 'timeout'
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  // PowerShell's error record: the message comes before "At line:" and the rest.
  const said = lines.find((s) => !/^(At line:|\+|CategoryInfo|FullyQualifiedErrorId)/.test(s))
  return (said ?? error.message ?? 'failed').slice(0, 200)
}

/** Under --e2e: the harness may hold or fail the fake write
 *  (`globalThis.__e2eClipWrite = { delayMs, fail }`), the e2e's way to be
 *  #484's stuck PowerShell. */
function e2eWrite(
  paths: string[],
  cut: boolean,
  text: string | undefined,
  token: string | undefined,
  signal?: AbortSignal
): Promise<ClipAttempt> {
  const hook = (globalThis as { __e2eClipWrite?: { delayMs?: number; fail?: string } }).__e2eClipWrite
  const land = (): ClipAttempt => {
    if (hook?.fail) return { ok: false, reason: hook.fail, via: 'e2e-fake' }
    fakeCopyFiles(paths, cut, text, token ? { format: PRISM_COPY_FORMAT, id: token } : undefined)
    return { ok: true, phase: 'set', via: 'e2e-fake' }
  }
  const delay = hook?.delayMs ?? 0
  if (!delay) return Promise.resolve(land())
  return new Promise((done) => {
    const t = setTimeout(() => done(land()), delay)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        done({ ok: false, reason: 'superseded', via: 'e2e-fake' })
      },
      { once: true }
    )
  })
}

/** Paths are data over stdin, never interpolated into PowerShell source.
 *  `token` is Prism's copy id (`ownClipboard`); `signal` stops the write. */
export function copyWindowsFiles(
  paths: string[],
  cut: boolean,
  text?: string,
  token?: string,
  signal?: AbortSignal
): Promise<ClipAttempt> {
  if (E2E) return e2eWrite(paths, cut, text, token, signal)
  return new Promise((done) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', writeClipboard],
      {
        windowsHide: true,
        timeout: CLIP_WRITE_TIMEOUT_MS,
        encoding: 'utf8',
        signal,
        input: JSON.stringify({ paths, cut, text: text ?? null, token: token ?? null, format: PRISM_COPY_FORMAT })
      },
      (error, stdout, stderr) => {
        const phase = lastPhase(stdout)
        done(
          error
            ? { ok: false, reason: writeFailure(error, stderr), via: 'powershell', ...(phase ? { phase } : {}) }
            : { ok: true, via: 'powershell', ...(phase ? { phase } : {}) }
        )
      }
    )
  })
}

interface WindowsFileClipboard {
  paths: string[]
  cut: boolean | null
}

/**
 * Are there files on the clipboard? Asked every time a menu OPENS, to decide
 * whether to draw Paste. It used to go through `readWindowsFiles` - a
 * PowerShell with WinForms per right-click, so the Paste row arrived hundreds
 * of ms late and shifted the menu, and fast clicks stacked processes
 * (2026-10-16). Presence needs no list: Chromium reports CF_HDROP as
 * 'text/uri-list' in `availableFormats()` (and the e2e fake does the same).
 * PowerShell stays for the paste itself, which needs every path.
 */
export function hasWindowsFiles(availableFormats: () => string[]): boolean {
  try {
    return availableFormats().includes('text/uri-list')
  } catch {
    return false
  }
}

/** Native copy/cut metadata takes precedence over Prism's legacy cut mark. */
export function readWindowsFiles(): Promise<WindowsFileClipboard> {
  if (E2E) {
    const f = fakeFiles()
    return Promise.resolve({ paths: f?.paths ?? [], cut: f ? f.cut : null })
  }
  return new Promise((done) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$data = [System.Windows.Forms.Clipboard]::GetDataObject()
$paths = @()
if ($data -and $data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) {
  $paths = @($data.GetData([System.Windows.Forms.DataFormats]::FileDrop))
}
$cut = $null
if ($data -and $data.GetDataPresent('Preferred DropEffect')) {
  $effect = $data.GetData('Preferred DropEffect')
  $bytes = if ($effect -is [IO.MemoryStream]) { $effect.ToArray() } else { [byte[]]$effect }
  if ($bytes.Length -ge 4) { $cut = [BitConverter]::ToUInt32($bytes, 0) -eq 2 }
}
@{ paths = $paths; cut = $cut } | ConvertTo-Json -Compress
`],
      { windowsHide: true, timeout: 5000, encoding: 'utf8' },
      (error, output) => {
        try {
          const value = JSON.parse(output) as WindowsFileClipboard
          if (error || !Array.isArray(value.paths) || value.paths.some((path) => typeof path !== 'string'))
            throw new Error('Invalid file clipboard')
          done({ paths: value.paths, cut: typeof value.cut === 'boolean' ? value.cut : null })
        } catch {
          done({ paths: [], cut: null })
        }
      }
    )
  })
}
