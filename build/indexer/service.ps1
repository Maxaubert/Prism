# Prism's optional NTFS metadata service. Never use the per-user application
# executable as a SYSTEM service, and never touch an unrelated Everything service.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Install', 'Uninstall', 'StopClient', 'Plan')][string]$Action,
  [Parameter(Mandatory = $true)][string]$InstallDirectory,
  [switch]$NoElevation
)
$ErrorActionPreference = 'Stop'
$expectedHash = 'F191F756996A14A11E5445FA7103D302EFD510CF2FBF920E6C0C8ED51D512E36'
$install = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\', '/').ToLowerInvariant()
if ($install -notmatch '^[a-z]:\\' -or $install.Contains('"')) { throw 'Prism installation must be a local absolute directory.' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $id = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($install)))).Replace('-', '').Substring(0, 16).ToLowerInvariant() } finally { $sha.Dispose() }
$instance = "Prism-$id"
$pipe = "\\.\PIPE\Prism Search $id"
$programFiles = [Environment]::GetEnvironmentVariable('ProgramW6432')
if (!$programFiles) { $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles) }
$base = Join-Path $programFiles 'Prism Search'
$directory = Join-Path $base $id
$executable = Join-Path $directory 'Everything.exe'
$source = Join-Path $install 'resources\everything\Everything.exe'
$marker = Join-Path $directory 'owner.json'
$plan = @{ instance = $instance; pipe = $pipe; directory = $directory; executable = $executable; installDirectory = $install }
if ($Action -eq 'Plan') { $plan | ConvertTo-Json -Compress; exit 0 }

if ($Action -eq 'StopClient') {
  # Only this installation's private GUI/indexing process. No name-based kill.
  Get-CimInstance Win32_Process -Filter "Name = 'Everything.exe'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.Equals($source, [StringComparison]::OrdinalIgnoreCase) -and
    $_.CommandLine -match '(?i)-instance\s+"?Prism-[a-z0-9-]+(?:"|\s|$)'
  } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  exit 0
}

function Assert-NoReparse([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing a service path through a reparse point: $current"
      }
    }
    $parent = [IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
}
function Get-OwnedService {
  $services = @(Get-CimInstance Win32_Service | Where-Object {
    $_.PathName -and $_.PathName.StartsWith(('"' + $executable + '"'), [StringComparison]::OrdinalIgnoreCase)
  })
  if ($services.Count -gt 1) { throw 'Unexpected multiple services use the Prism indexing executable.' }
  if ($services.Count -eq 1) { return $services[0] }
  return $null
}
function Assert-Owner {
  if (!(Test-Path -LiteralPath $marker)) { throw 'Prism service ownership marker is missing.' }
  $owner = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if ($owner.installDirectory -ne $install -or $owner.instance -ne $instance -or $owner.executable -ne $executable) {
    throw 'Prism service ownership does not match this installation.'
  }
  if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Prism indexing executable checksum does not match the pinned release.'
  }
}
Assert-NoReparse $directory
if ($Action -eq 'Uninstall' -and !(Test-Path -LiteralPath $directory)) { exit 0 }
if (Test-Path -LiteralPath $directory) { Assert-Owner }
$existing = Get-OwnedService
if (!$existing) {
  $collision = @(Get-CimInstance Win32_Service | Where-Object {
    ($_.Name -like "*($instance)*" -or $_.DisplayName -like "*($instance)*")
  })
  if ($collision.Count) { throw 'The private service name is already used by an unowned service.' }
}
if ($Action -eq 'Install' -and $existing -and $existing.State -eq 'Running') { exit 0 }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  if ($NoElevation) { throw 'Administrator rights are required to configure the Prism indexing service.' }
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-Action', $Action, '-InstallDirectory', ('"' + $install + '"'), '-NoElevation')
  try {
    $child = Start-Process -FilePath "$PSHOME\powershell.exe" -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    exit $child.ExitCode
  } catch {
    if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { exit 1223 }
    throw
  }
}

if ($Action -eq 'Install') {
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Bundled Everything checksum mismatch.' }
  if (!(Test-Path -LiteralPath $directory)) {
    # An explicit protected ACL, regardless of a customized Program Files ACL.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $administrators = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
    $acl.SetOwner($administrators)
    foreach ($rule in @(@('S-1-5-18', 'FullControl'), @('S-1-5-32-544', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
      $sid = New-Object Security.Principal.SecurityIdentifier($rule[0])
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid, $rule[1], 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    }
    New-Item -ItemType Directory -Path $base -Force | Out-Null
    Set-Acl -LiteralPath $base -AclObject $acl
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Set-Acl -LiteralPath $directory -AclObject $acl
    Copy-Item -LiteralPath $source -Destination $executable
    if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Protected Everything copy failed checksum verification.' }
    $plan | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
    foreach ($file in @($executable, $marker)) {
      $fileAcl = Get-Acl -LiteralPath $file
      $fileAcl.SetOwner($administrators)
      Set-Acl -LiteralPath $file -AclObject $fileAcl
    }
  }
  if ($existing) {
    Start-Service -Name $existing.Name
  } else {
    $child = Start-Process -FilePath $executable -ArgumentList @('-instance', $instance, '-install-service', '-install-service-pipe-name', ('"' + $pipe + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($child.ExitCode -ne 0) { throw "Everything service installation failed: $($child.ExitCode)" }
    $existing = Get-OwnedService
    if (!$existing) { throw 'Everything did not register the private Prism service.' }
    if ($existing.State -ne 'Running') { Start-Service -Name $existing.Name }
  }
} else {
  if ($existing) {
    Stop-Service -Name $existing.Name -ErrorAction Stop
    & "$env:SystemRoot\System32\sc.exe" delete $existing.Name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove the private Prism service.' }
  }
  # Only the validated fixed directory, never a registry-controlled arbitrary path.
  Assert-NoReparse $directory
  Assert-Owner
  Remove-Item -LiteralPath $directory -Recurse -Force
}
