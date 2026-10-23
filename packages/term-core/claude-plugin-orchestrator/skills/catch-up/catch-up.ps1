# THE CATCH-UP DIGEST (2026-10-16; spec: PrismTerminal
# docs/superpowers/specs/2026-10-16-catch-up-report.md). Reads the tab-to-session
# list Prism Terminal keeps ($env:PRISM_SESSIONS_FILE) and, for every Claude
# session with something the owner has not seen or been told about, the NEW part
# of its transcript, cut down to what a report needs. Prints markdown for the
# catch-up skill to summarise. Never writes a transcript, never sends anything.
#
# Windows PowerShell 5.1 on purpose: it is on every Windows 10 and 11, so the
# report needs no node or python (the app is a product for others).
#
#   catch-up.ps1            the digest; ends with COMMIT=<token>
#   catch-up.ps1 -Commit T  the report was given: the next one starts after it
#   catch-up.ps1 -All       ignore what was reported before (still skips what
#                           the owner has seen)
#   catch-up.ps1 -List      the tabs now: label, folder, state, which is the
#                           orchestrator, and each one's transcript
#   catch-up.ps1 -Only Wind only the sessions whose label or folder contains
#                           the word (with -All: everything new in them)
param(
  [string]$Commit = '',
  [switch]$All,
  [switch]$List,
  [string]$Only = '',
  [string]$SessionsFile = $env:PRISM_SESSIONS_FILE
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $utf8 } catch { }

# MEASURED (four transcripts, 30 to 210 MB): assistant lines land up to ~90 s
# after their own timestamp, so a time floor gives this much grace.
$GraceSeconds = 120
$PerSessionChars = 10000
$TotalChars = 80000
$PromptChars = 400
$AnswerHead = 800
$AnswerTail = 800

function Out-Line([string]$s) { [Console]::Out.WriteLine($s) }

function Read-JsonFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try { return ([IO.File]::ReadAllText($path, $utf8) | ConvertFrom-Json) } catch { return $null }
}

function Write-Atomic([string]$path, [string]$text) {
  $tmp = "$path.tmp"
  [IO.File]::WriteAllText($tmp, $text, $utf8)
  if (Test-Path -LiteralPath $path) { [IO.File]::Replace($tmp, $path, [NullString]::Value) } else { [IO.File]::Move($tmp, $path) }
}

function Iso([DateTime]$t) { return $t.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'") }
function Parse-Time($s) {
  if (-not $s) { return $null }
  try { return [DateTimeOffset]::Parse([string]$s, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime } catch { return $null }
}

function Clip([string]$s, [int]$n) {
  if ($null -eq $s) { return '' }
  $s = ($s -replace '\s+', ' ').Trim()
  if ($s.Length -le $n) { return $s }
  return $s.Substring(0, $n) + ' [...]'
}

function Clip-Answer([string]$s) {
  # One line: an answer's own headings and lists would read as the digest's.
  $s = ($s -replace '\s+', ' ').Trim()
  if ($s.Length -le ($AnswerHead + $AnswerTail)) { return $s }
  return $s.Substring(0, $AnswerHead) + ' [...] ' + $s.Substring($s.Length - $AnswerTail)
}

if (-not $SessionsFile) {
  Out-Line 'NOT AVAILABLE: this Claude is not running in a Prism Terminal tab that keeps a session list (PRISM_SESSIONS_FILE is not set).'
  exit 2
}
$dir = Split-Path -Parent $SessionsFile
$cursorFile = Join-Path $dir 'catch-up.json'
$pendingFile = Join-Path $dir 'catch-up.pending.json'

function Read-Reported {
  $c = Read-JsonFile $cursorFile
  $map = @{}
  if ($c -and $c.reported) {
    foreach ($p in $c.reported.PSObject.Properties) { $map[$p.Name] = $p.Value }
  }
  return $map
}

# ---------------------------------------------------------------- commit
if ($Commit) {
  $pend = Read-JsonFile $pendingFile
  if (-not $pend -or $pend.token -ne $Commit) {
    Out-Line 'NOTHING TO COMMIT: that digest is not the latest (run the digest again).'
    exit 3
  }
  $map = Read-Reported
  $n = 0
  foreach ($p in $pend.sessions.PSObject.Properties) { $map[$p.Name] = $p.Value; $n++ }
  # Forget cursors older than Claude keeps transcripts.
  $cut = (Get-Date).ToUniversalTime().AddDays(-30)
  $keep = [ordered]@{}
  foreach ($k in $map.Keys) {
    $at = Parse-Time $map[$k].at
    if ($at -and $at -gt $cut) { $keep[$k] = $map[$k] }
  }
  Write-Atomic $cursorFile ((@{ version = 1; reported = $keep } | ConvertTo-Json -Depth 5))
  Remove-Item -LiteralPath $pendingFile -ErrorAction SilentlyContinue
  Out-Line "COMMITTED $n session(s)."
  exit 0
}

# ---------------------------------------------------------------- digest
$data = Read-JsonFile $SessionsFile
if (-not $data) {
  Out-Line "NOT AVAILABLE: the session list at $SessionsFile could not be read."
  exit 2
}
$reported = Read-Reported
$self = $env:CLAUDE_CODE_SESSION_ID
$configDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$projects = Join-Path $configDir 'projects'
$projectDirs = @()
if (Test-Path -LiteralPath $projects) { $projectDirs = @(Get-ChildItem -LiteralPath $projects -Directory | ForEach-Object { $_.FullName }) }

function Find-Transcript([string]$id) {
  foreach ($d in $projectDirs) {
    $f = Join-Path $d "$id.jsonl"
    if (Test-Path -LiteralPath $f) { return $f }
  }
  return $null
}

# Which tab shows which session now, and its state.
$tabOf = @{}
$bareTabs = @()
foreach ($t in @($data.tabs)) {
  if ($t.session) { $tabOf[[string]$t.session] = $t } elseif ($t.state) { $bareTabs += $t }
}

$now = (Get-Date).ToUniversalTime()
$appNote = ''
try {
  $proc = Get-Process -Id ([int]$data.pid) -ErrorAction Stop
  if ($proc.ProcessName -notlike 'Prism*') { $appNote = 'closed' }
} catch { $appNote = 'closed' }

if ($List) {
  Out-Line "# Tabs in $($data.app) (list written $($data.updatedAt)$(if ($appNote) { ', the app is CLOSED' }))"
  foreach ($t in @($data.tabs)) {
    $f = if ($t.session) { Find-Transcript ([string]$t.session) } else { $null }
    $role = if ($t.orchestrator) { ' | ORCHESTRATOR (this is you if your PRISM_TAB_ID matches)' } else { '' }
    Out-Line ("- $($t.label) | folder: $($t.cwd) | now: " + $(if ($t.state) { $t.state } else { 'idle' }) + " | agent: " + $(if ($t.agent) { $t.agent } else { 'none' }) + " | tab: $($t.tab)" + $role)
    if ($t.session) { Out-Line "  session $($t.session)$(if ($f) { " | transcript: $f" } else { ' | transcript not found' })" }
  }
  Out-Line "Your own tab: PRISM_TAB_ID=$($env:PRISM_TAB_ID)"
  exit 0
}

$sessions = @()
foreach ($p in $data.sessions.PSObject.Properties) {
  $sessions += [pscustomobject]@{ Id = $p.Name; Rec = $p.Value; Last = (Parse-Time $p.Value.lastHookAt) }
}
$sessions = @($sessions | Sort-Object -Property @{ Expression = { if ($_.Last) { $_.Last } else { [DateTime]::MinValue } } } -Descending)

$UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$tsRx = [regex]'"timestamp":"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)"'
$cmdRx = [regex]'\b(git\s+commit|git\s+push|gh\s+pr\s+(create|merge)|gh\s+release\s+create|npm\s+publish)\b'

$out = New-Object System.Text.StringBuilder
$pending = [ordered]@{}
$quiet = @()
$notShown = @()
$total = 0

function Text-Of($content) {
  if ($content -is [string]) { return $content }
  $parts = @()
  foreach ($b in @($content)) {
    if ($b.type -eq 'text') { $parts += [string]$b.text }
    elseif ($b.type -eq 'image') { $parts += '[image]' }
  }
  return ($parts -join ' ')
}

function Prompt-Text([string]$s) {
  $m = [regex]::Match($s, '<command-name>\s*([^<]+?)\s*</command-name>')
  if ($m.Success) { return $m.Groups[1].Value }
  $s = $s -replace '<command-message>[\s\S]*?</command-message>', ''
  return $s
}

foreach ($s in $sessions) {
  $id = $s.Id
  $rec = $s.Rec
  if ($id -notmatch $UUID -or $id -eq $self) { continue }
  $cur = $reported[$id]
  $label = if ($rec.label) { [string]$rec.label } else { $id.Substring(0, 8) }
  if ($Only -and -not ($label -like "*$Only*" -or ([string]$rec.cwd) -like "*$Only*")) { continue }
  if (-not $s.Last) { continue }   # never spoke through a hook: nothing to read
  $curAt = if ($cur -and -not $All) { Parse-Time $cur.at } else { $null }
  $seen = Parse-Time $rec.seen
  if ($curAt -and $s.Last -le $curAt) { $quiet += $label; continue }
  if ($seen -and $s.Last -le $seen.AddSeconds(5)) { $quiet += $label; continue }

  $file = Find-Transcript $id
  if (-not $file) { [void]$out.AppendLine("## $label`n(transcript not found for session $id)`n"); continue }

  # Where to start: the byte the last report reached, and a time floor.
  $offset = 0L
  if ($cur -and -not $All -and $cur.offset) { $offset = [int64]$cur.offset }
  $len = (Get-Item -LiteralPath $file).Length
  if ($offset -gt $len) { $offset = 0L }
  $floorT = Parse-Time $rec.firstKnownAt
  if ($seen -and (-not $floorT -or $seen -gt $floorT)) { $floorT = $seen }
  $floor = if ($floorT) { Iso ($floorT.AddSeconds(-$GraceSeconds)) } else { '' }

  $items = New-Object System.Collections.Generic.List[string]
  $asks = @{}          # AskUserQuestion id -> its questions, until answered
  $prs = @{}
  $away = $null
  $turnAnswerId = $null
  $turnAnswer = New-Object System.Text.StringBuilder
  $turnMid = $null
  $turnOpen = $false
  $interrupted = $false
  $apiError = $false

  $closeTurn = {
    if (-not $turnOpen) { return }
    if ($turnAnswer.Length -gt 0) { $items.Add("Claude: " + (Clip-Answer $turnAnswer.ToString())) }
    elseif ($interrupted) { $items.Add('Claude: (interrupted)') }
    elseif ($apiError) { $items.Add('Claude: (API error)') }
    elseif ($turnMid) { $items.Add('Claude (mid-turn): ' + (Clip $turnMid 600)) }
  }

  $consumed = $offset
  $fs = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete')
  try {
    [void]$fs.Seek($offset, [IO.SeekOrigin]::Begin)
    $buf = New-Object byte[] 1048576
    $carry = New-Object System.IO.MemoryStream
    $pos = $offset
    while (($n = $fs.Read($buf, 0, $buf.Length)) -gt 0) {
      $start = 0
      while ($start -lt $n) {
        $nl = [Array]::IndexOf($buf, [byte]10, $start, $n - $start)
        if ($nl -lt 0) { $carry.Write($buf, $start, $n - $start); break }
        $carry.Write($buf, $start, $nl - $start)
        $bytes = $carry.ToArray()
        $carry.SetLength(0)
        $start = $nl + 1
        $pos += $bytes.Length + 1
        $consumed = $pos
        if ($bytes.Length -eq 0) { continue }
        $l = $utf8.GetString($bytes)

        $isUser = $l.Contains('"type":"user"')
        $isAsst = $l.Contains('"type":"assistant"')
        $isQueued = $l.Contains('"type":"attachment"') -and $l.Contains('queued_command')
        $isSys = $l.Contains('"type":"system"')
        $isPr = $l.Contains('"type":"pr-link"')
        if (-not ($isUser -or $isAsst -or $isQueued -or $isSys -or $isPr)) { continue }
        $m = $tsRx.Match($l)
        if (-not $m.Success) { continue }
        $ts = $m.Groups[1].Value
        if ($floor -and [string]::CompareOrdinal($ts, $floor) -le 0) { continue }
        # A tool's output is the bulk of a transcript: parsed only when it
        # answers a question still open.
        if ($isUser -and $l.Contains('"toolUseResult"')) {
          $hit = $false
          foreach ($k in @($asks.Keys)) { if ($l.Contains($k)) { $hit = $true; break } }
          if (-not $hit -and -not $l.Contains('[Request interrupted')) { continue }
        }
        try { $o = $l | ConvertFrom-Json } catch { continue }

        switch ([string]$o.type) {
          'assistant' {
            if ($o.isSidechain) { break }
            if ($o.message.model -eq '<synthetic>' -or $o.isApiErrorMessage) { $apiError = $true; break }
            $turnOpen = $true
            foreach ($b in @($o.message.content)) {
              if ($b.type -eq 'text') {
                if ($o.message.stop_reason -eq 'end_turn') {
                  if ($turnAnswerId -ne $o.message.id) { $turnAnswerId = $o.message.id; [void]$turnAnswer.Clear() }
                  [void]$turnAnswer.Append([string]$b.text)
                } else { $turnMid = [string]$b.text }
              } elseif ($b.type -eq 'tool_use') {
                $name = [string]$b.name
                if (($name -eq 'Bash' -or $name -eq 'PowerShell') -and $b.input.command -and $cmdRx.IsMatch([string]$b.input.command)) {
                  $verb = $cmdRx.Match([string]$b.input.command).Value
                  $what = if ($b.input.description) { [string]$b.input.description } else { [string]$b.input.command }
                  $items.Add("did: $verb - " + (Clip $what 140))
                } elseif ($name -eq 'AskUserQuestion') {
                  $qs = @($b.input.questions | ForEach-Object { [string]$_.question })
                  $asks[[string]$b.id] = ($qs -join ' / ')
                } elseif ($name -eq 'Workflow') {
                  $items.Add('did: ran a workflow')
                }
              }
            }
          }
          'user' {
            if ($o.isCompactSummary -or $o.isSidechain) { break }
            if ($null -ne $o.toolUseResult) {
              foreach ($b in @($o.message.content)) {
                if ($b.type -eq 'tool_result' -and $asks.ContainsKey([string]$b.tool_use_id)) {
                  $q = $asks[[string]$b.tool_use_id]
                  $asks.Remove([string]$b.tool_use_id)
                  if ($o.toolUseResult -is [string]) { $items.Add("question dismissed: " + (Clip $q 200)) }
                  else {
                    $ans = @()
                    if ($o.toolUseResult.answers) { foreach ($p in $o.toolUseResult.answers.PSObject.Properties) { $ans += [string]$p.Value } }
                    $items.Add("asked: " + (Clip $q 200) + " -> " + (Clip ($ans -join '; ') 200))
                  }
                }
              }
              if ($l.Contains('[Request interrupted')) { $interrupted = $true }
              break
            }
            $text = Text-Of $o.message.content
            if ($text.StartsWith('[Request interrupted')) { $interrupted = $true; break }
            $kind = [string]$o.origin.kind
            if ($kind -eq 'human' -and -not $o.isMeta) {
              & $closeTurn
              $turnOpen = $true; $turnAnswerId = $null; [void]$turnAnswer.Clear(); $turnMid = $null; $interrupted = $false; $apiError = $false
              $items.Add("Owner: " + (Clip (Prompt-Text $text) $PromptChars))
            } elseif ($kind -eq 'task-notification') {
              & $closeTurn
              $turnOpen = $true; $turnAnswerId = $null; [void]$turnAnswer.Clear(); $turnMid = $null; $interrupted = $false; $apiError = $false
              $summary = [regex]::Match($text, '<summary>([\s\S]*?)</summary>')
              $t = if ($summary.Success) { $summary.Groups[1].Value } else { $text -replace '<[^>]+>', ' ' }
              $items.Add("background task finished: " + (Clip $t 300))
            } elseif ($kind -eq 'peer') {
              & $closeTurn
              $turnOpen = $true; $turnAnswerId = $null; [void]$turnAnswer.Clear(); $turnMid = $null; $interrupted = $false; $apiError = $false
              $items.Add("message from session " + [string]$o.origin.name)
            }
          }
          'attachment' {
            $a = $o.attachment
            if ($a.type -eq 'queued_command' -and $a.origin.kind -eq 'human') {
              $items.Add("Owner (sent while working): " + (Clip (Prompt-Text (Text-Of $a.prompt)) $PromptChars))
            }
          }
          'system' {
            if ($o.subtype -eq 'compact_boundary') { $items.Add('(context compacted)') }
            elseif ($o.subtype -eq 'away_summary' -and $o.content) { $away = [string]$o.content }
          }
          'pr-link' {
            $u = [string]$o.prUrl
            if ($u -and -not $prs.ContainsKey($u)) { $prs[$u] = $true; $items.Add("PR: $u") }
          }
        }
      }
    }
    # A half-written last line stays unread: the cursor stops before it.
  } finally { $fs.Dispose() }
  & $closeTurn

  $pending[$id] = @{ offset = $consumed; at = (Iso $now) }

  $tab = $tabOf[$id]
  $state = if ($tab -and $tab.state) { [string]$tab.state } else { $null }
  $needs = @()
  foreach ($q in $asks.Values) { $needs += "open question: " + (Clip $q 300) }
  if ($state -eq 'question') { $needs += 'the tab is waiting on you (a question or permission prompt)' }
  if ($state -eq 'failed') { $needs += 'the last turn failed' }

  if ($items.Count -eq 0 -and $needs.Count -eq 0 -and -not $away) { $quiet += $label; continue }

  $body = New-Object System.Text.StringBuilder
  $where = if ($rec.open) { if ($tab) { "open tab, now: " + $(if ($state) { $state } else { 'idle' }) } else { 'open' } } else { 'tab closed' }
  [void]$body.AppendLine("## $label")
  [void]$body.AppendLine("folder: $($rec.cwd) | $where | since: " + $(if ($floor) { $floor } else { 'the start' }))
  if ($needs.Count) { foreach ($x in $needs) { [void]$body.AppendLine("NEEDS YOU: $x") } }
  if ($away) { [void]$body.AppendLine("Claude's own recap: " + (Clip $away 600)) }
  # Newest kept when a session is long.
  $lines = @($items)
  $size = 0
  $from = $lines.Count
  for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    $size += $lines[$i].Length + 1
    if ($size -gt $PerSessionChars) { break }
    $from = $i
  }
  if ($from -gt 0) { [void]$body.AppendLine("($from earlier items not shown)") }
  for ($i = $from; $i -lt $lines.Count; $i++) { [void]$body.AppendLine("- " + $lines[$i]) }
  [void]$body.AppendLine()

  if ($total + $body.Length -gt $TotalChars) {
    $notShown += $label
    $pending.Remove($id)
    continue
  }
  $total += $body.Length
  [void]$out.Append($body.ToString())
}

foreach ($t in $bareTabs) {
  [void]$out.AppendLine("## $($t.label)`nfolder: $($t.cwd) | now: $($t.state) | no Claude session known (Codex, or hooks off)`n")
}

$token = [guid]::NewGuid().ToString('N').Substring(0, 12)
Write-Atomic $pendingFile ((@{ token = $token; sessions = $pending } | ConvertTo-Json -Depth 5))

Out-Line "# Catch-up digest ($($data.app), list written $($data.updatedAt)$(if ($appNote) { ', the app is CLOSED: this is its last list' }))"
Out-Line ''
if ($out.Length -eq 0) { Out-Line 'Nothing new in any session since you last looked or were told.' }
else { Out-Line $out.ToString().TrimEnd() }
Out-Line ''
if ($quiet.Count) { Out-Line ("Nothing new: " + (($quiet | Select-Object -Unique) -join ', ')) }
if ($notShown.Count) { Out-Line ("Not shown (digest full, ask again for these): " + ($notShown -join ', ')) }
Out-Line "COMMIT=$token"
