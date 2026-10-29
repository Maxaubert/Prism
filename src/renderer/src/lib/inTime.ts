/**
 * A wait with a limit: the value if it comes within `ms`, else null (a
 * rejection is null too). The late value is simply dropped.
 *
 * WHY (tab tear-off step 2, review 2026-10-29): a Win+E window lands on
 * "Folder for new tabs", and the folder verb on its own folder. When that is
 * a sleeping network share the read waits out the SMB timeout, nothing
 * answers the helper within its 45 s patience, and File Explorer opened on
 * top of Prism. Bounded, the window lands on what it has (Home) and answers.
 */
export function inTime<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}
