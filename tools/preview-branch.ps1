# Launch a packaged branch with a separate profile and no automatic Explorer verb repair.
$ErrorActionPreference = 'Stop'
$prismWorkspace = Split-Path $PSScriptRoot -Parent
$prismPreviewExe = Join-Path $prismWorkspace 'dist\explorer-focus-trial\win-unpacked\Prism.exe'
$prismPreviewProfile = Join-Path $prismWorkspace '.e2e\explorer-focus-profile'
if (-not (Test-Path -LiteralPath $prismPreviewExe -PathType Leaf)) {
  throw 'Build the branch first with npm run package -- --config.directories.output=dist/explorer-focus-trial.'
}
Start-Process -FilePath $prismPreviewExe -ArgumentList @('--preview', ('--user-data-dir="' + $prismPreviewProfile + '"')) -WindowStyle Normal
