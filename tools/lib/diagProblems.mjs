// What `npm run diag` counts as a problem, and what it shows before one.
// Split out of tools/diag.mjs (owner, 2026-11-06: "make sure logs are always
// on so you can see what happened") so the rules have tests.

/** A problem is any of these, or an app's own `-slow` kind. */
export const PROBLEMS = new Set([
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
export const AGENT = new Set(['agent-hook', 'agent-title', 'agent-mark', 'agent-restore'])

/**
 * A problem: one of PROBLEMS, a `-slow` kind, an operation that failed (not
 * one the user cancelled, nor a copy a newer copy replaced), or a note that
 * told the user something did not work (`error` or `warn`).
 */
export const isProblem = (l) =>
  PROBLEMS.has(l.k) ||
  /-slow$/.test(l.k) ||
  (l.k === 'op' && l.ok === false && !l.canceled && !l.superseded) ||
  (l.k === 'note' && (l.level === 'error' || l.level === 'warn'))

/** Context shown before a problem: the crumbs, the marks' moves, and every
 *  operation's outcome, so a note shows the operation it came from. */
export const isContext = (l) => l.k === 'crumb' || l.k === 'op' || l.k === 'agent-mark' || l.k === 'agent-restore'

/** An `op` line, said briefly. */
export function opSummary(l) {
  const bits = []
  if (typeof l.n === 'number') bits.push(`${l.n} asked`)
  if (typeof l.landed === 'number') bits.push(`${l.landed} landed`)
  if (l.failed) {
    const why = (l.failures ?? []).map((f) => `${f.name}: ${f.reason}`).join(', ')
    bits.push(`${l.failed} failed${why ? ` (${why})` : ''}`)
  }
  if (l.skipped) bits.push(`${l.skipped} skipped`)
  if (l.clashes) bits.push(`${l.clashes} name clashes`)
  if (l.busy) bits.push(`${l.busy} in use`)
  if (l.refused) bits.push('refused by the wall')
  if (l.empty) bits.push('nothing on the clipboard')
  else if (l.reason) bits.push(`${l.reason}${l.phase ? ` at ${l.phase}` : ''}`)
  if (l.message) bits.push(`"${l.message}"`)
  if (l.op !== 'paste' && l.op !== 'cut-paste' && l.source) bits.push(l.source)
  if (l.source && (l.op === 'paste' || l.op === 'cut-paste')) bits.push(`from ${l.source}${l.why ? ` (${l.why})` : ''}`)
  if (l.via) bits.push(`via ${l.via}`)
  if (l.attempts > 1) bits.push(`${l.attempts} attempts${l.firstReason && l.ok ? ` (first: ${l.firstReason}${l.firstPhase ? ` at ${l.firstPhase}` : ''})` : ''}`)
  if (typeof l.ms === 'number') bits.push(`${l.ms}ms`)
  const where = l.to ? ` to ${l.to}` : l.into ? ` into ${l.into}` : l.path ? ` ${l.path}` : l.zip ? ` ${l.zip}` : ''
  const state = l.canceled ? 'cancelled' : l.superseded ? 'replaced by a newer copy' : l.ok ? 'ok' : 'FAILED'
  return `${l.op} ${state}${where}: ${bits.join(', ')}`
}

/** A `note` line, said briefly. */
export function noteSummary(l) {
  return `${l.level ?? 'note'}${l.op ? ` from ${l.op}` : ''}${l.title ? ` [${l.title}]` : ''}: "${l.text}"`
}
