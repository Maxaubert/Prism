/**
 * One run at a time (audit #73): a call made while the first is still running gets that
 * run's promise instead of starting a second. The phone server's start uses it, so a
 * boot auto-start and a Settings switch cannot bind two listeners.
 */
export function oneAtATime(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null
  return () => {
    if (!running) {
      running = run().finally(() => {
        running = null
      })
    }
    return running
  }
}
