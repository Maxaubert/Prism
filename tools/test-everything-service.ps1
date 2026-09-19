# This test creates a real service only on a disposable GitHub-hosted runner.
# It deliberately cannot run on the developer's desktop.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Service lifecycle tests require a disposable GitHub-hosted runner.'
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Runner must be elevated.' }
$testRoot = Join-Path $env:RUNNER_TEMP ('prism-indexer-' + [Guid]::NewGuid().ToString('N'))
$bundle = Join-Path $testRoot 'resources\everything'
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
Copy-Item -Path 'vendor\everything\*' -Destination $bundle
$helper = Join-Path $bundle 'service.ps1'
$plan = & powershell.exe -NoProfile -NonInteractive -File $helper -Action Plan -InstallDirectory $testRoot | ConvertFrom-Json
$before = @(Get-CimInstance Win32_Service | Where-Object Name -Like '*Everything*' | Select-Object Name, PathName)
$testUser = $null
try {
  & powershell.exe -NoProfile -NonInteractive -File $helper -Action Install -InstallDirectory $testRoot -NoElevation
  if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
  $service = @(Get-CimInstance Win32_Service | Where-Object { $_.PathName -like ('"' + $plan.executable + '"*') })
  if ($service.Count -ne 1 -or $service[0].State -ne 'Running') { throw 'Private service is not running.' }
  # Idempotent setup must not create a second service or change its owner.
  & powershell.exe -NoProfile -NonInteractive -File $helper -Action Install -InstallDirectory $testRoot -NoElevation
  if ($LASTEXITCODE -ne 0) { throw 'Repeated service setup failed.' }
  $acl = Get-Acl -LiteralPath $plan.directory
  $unsafe = @($acl.Access | Where-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq 'S-1-5-32-545' -and
    $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write)
  })
  if (!$acl.AreAccessRulesProtected -or $unsafe.Count) { throw 'Service directory is user-writable.' }
  foreach ($path in @((Split-Path $plan.directory), $plan.directory, $plan.executable, (Join-Path $plan.directory 'owner.json'))) {
    $owner = (Get-Acl -LiteralPath $path).GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne 'S-1-5-32-544') { throw 'Service ownership permits unelevated ACL modification.' }
  }
  # An elevated runner could read the NTFS journal directly and conceal a broken
  # service pipe. Run the real query from a disposable, non-administrator account.
  $username = 'PrismCi' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
  $password = ConvertTo-SecureString ('P!a9-' + [Guid]::NewGuid().ToString('N')) -AsPlainText -Force
  $testUser = New-LocalUser -Name $username -Password $password -PasswordNeverExpires -AccountNeverExpires
  if (!(Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object { $_.SID -eq $testUser.SID })) {
    Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $testUser
  }
  $credential = New-Object Management.Automation.PSCredential("$env:COMPUTERNAME\$username", $password)
  function Grant-TestAccess([string]$Path, [string]$Rights) {
    $acl = Get-Acl -LiteralPath $Path
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($testUser.SID, $Rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $Path -AclObject $acl
  }
  $workspace = (Get-Location).Path
  Grant-TestAccess $workspace 'ReadAndExecute'
  Grant-TestAccess $testRoot 'Modify'
  $temporary = Join-Path $testRoot 'temporary'
  New-Item -ItemType Directory -Path $temporary -Force | Out-Null
  $config = @{
    workspace = $workspace
    node = (Get-Command node.exe).Source
    temporary = $temporary
    instance = $plan.instance
    installDirectory = $testRoot
  }
  $config | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'smoke.json') -Encoding UTF8
  $wrapper = Join-Path $testRoot 'non-admin-smoke.ps1'
  @'
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Smoke must run without administrator rights.' }
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'smoke.json') -Raw | ConvertFrom-Json
$env:TEMP = $config.temporary
$env:TMP = $config.temporary
$env:PRISM_INDEXER_TEST_SERVICE_INSTANCE = $config.instance
$env:PRISM_INDEXER_TEST_INSTALL_DIRECTORY = $config.installDirectory
$env:PRISM_INDEXER_TEST_REQUIRE_NONADMIN = '1'
$env:PRISM_INDEXER_INTEGRATION = '0'
Set-Location -LiteralPath $config.workspace
& $config.node 'node_modules/vitest/vitest.mjs' run 'src/main/indexerRuntime.integration.test.ts' --configLoader runner --no-cache
exit $LASTEXITCODE
'@ | Set-Content -LiteralPath $wrapper -Encoding UTF8
  $stdout = Join-Path $testRoot 'smoke.stdout.log'
  $stderr = Join-Path $testRoot 'smoke.stderr.log'
  Start-Service -Name seclogon
  $child = Start-Process -FilePath (Get-Command powershell.exe).Source -Credential $credential -LoadUserProfile -WindowStyle Hidden -WorkingDirectory $testRoot -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $wrapper + '"')) -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Wait -PassThru
  Get-Content -LiteralPath $stdout
  Get-Content -LiteralPath $stderr
  if ($child.ExitCode -ne 0) { throw 'Standard-user service-backed native indexing smoke failed.' }
} finally {
  & powershell.exe -NoProfile -NonInteractive -File $helper -Action StopClient -InstallDirectory $testRoot
  if ($testUser) { Remove-LocalUser -SID $testUser.SID -ErrorAction Continue }
  & powershell.exe -NoProfile -NonInteractive -File $helper -Action Uninstall -InstallDirectory $testRoot -NoElevation
  if ($LASTEXITCODE -ne 0) { throw 'Service cleanup failed.' }
}
if (Test-Path -LiteralPath $plan.directory) { throw 'Protected service files remain after uninstall.' }
$after = @(Get-CimInstance Win32_Service | Where-Object Name -Like '*Everything*' | Select-Object Name, PathName)
if (($before | ConvertTo-Json -Compress) -ne ($after | ConvertTo-Json -Compress)) { throw 'Unrelated Everything services changed.' }
Write-Host 'Private Everything service install, idempotence, ACL and uninstall passed.'
