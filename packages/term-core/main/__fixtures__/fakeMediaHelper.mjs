// A stand-in for the resident PowerShell media helper (#13), so mediaPause's
// tests never touch the owner's real media sessions and never start a real
// powershell.exe. It speaks the same line protocol on stdin and stdout:
//
//   pause <n>          ->  <n> <comma-separated ids that WERE Playing>
//   resume <n> <ids>   ->  <n> ok
//   list <n>           ->  <n> <id>=<status>,...
//
// and keeps a tiny world of sessions in memory, so a second pause finds nothing
// left to pause and a resume really does put a session back to Playing.
//
// Arguments (all optional):
//   --sessions a=Playing,b=Paused   the world it starts with
//   --log <file>                    every request line is appended here
//   --mode normal|silent|garbage|reverse|crash-once
//   --marker <file>                 crash-once: exit on the first request unless
//                                   this file exists, creating it on the way out
//   --delay <ms>                    answer each request this late
//
// Everything is imported rather than taken off a global, because eslint gives a
// bare .mjs under core/ no Node globals.
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout as later } from 'node:timers'

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback
}

const mode = arg('mode', 'normal')
const logFile = arg('log', '')
const marker = arg('marker', '')
const delay = Number(arg('delay', '0'))

/** id -> status, in the order given. */
const sessions = new Map(
  arg('sessions', '')
    .split(',')
    .filter(Boolean)
    .map((pair) => {
      const cut = pair.lastIndexOf('=')
      return [pair.slice(0, cut), pair.slice(cut + 1)]
    })
)

function answerTo(line) {
  const [verb, n, rest] = splitThree(line)
  if (verb === 'pause') {
    const ids = []
    for (const [id, status] of sessions) {
      if (status === 'Playing') {
        sessions.set(id, 'Paused')
        ids.push(id)
      }
    }
    return `${n} ${ids.join(',')}`
  }
  if (verb === 'resume') {
    for (const id of rest.split(',')) if (sessions.get(id) === 'Paused') sessions.set(id, 'Playing')
    return `${n} ok`
  }
  if (verb === 'list') return `${n} ${[...sessions].map(([id, status]) => `${id}=${status}`).join(',')}`
  return null
}

/** "verb n rest of the line", where the rest may itself hold spaces. */
function splitThree(line) {
  const first = line.indexOf(' ')
  if (first < 0) return [line, '', '']
  const second = line.indexOf(' ', first + 1)
  if (second < 0) return [line.slice(0, first), line.slice(first + 1), '']
  return [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)]
}

function say(text) {
  if (text === null) return
  if (delay > 0) later(() => process.stdout.write(`${text}\n`), delay)
  else process.stdout.write(`${text}\n`)
}

/** reverse mode holds the first answer until the second exists, then swaps them. */
let held = null

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (logFile) appendFileSync(logFile, `${line}\n`)
  if (mode === 'crash-once' && marker && !existsSync(marker)) {
    writeFileSync(marker, 'crashed once')
    process.exit(1)
  }
  if (mode === 'silent') return
  const answer = answerTo(line)
  if (mode === 'garbage') {
    // What a real PowerShell can put on stdout around an answer: a stray
    // warning, a blank line, and an answer to a request nobody made.
    say('WARNING: something nobody asked for')
    say('')
    say('999999 not-yours')
  }
  if (mode === 'reverse') {
    if (held === null) {
      held = answer
      return
    }
    say(answer)
    say(held)
    held = null
    return
  }
  say(answer)
})
// Exactly what the real helper does when the app goes away: stdin closes, the
// read loop ends, the process exits. It is why no orphan can outlive its parent.
lines.on('close', () => process.exit(0))
