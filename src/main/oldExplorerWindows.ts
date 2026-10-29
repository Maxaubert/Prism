import { lstat, readdir, rm, rmdir } from 'fs/promises'
import { join, resolve } from 'path'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Where the retired Win+E processes kept their Chromium profiles. */
export const OLD_EXPLORER_WINDOWS = 'explorer-windows'
/** The marker each of them (and the owner) wrote. */
const OLD_MARKER = 'prism-window.json'

/**
 * WHAT THE OLD WIN+E WINDOWS LEFT BEHIND (tab tear-off step 2, 2026-10-29).
 * Up to 0.120, a Win+E press while Prism ran started a whole second Prism
 * with its own Chromium profile under `<userData>/explorer-windows/<uuid>`,
 * and every process wrote a `prism-window.json` marker. A Win+E window is a
 * window of this process now, so those profiles are dead weight: removed
 * here, off the startup path (the caller waits for the first answer), and
 * with nothing to do once they have gone. Only uuid-named profiles, and the
 * folder itself only when that left it empty: nothing else is touched. The
 * installer kills every Prism before an upgrade, so none is in use; a file
 * still locked is simply left for the next start. A folder that is a link
 * (a junction or a symlink) is never walked: its uuid folders would be
 * outside the profile (review, 2026-10-29).
 */
export async function removeOldExplorerWindows(profile: string): Promise<void> {
  const root = join(resolve(profile), OLD_EXPLORER_WINDOWS)
  await rm(join(resolve(profile), OLD_MARKER), { force: true }).catch(() => {})
  const kind = await lstat(root).catch(() => null)
  if (!kind?.isDirectory() || kind.isSymbolicLink()) return
  const entries = await readdir(root, { withFileTypes: true }).catch(() => null)
  if (!entries) return
  for (const item of entries) {
    if (!item.isDirectory() || item.isSymbolicLink() || !UUID.test(item.name)) continue
    await rm(join(root, item.name), { recursive: true, force: true }).catch(() => {})
  }
  await rmdir(root).catch(() => {
    /* not empty: something that is not ours stays */
  })
}
