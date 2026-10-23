# THE ORCHESTRATOR SENDS A MESSAGE INTO ANOTHER TAB (Prism Terminal, 2026-10-16;
# owner: "it needs to be able to send it to any session, not just whichever is
# in focus"). Drops a request into the app's orchestrator outbox beside
# $env:PRISM_SESSIONS_FILE and waits for the app's answer. The APP decides:
# only from the promoted tab, only into a tab whose Claude Code is running and
# not asking a question; it types the message into that tab's prompt and
# presses Enter, as if the owner had.
#
#   send.ps1 -To Wind -Text "fix the failing test"
#   send.ps1 -To Wind -TextFile C:\path\message.txt   (for long or quoted text)
#
# -To: the tab's label as -List shows it, a word of its label or folder, or
# its session id. Prints SENT to <label>, or NOT SENT: <why>.
param(
  [Parameter(Mandatory = $true)][string]$To,
  [string]$Text = '',
  [string]$TextFile = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $utf8 } catch { }

if (-not $env:PRISM_SESSIONS_FILE -or -not $env:PRISM_TAB_ID) {
  [Console]::Out.WriteLine('NOT SENT: this Claude is not in a Prism Terminal tab with the orchestrator on.')
  exit 2
}
if ($TextFile) { $Text = [IO.File]::ReadAllText($TextFile, $utf8) }
if (-not $Text.Trim()) {
  [Console]::Out.WriteLine('NOT SENT: the message is empty.')
  exit 2
}

$outbox = Join-Path (Split-Path -Parent $env:PRISM_SESSIONS_FILE) 'orchestrator-outbox'
if (-not (Test-Path -LiteralPath $outbox)) {
  [Console]::Out.WriteLine('NOT SENT: the app is not reading orchestrator messages (is the orchestrator switched on, and the app running?).')
  exit 2
}
$id = [guid]::NewGuid().ToString('N')
$req = @{ from = $env:PRISM_TAB_ID; to = $To; text = $Text } | ConvertTo-Json -Compress
$tmp = Join-Path $outbox "$id.tmp"
[IO.File]::WriteAllText($tmp, $req, $utf8)
[IO.File]::Move($tmp, (Join-Path $outbox "$id.json"))

$answer = Join-Path $outbox "$id.result.json"
$deadline = (Get-Date).AddSeconds(10)
while (-not (Test-Path -LiteralPath $answer)) {
  if ((Get-Date) -gt $deadline) {
    Remove-Item -LiteralPath (Join-Path $outbox "$id.json") -ErrorAction SilentlyContinue
    [Console]::Out.WriteLine('NOT SENT: the app did not answer (is it running?).')
    exit 3
  }
  Start-Sleep -Milliseconds 150
}
$r = [IO.File]::ReadAllText($answer, $utf8) | ConvertFrom-Json
Remove-Item -LiteralPath $answer -ErrorAction SilentlyContinue
if ($r.ok) { [Console]::Out.WriteLine("SENT to $($r.to)"); exit 0 }
[Console]::Out.WriteLine("NOT SENT: $($r.reason)")
exit 1
