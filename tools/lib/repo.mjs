// The repository root, and the Windows-only guard, for every build script in
// tools/: each one used to work both out for itself.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A build that only means something on Windows says so and stops, green,
 *  anywhere else. */
export function windowsOnly(message) {
  if (process.platform === 'win32') return
  console.log(message)
  process.exit(0)
}
