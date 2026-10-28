import { execFile } from './spawnWorker'
import type { IndexerEndpoint } from './indexerRuntime'

const probes = new Map<string, { until: number; result: Promise<IndexerEndpoint | null> }>()

/**
 * HOW LONG AN ANSWER HOLDS (perf review #32 and #42, 2026-10-28). Every
 * folder opened asked twice (two es.exe processes) whenever the last answer
 * was over 5 s old, though whether the user's Everything runs almost never
 * changes. A found one is trusted for minutes and forgotten at once when a
 * query against it fails (`forgetRunningEverything`); none found is asked
 * again after half a minute, so one started meanwhile is found soon.
 */
export const FOUND_TTL_MS = 5 * 60_000
export const ABSENT_TTL_MS = 30_000
/** While the probe runs: callers share it. */
const PROBING_TTL_MS = 5000

/** A query against what the probe found failed: ask again next time. */
export function forgetRunningEverything(exe: string): void {
  probes.delete(exe)
}

/** Read-only discovery through our bundled client. Never start, stop or configure
 * another Everything installation. Share brief probes across typing and rows. */
export async function findRunningEverything(
  exe: string,
  signal?: AbortSignal
): Promise<IndexerEndpoint | null> {
  if (signal?.aborted) return null
  let probe = probes.get(exe)
  if (!probe || probe.until < Date.now()) {
    const version = (instance: string): Promise<IndexerEndpoint | null> =>
      new Promise((done) => {
        execFile(
          exe,
          [...(instance ? ['-instance', instance] : []), '-get-everything-version'],
          { windowsHide: true, timeout: 500 },
          (error, output) => {
            done(!error && /^1\.[45]\./.test(output.trim()) ? { exe, instance } : null)
          }
        )
      })
    const made: { until: number; result: Promise<IndexerEndpoint | null> } = {
      until: Date.now() + PROBING_TTL_MS,
      result: Promise.all([version('1.5a'), version('')]).then((results) => {
        const found = results.find(Boolean) ?? null
        made.until = Date.now() + (found ? FOUND_TTL_MS : ABSENT_TTL_MS)
        return found
      })
    }
    probe = made
    probes.set(exe, probe)
  }
  const pending = probe.result
  if (!signal) return pending
  return new Promise((done) => {
    const finish = (result: IndexerEndpoint | null): void => {
      signal.removeEventListener('abort', abort)
      done(result)
    }
    const abort = (): void => finish(null)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    void pending.then((result) => finish(signal.aborted ? null : result))
  })
}
