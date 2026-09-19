import { execFile } from 'child_process'
import type { IndexerEndpoint } from './indexerRuntime'

const probes = new Map<string, { until: number; result: Promise<IndexerEndpoint | null> }>()

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
    probe = {
      until: Date.now() + 5000,
      result: Promise.all([version('1.5a'), version('')]).then(
        (results) => results.find(Boolean) ?? null
      )
    }
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
