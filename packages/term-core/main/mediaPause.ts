/**
 * Pause what is PLAYING while the user dictates, and afterwards resume exactly
 * that (#13, the `dictation-pause-media` sub-option).
 *
 * NOT the play/pause media key. That key TOGGLES, so on a machine where nothing
 * was playing it would START music the moment the user began to speak, and the
 * second press at the end would stop it again: the feature inverted. Windows
 * knows what is actually playing (GlobalSystemMediaTransportControlsSession-
 * Manager, the thing behind the volume flyout's media card), so this asks it,
 * pauses only the sessions whose status is Playing, and hands back their ids as
 * the token. Resume plays those ids and nothing else, so a player the user had
 * paused by hand an hour ago stays paused.
 *
 * The API is WinRT and the core has no native module to reach it with (and may
 * not grow one: node-pty is the one native module either app carries). Windows
 * PowerShell 5.1 can reach it and is on every Windows 10 and 11, so the work is
 * done by ONE resident powershell.exe, the pattern of the app's dwmHelper: it
 * is started lazily on the first pause, loads the WinRT projection once, and
 * then reads one request per line from stdin. A process per press would pay
 * PowerShell's start every time, which is the better part of a second of music
 * playing into the microphone.
 *
 * The line protocol, numbered so that calls in flight together cannot take each
 * other's answers:
 *
 *   pause <n>          ->  <n> <comma-separated ids that WERE Playing, now paused>
 *   resume <n> <ids>   ->  <n> ok
 *   list <n>           ->  <n> <id>=<status>,...     (read-only, for diagnosis)
 *
 * EVERYTHING FAILS SOFT, by the design's own word: "if the helper cannot start,
 * dictation works and the option does nothing". No PowerShell, a helper that
 * dies, one that answers nonsense or not at all: the token is empty and resume
 * resolves. Nothing here throws and nothing rejects.
 */
import { SYS } from './sysTools'
import { spawn, type ChildProcess } from 'child_process'
import type { MediaPause, MediaPauseToken } from '../shared/dictationTypes'

/**
 * The helper, as ONE line with no double quote in it. It travels as a single
 * argv entry: Node quotes that for CreateProcess by escaping double quotes and
 * PowerShell's -Command reads the result a second time, so a script with
 * neither a double quote nor a newline is one that neither step can mangle
 * (mediaPause.test.ts holds it to that).
 *
 * The way into WinRT is the one PROVEN on this codebase's target (spiked
 * 2026-09-19 under Windows PowerShell 5.1, it listed the sessions correctly):
 * load System.Runtime.WindowsRuntime, name the type with its ContentType so the
 * projection is loaded, and find the generic AsTask(IAsyncOperation`1) overload
 * by REFLECTION, since PowerShell 5.1 has no await and cannot bind a generic
 * method on its own. Each await is bounded (2 s): a player that never answers
 * TryPauseAsync must not wedge the one loop every later request waits behind.
 *
 * The projection and the manager are loaded on the first REQUEST and retried on
 * the next if that failed, so a machine where it cannot load costs an empty
 * answer per press rather than a dead helper. A pause reports an id only when
 * TryPauseAsync said true: the token is a promise to start something again, and
 * it must not name a session that never stopped. A resume plays only sessions
 * that are still Paused, so one the user closed or started again by hand in the
 * meantime is left as they left it.
 *
 * A session is named by its SourceAppUserModelId. Two sessions of one app share
 * it, so resuming plays every PAUSED session of that app; and an id holding a
 * comma would split into pieces that match nothing (it would simply not resume).
 * Neither has been seen: the ids met so far are 'Spotify.exe', 'MSEdge', a
 * package family name with '!App', a hex string for Firefox.
 */
export const MEDIA_HELPER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  // Ids go out and come back as the bytes Node writes, which is UTF-8. No BOM:
  // one in front of the first answer would make its request number unreadable.
  'try { $utf8 = New-Object System.Text.UTF8Encoding $false; [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch {}',
  '$asTask = $null',
  '$mgr = $null',
  'function Await($op, $type) { $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op)); if ($t.Wait(2000)) { $t.Result } else { $null } }',
  'function Sessions { if ($null -eq $script:mgr) { ' +
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime; ' +
    '$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]; ' +
    "$script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1; " +
    '$script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) }; ' +
    "if ($null -eq $script:mgr) { throw 'no session manager' }; " +
    ',@($script:mgr.GetSessions()) }',
  'while ($true) { ' +
    '$line = [Console]::In.ReadLine(); if ($null -eq $line) { break }; ' +
    "$p = $line.Split(' ', 3); if ($p.Length -lt 2) { continue }; " +
    "$verb = $p[0]; $n = $p[1]; $out = $null; $found = New-Object 'System.Collections.Generic.List[string]'; " +
    'try { ' +
    "if ($verb -eq 'pause') { $out = ''; foreach ($s in (Sessions)) { try { " +
    "if ([string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { if (Await ($s.TryPauseAsync()) ([bool])) { $id = [string]$s.SourceAppUserModelId; if ($id -and -not $found.Contains($id)) { $found.Add($id) } } } " +
    '} catch {} } } ' +
    "elseif ($verb -eq 'resume') { $out = 'ok'; if ($p.Length -eq 3) { $want = $p[2].Split(','); foreach ($s in (Sessions)) { try { " +
    "if (($want -ccontains [string]$s.SourceAppUserModelId) -and ([string]$s.GetPlaybackInfo().PlaybackStatus -eq 'Paused')) { $null = Await ($s.TryPlayAsync()) ([bool]) } " +
    '} catch {} } } } ' +
    "elseif ($verb -eq 'list') { $out = ''; foreach ($s in (Sessions)) { try { $found.Add([string]$s.SourceAppUserModelId + '=' + [string]$s.GetPlaybackInfo().PlaybackStatus) } catch {} } } " +
    '} catch {}; ' +
    // An unknown verb is not answered at all: its caller times out, which is
    // the same soft failure as everything else.
    'if ($null -eq $out) { continue }; ' +
    "if ($verb -ne 'resume') { $out = $found -join ',' }; " +
    "[Console]::Out.WriteLine($n + ' ' + $out); [Console]::Out.Flush() }"
].join('; ')

/** The real helper: Windows PowerShell 5.1 (never pwsh, which is not on every
 *  machine and whose WinRT support was removed in 7), as an argv array. */
export function mediaHelperCommand(): { file: string; args: string[] } {
  return {
    file: SYS.powershell,
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', MEDIA_HELPER_SCRIPT]
  }
}

/** What the media pause reaches the outside world through. The defaults are the
 *  real thing; the tests point `command` at a Node script that speaks the same
 *  protocol, so no test ever touches the owner's media. */
export interface MediaPauseDeps {
  spawnImpl?: typeof spawn
  command?: { file: string; args: string[] }
  /** How long one request may take before its caller is answered with nothing. */
  timeoutMs?: number
}

/** Two unanswered requests in a row and the helper is taken to be wedged, not
 *  slow. ONE is not enough: the first request of a cold helper pays PowerShell's
 *  start and the WinRT load, and killing it for that would mean it never warms. */
const TIMEOUTS_BEFORE_KILL = 2

interface Waiting {
  done: (payload: string | null) => void
  timer: ReturnType<typeof setTimeout>
}

export function createMediaPause(deps: MediaPauseDeps = {}): MediaPause {
  const spawnImpl = deps.spawnImpl ?? spawn
  const command = deps.command ?? mediaHelperCommand()
  const timeoutMs = deps.timeoutMs ?? 3000

  let child: ChildProcess | null = null
  let buffered = ''
  let nextNumber = 1
  let timeoutsInARow = 0
  const waiting = new Map<number, Waiting>()
  /** Pauses whose caller has already been told "nothing was paused". */
  const abandonedPauses = new Set<number>()

  /** Answer everybody still waiting on `from` with nothing: it is gone. */
  function lost(from: ChildProcess): void {
    if (child !== from) return
    child = null
    buffered = ''
    abandonedPauses.clear()
    for (const [n, w] of [...waiting]) {
      waiting.delete(n)
      clearTimeout(w.timer)
      w.done(null)
    }
  }

  function kill(target: ChildProcess): void {
    try {
      target.stdin?.end()
      target.kill()
    } catch {
      /* gone already */
    }
  }

  function onLine(line: string): void {
    // Anything that is not "<number>" or "<number> <payload>" is PowerShell
    // talking to itself (a warning, a blank line) and is nobody's answer.
    const m = /^(\d+)(?: (.*))?$/.exec(line)
    if (!m) return
    const n = Number(m[1])
    const payload = m[2] ?? ''
    const w = waiting.get(n)
    if (w) {
      waiting.delete(n)
      clearTimeout(w.timer)
      timeoutsInARow = 0
      w.done(payload)
      return
    }
    // THE DANGEROUS HALF OF A TIMEOUT. The helper was only slow: the music DID
    // stop, and the caller was told long ago that nothing had been paused, so
    // no token exists that would ever start it again. Undo it here, at once.
    if (abandonedPauses.delete(n)) {
      timeoutsInARow = 0
      if (payload !== '') void ask('resume', payload)
    }
  }

  function helper(): ChildProcess | null {
    if (child && child.exitCode === null && !child.killed) return child
    try {
      const started = spawnImpl(command.file, command.args, {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true
      })
      child = started
      buffered = ''
      timeoutsInARow = 0
      // A missing powershell.exe arrives here, as an EVENT, a tick after spawn
      // returned something that looked like a process.
      started.on('error', () => lost(started))
      started.on('exit', () => lost(started))
      // Writing to a helper that has just died raises EPIPE on the stream, and
      // an unheard stream error is an uncaught exception in main.
      started.stdin?.on('error', () => {})
      started.stdout?.setEncoding('utf8')
      started.stdout?.on('data', (chunk: string) => {
        if (child !== started) return
        buffered += chunk
        let at = buffered.indexOf('\n')
        while (at >= 0) {
          const line = buffered.slice(0, at)
          buffered = buffered.slice(at + 1)
          onLine(line.replace(/\r$/, ''))
          at = buffered.indexOf('\n')
        }
      })
      return started
    } catch {
      child = null
      return null
    }
  }

  /** One request, one answer: the payload after the number, or null for every
   *  way of not getting one. Never rejects. */
  function ask(verb: 'pause' | 'resume', ids?: string): Promise<string | null> {
    return new Promise((resolve) => {
      const target = helper()
      if (!target || !target.stdin) return resolve(null)
      const n = nextNumber++
      const timer = setTimeout(() => {
        if (!waiting.delete(n)) return
        if (verb === 'pause') abandonedPauses.add(n)
        resolve(null)
        timeoutsInARow += 1
        if (timeoutsInARow >= TIMEOUTS_BEFORE_KILL && child === target) kill(target)
      }, timeoutMs)
      waiting.set(n, { done: resolve, timer })
      try {
        target.stdin.write(ids === undefined ? `${verb} ${n}\n` : `${verb} ${n} ${ids}\n`)
      } catch {
        waiting.delete(n)
        clearTimeout(timer)
        resolve(null)
      }
    })
  }

  return {
    async pausePlaying(): Promise<MediaPauseToken> {
      return (await ask('pause')) ?? ''
    },

    async resume(token: MediaPauseToken): Promise<void> {
      // The token crosses IPC on its way here, so it is treated as text from
      // outside: a line break in it would be a second request of its own.
      const ids = String(token ?? '').replace(/[\r\n]/g, '')
      // Nothing was paused, so there is nothing to play, and no reason to start
      // a PowerShell to find that out.
      if (ids.trim() === '') return
      await ask('resume', ids)
    },

    /** Kill the helper and answer whoever is waiting. Not final, like the
     *  engine's stop(): a later pausePlaying() starts a fresh helper. A helper
     *  that somehow outlived the app would end itself anyway, since its read
     *  loop stops when stdin closes. */
    dispose(): void {
      const target = child
      if (!target) return
      lost(target)
      kill(target)
    }
  }
}
