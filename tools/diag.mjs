#!/usr/bin/env node
// READ THE DIAGNOSTICS LOG (#140): the newest problems (stalls, errors, slow
// calls, marks), each with the crumbs that came just before it, so "it
// stalled just now" is answered from the log rather than from memory.
// Prism writes %APPDATA%\Prism\logs\diag.jsonl (the core's diagLog); schema in\n// packages/term-core/README.md and docs/terminal-rules.md.
//
//   npm run diag                        newest problems in Prism's log
//   npm run diag -- --since 10m         only the last ten minutes (s, m, h, d)
//   npm run diag -- --all               every line, not just the problems
//   npm run diag -- --kinds page-stall,main-lag
//   npm run diag -- --dir <logs folder> any folder holding a diag.jsonl
//   npm run diag -- --n 50              how many problems (default 20)
//   npm run diag -- --agent             the agent indicator's timeline: hooks,
//                                       titles, marks and why, restores, tabs
//   npm run diag -- --agent --tab t3    one tab's

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const APPS = { prism: 'Prism' }
/** A problem is any of these, or an app's own `-slow` kind. */
const PROBLEMS = new Set([
  'main-lag',
  'fs-slow',
  'mem-high',
  'ipc-slow',
  'ipc-error',
  'page-stall',
  'page-stack',
  'page-error',
  'page-rejection',
  'main-error',
  'main-rejection',
  'gone',
  'unresponsive',
  'logger-error',
  'logger-dropped',
  'mark'
])
/** The agent indicator's record (#152): not problems, the context for one. */
const AGENT = new Set(['agent-hook', 'agent-title', 'agent-mark', 'agent-restore'])
/** The crumbs and lines an agent timeline (`--agent`) shows beside them. */
const AGENT_CRUMBS = new Set(['tab-open', 'tab-close', 'tab-switch', 'shell-spawn', 'shell-exit'])
const inAgentTimeline = (l) => AGENT.has(l.k) || l.k === 'session' || l.k === 'quit' || l.k === 'mark' || (l.k === 'crumb' && AGENT_CRUMBS.has(l.a))
/** Context shown before a problem: the crumbs, and the marks' moves. */
const isContext = (l) => l.k === 'crumb' || l.k === 'agent-mark' || l.k === 'agent-restore'
const CRUMBS_BEFORE = 5
/** A crumb older than this before a problem says nothing about it. */
const CRUMB_WINDOW_MS = 120_000

function args(argv) {
  const out = { app: 'prism', since: null, all: false, kinds: null, dir: null, n: 20, agent: false, tab: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--app') out.app = next()
    else if (a === '--since') out.since = next()
    else if (a === '--all') out.all = true
    else if (a === '--kinds') out.kinds = new Set(next().split(','))
    else if (a === '--dir') out.dir = next()
    else if (a === '--n') out.n = Number(next()) || 20
    else if (a === '--agent') out.agent = true
    else if (a === '--tab') out.tab = next()
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

/** "10m" as ms; null for nothing or nonsense. */
function duration(s) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(s ?? '')
  if (!m) return null
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] ?? 'm']
  return Number(m[1]) * unit
}

function logDir(o) {
  if (o.dir) return o.dir
  const name = APPS[o.app]
  if (!name) throw new Error(`--app is one of ${Object.keys(APPS).join(', ')}`)
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, name, 'logs')
}

/** Every line of the live file and its rotations, oldest file first. */
function readLines(dir) {
  const files = ['diag.jsonl.4', 'diag.jsonl.3', 'diag.jsonl.2', 'diag.jsonl.1', 'diag.jsonl'].map((f) => join(dir, f))
  const lines = []
  for (const f of files) {
    if (!existsSync(f)) continue
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      if (!raw.trim()) continue
      try {
        const l = JSON.parse(raw)
        l._ms = Date.parse(l.t)
        if (Number.isFinite(l._ms)) lines.push(l)
      } catch {
        /* a line cut by a crash */
      }
    }
  }
  // A page's lines are written when their batch arrives, up to a few seconds
  // after they happened: order by when they happened.
  return lines.sort((a, b) => a._ms - b._ms)
}

const isProblem = (l) => PROBLEMS.has(l.k) || /-slow$/.test(l.k)

function clock(ms) {
  const d = new Date(ms)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** One line, said briefly: the fields that matter for its kind first. */
function summary(l) {
  const f = { ...l }
  for (const k of ['t', 'up', 'src', 'k', '_ms']) delete f[k]
  switch (l.k) {
    case 'page-stall': {
      const s = (l.scripts ?? []).map((x) => `${x.fn ?? '?'} in ${x.src ?? '?'} (${x.invoker ?? '?'}) ${x.ms}ms`).join('; ')
      return `${l.ms}ms, blocking ${l.blocking}ms${s ? `: ${s}` : ''}`
    }
    case 'main-lag': {
      const c = (l.inflight ?? []).map((x) => `${x.ch} ${x.ms}ms${x.done ? ' (ended)' : ''}`).join(', ')
      return `${l.ms}ms${c ? `, calls: ${c}` : ', no IPC call around it'}`
    }
    case 'ipc-slow':
      return `${l.ch} ${l.ms}ms${l.sync ? ' (sync)' : ''} args ${JSON.stringify(l.args)}`
    case 'ipc-error':
      return `${l.ch}: ${l.err}`
    case 'page-stack':
      return `${l.ms}ms without a heartbeat${l.unresponsive ? ', unresponsive' : ''}\n${indent(l.stack, 6)}`
    case 'page-error':
    case 'page-rejection':
    case 'main-error':
    case 'main-rejection':
      return `${l.msg}${l.loc ? ` at ${l.loc}` : ''}${l.repeats ? ` (and ${l.repeats} more like it)` : ''}${l.stack ? `\n${indent(l.stack, 6)}` : ''}`
    case 'mark':
      return l.note ? `"${l.note}"` : '(no note)'
    case 'crumb': {
      const { a, ...rest } = f
      return `${a} ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`.trim()
    }
    case 'agent-hook':
      return `${l.id} ${l.state}${l.kind ? ` (${l.kind})` : ''}${l.repeats ? ` x${l.repeats} more` : ''}`
    case 'agent-title':
      return `${l.id} title ${l.state}${l.agent ? ` (${l.agent})` : ''}`
    case 'agent-mark': {
      const held = (l.held ?? []).filter((m) => m !== l.to)
      return `${l.id} ${l.from} -> ${l.to}${held.length ? ` (holds ${held.join(', ')})` : ''}: ${l.why}${l.restored !== undefined ? `, ${(l.restored / 1000).toFixed(1)}s after restore` : ''}`
    }
    case 'agent-restore':
      return `${l.id} restored with resume in ${l.cwd ?? '?'}`
    default:
      return JSON.stringify(f)
  }
}

function indent(text, n) {
  return String(text ?? '')
    .split('\n')
    .filter((s) => s.trim())
    .map((s) => ' '.repeat(n) + s.trim())
    .join('\n')
}

function main() {
  const o = args(process.argv.slice(2))
  if (o.help) {
    // The header comment, however long it grows.
    const head = readFileSync(new URL(import.meta.url), 'utf8').split(/\r?\n/).slice(1)
    const end = head.findIndex((s) => !s.startsWith('//'))
    console.log(head.slice(0, end).join('\n').replace(/^\/\/ ?/gm, ''))
    return
  }
  const dir = logDir(o)
  const all = readLines(dir)
  if (all.length === 0) {
    console.log(`No diagnostics log in ${dir}`)
    return
  }
  const since = duration(o.since)
  const from = since === null ? -Infinity : Date.now() - since
  const lines = all.filter((l) => l._ms >= from)
  const sessions = lines.filter((l) => l.k === 'session')
  const last = [...all].reverse().find((l) => l.k === 'session')
  console.log(`${dir}`)
  if (last) console.log(`last session ${clock(last._ms)}: ${last.app} ${last.version}, pid ${last.pid}${last.verbose ? ', detailed' : ''}`)
  console.log(`${lines.length} lines${since === null ? '' : ` in the last ${o.since}`}, ${sessions.length} session(s)\n`)

  // A line of no tab (a session, a mark) stays in a tab's view.
  const ofTab = (x) => !o.tab || x.id === undefined || x.id === o.tab
  if (o.all || o.agent) {
    // A tab's capped flood (#152): how many lines before this one were not written.
    const dropped = (l) => (AGENT.has(l.k) && l.dropped ? `  [${l.dropped} dropped before]` : '')
    const shown = lines.filter((x) => (o.kinds ? o.kinds.has(x.k) : !o.agent || inAgentTimeline(x)) && ofTab(x))
    if (o.agent && !shown.some((x) => AGENT.has(x.k))) console.log('No agent indicator lines here (an app older than #152 writes none).\n')
    for (const l of shown) console.log(`${clock(l._ms)}  ${String(l.src ?? '?').padEnd(4)}  ${l.k.padEnd(14)}  ${summary(l)}${dropped(l)}`)
    return
  }

  const problems = lines.filter((l) => (o.kinds ? o.kinds.has(l.k) : isProblem(l)) && ofTab(l)).slice(-o.n)
  if (problems.length === 0) {
    console.log('No stalls, errors or slow calls.')
    return
  }
  const crumbs = all.filter(isContext)
  for (const p of problems) {
    console.log(`${clock(p._ms)}  ${String(p.src ?? '?').padEnd(4)}  ${p.k.padEnd(14)}  ${summary(p)}`)
    const before = crumbs.filter((c) => c._ms <= p._ms && c._ms >= p._ms - CRUMB_WINDOW_MS).slice(-CRUMBS_BEFORE)
    for (const c of before) console.log(`      ${((c._ms - p._ms) / 1000).toFixed(1).padStart(6)}s  ${c.src}  ${summary(c)}`)
    console.log('')
  }
}

main()
