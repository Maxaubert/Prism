# Launch a packaged branch with a separate profile and no automatic Explorer verb repair.
$ErrorActionPreference = 'Stop'
$prismWorkspace = Split-Path $PSScriptRoot -Parent
$prismPreviewExe = Join-Path $prismWorkspace 'dist\actions-project-trial\win-unpacked\Prism.exe'
$prismPreviewProfile = Join-Path $prismWorkspace '.e2e\actions-project-profile'
if (-not (Test-Path -LiteralPath $prismPreviewExe -PathType Leaf)) {
  throw 'Build the branch first with npm run package -- --config.directories.output=dist/actions-project-trial.'
}
Start-Process -FilePath $prismPreviewExe -ArgumentList @('--preview', ('--user-data-dir="' + $prismPreviewProfile + '"')) -WindowStyle Normal
