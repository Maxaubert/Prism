param([switch]$Remove)

$exe = "$env:LOCALAPPDATA\Programs\prism\Prism.exe"
$appKey = 'HKCU:\Software\Classes\Applications\Prism.exe'

$exts = @(
  # images
  '.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.avif','.jxl','.tiff','.tif','.ico','.heic','.heif',
  # video
  '.mp4','.m4v','.webm','.ogv','.mov','.mkv','.avi',
  # audio
  '.mp3','.m4a','.aac','.ogg','.opus','.flac','.wav',
  # docs / text
  '.pdf','.txt','.md','.markdown','.json','.js','.ts','.tsx','.jsx','.css','.html','.xml','.yml','.yaml','.ini','.log','.csv'
)

if ($Remove) {
  Remove-Item -Path $appKey -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($e in $exts) {
    Remove-Item -Path "HKCU:\Software\Classes\$e\OpenWithList\Prism.exe" -Recurse -Force -ErrorAction SilentlyContinue
  }
  Write-Output "REMOVED Prism from the Open-with list."
  exit 0
}

if (-not (Test-Path $exe)) { Write-Error "Prism.exe not found at $exe"; exit 1 }

# 1) Register the application itself (this is what "Choose another app" reads).
New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'Prism'
New-Item -Path "$appKey\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "$appKey\DefaultIcon" -Name '(default)' -Value "$exe,0"
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(default)' -Value "`"$exe`" `"%1`""

# 2) Declare which types Prism can open, so it is offered for exactly those.
New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
foreach ($e in $exts) {
  Set-ItemProperty -Path "$appKey\SupportedTypes" -Name $e -Value '' -ErrorAction SilentlyContinue
}

# 3) Add Prism to each type's Open-with list (the right-click submenu).
#    This ADDS an option; it never changes the default handler.
foreach ($e in $exts) {
  New-Item -Path "HKCU:\Software\Classes\$e\OpenWithList\Prism.exe" -Force | Out-Null
}

Write-Output "REGISTERED Prism for $($exts.Count) file types"
Write-Output "  exe: $exe"
