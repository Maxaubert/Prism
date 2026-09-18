import { execFile } from 'child_process'

// One persistent Windows data object lets the receiving app choose files or
// pixels. Separate clipboard writes would erase the preceding representation.
const writeClipboard = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
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
  [System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 100)
} finally {
  if ($bitmap) { $bitmap.Dispose() }
  if ($picture) { $picture.Dispose() }
  $dropEffect.Dispose()
}
`

/** Paths are data over stdin, never interpolated into PowerShell source. */
export function copyWindowsFiles(paths: string[], cut: boolean): Promise<boolean> {
  return new Promise((done) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', writeClipboard],
      { windowsHide: true, timeout: 10_000 },
      (error) => done(!error)
    )
    child.stdin?.on('error', () => {}) // The process callback handles an early exit.
    child.stdin?.end(JSON.stringify({ paths, cut }), 'utf8')
  })
}

interface WindowsFileClipboard {
  paths: string[]
  cut: boolean | null
}

/** Native copy/cut metadata takes precedence over Prism's legacy cut mark. */
export function readWindowsFiles(): Promise<WindowsFileClipboard> {
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
