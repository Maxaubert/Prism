# Launch a packaged branch with a separate profile and no automatic Explorer verb repair.
$ErrorActionPreference = 'Stop'
$prismWorkspace = Split-Path $PSScriptRoot -Parent
$prismPreviewExe = Join-Path $prismWorkspace 'dist\merge-ready-20260918\win-unpacked\Prism.exe'
$prismPreviewProfile = Join-Path $prismWorkspace '.e2e\win-e-profile'
if (-not (Test-Path -LiteralPath $prismPreviewExe -PathType Leaf)) {
  throw 'Build the branch first with npm run package -- --dir --config.directories.output=dist/merge-ready-20260918.'
}
Start-Process -FilePath $prismPreviewExe -ArgumentList @('--preview', ('--user-data-dir="' + $prismPreviewProfile + '"')) -WindowStyle Normal
