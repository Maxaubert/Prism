# Launch a packaged branch with a separate profile and no automatic Explorer verb repair.
$ErrorActionPreference = 'Stop'
$prismWorkspace = Split-Path $PSScriptRoot -Parent
$prismPreviewExe = Join-Path $prismWorkspace 'dist\explorer-trial\win-unpacked\Prism.exe'
$prismPreviewProfile = Join-Path $prismWorkspace '.e2e\explorer-projects-profile'
if (-not (Test-Path -LiteralPath $prismPreviewExe -PathType Leaf)) {
  throw 'Build the branch first with npm run package -- --config.directories.output=dist/explorer-trial.'
}
Start-Process -FilePath $prismPreviewExe -ArgumentList @('--preview', ('--user-data-dir="' + $prismPreviewProfile + '"')) -WindowStyle Normal
