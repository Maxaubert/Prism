/**
 * WHAT A LAG'S PROFILE SAYS, IN ONE LINE (2026-10-12, with lagProfiler.ts):
 * of the last `lagMs` of a V8 .cpuprofile (the lag ends where the window was
 * stopped), how much was JavaScript and which functions it was in. V8 marks
 * time outside JavaScript `(idle)` or `(program)`: a lag that is almost all
 * of that was spent in native code (Chromium, the window system, the OS) or
 * waiting for main's thread to be scheduled, and the profile cannot say
 * which. The first such lag the profiler caught (e2e `markTint`) was 229 ms
 * of `(idle)`, at the same millisecond as a lag in the owner's own Prism.
 */

interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
}
interface ProfileNode {
  id: number
  callFrame: CallFrame
  children?: number[]
}
export interface CpuProfile {
  nodes: ProfileNode[]
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

export interface LagSummary {
  /** Sampled time in JavaScript (not idle, program or GC). */
  jsMs: number
  /** Garbage collection. */
  gcMs: number
  /** Outside JavaScript: `(idle)` and `(program)`. */
  nativeMs: number
  /** The functions with the most self time, `name file:line ms`. A builtin
   *  (`spawn`, `readFileUtf8`: no line of its own) names its JavaScript
   *  caller: `spawn in flush index.js:273 405ms`. */
  top: string[]
}

const NATIVE = new Set(['(idle)', '(program)'])

/** `tailMs`: how long the window ran on after the lag ended (a window the
 *  rotation stopped just after the lag, before it was logged). */
export function summarizeLag(
  profile: CpuProfile,
  lagMs: number,
  topN = 3,
  tailMs = 0
): LagSummary | null {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples)) return null
  const byId = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map<number, number>()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const where = (cf: CallFrame): string =>
    `${cf.functionName || '(anonymous)'} ${cf.url.split(/[\\/]/).pop() || '?'}:${cf.lineNumber + 1}`
  /** Code with a line that is not Node's own (`node:` internals are the
   *  builtin's wrapper, not who asked). */
  const own = (cf: CallFrame): boolean => cf.lineNumber >= 0 && !cf.url.startsWith('node:')
  /** The sample's function; for a builtin, the code that called it too. */
  const nameOf = (id: number): string => {
    const cf = byId.get(id)?.callFrame
    if (!cf) return '?'
    if (own(cf)) return where(cf)
    for (let up = parent.get(id); up !== undefined; up = parent.get(up)) {
      const pf = byId.get(up)?.callFrame
      if (pf && own(pf)) return `${cf.functionName} in ${where(pf)}`
    }
    return cf.functionName
  }
  const to = profile.endTime - Math.max(0, tailMs) * 1000
  const from = to - lagMs * 1000
  let t = profile.startTime
  let js = 0
  let gc = 0
  let native = 0
  const self = new Map<string, number>()
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i] ?? 0
    t += delta
    // A sample stands for the time since the one before it: only the part
    // inside the lag counts.
    const us = Math.min(t, to) - Math.max(t - Math.max(0, delta), from)
    if (us <= 0) continue
    const cf = byId.get(profile.samples[i])?.callFrame
    if (!cf) continue
    if (NATIVE.has(cf.functionName)) native += us
    else if (cf.functionName === '(garbage collector)') gc += us
    else {
      js += us
      const key = nameOf(profile.samples[i])
      self.set(key, (self.get(key) ?? 0) + us)
    }
  }
  const ms = (us: number): number => Math.round(us / 1000)
  const top = [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k, us]) => `${k} ${ms(us)}ms`)
  return { jsMs: ms(js), gcMs: ms(gc), nativeMs: ms(native), top }
}
