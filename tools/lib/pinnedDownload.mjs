// A download pinned by SHA-256, for the fetch scripts and the e2e's own cache.
// Each fetch script used to hand-roll the fetch, the hash and the refusal; the
// pins themselves stay in the scripts, where the CI cache key reads them.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const sha256Of = (data) => createHash('sha256').update(data).digest('hex')

/** The bytes at `url`, or a throw: a failed request names its status, a body
 *  that is not the pinned one names both hashes. */
export async function fetchVerified(url, sha256) {
  const res = await fetch(url)
  if (!res.ok)
    throw Object.assign(new Error(`download failed (${res.status} ${res.statusText})`), { status: res.status })
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256Of(buf)
  if (got !== sha256) throw new Error(`SHA-256 mismatch, refusing it\n  expected ${sha256}\n  got      ${got}`)
  return buf
}

/**
 * A fetch script's download: "label: downloading what", then the verified
 * bytes. Anything wrong is printed under the label and ends the script with
 * exit 1; `hint(status)` may add a line for a failed request (ffmpeg's
 * rotated-away builds).
 */
export async function pinnedDownload(label, url, sha256, { what, hint } = {}) {
  console.log(`${label}: downloading ${what}`)
  try {
    return await fetchVerified(url, sha256)
  } catch (err) {
    console.error(`${label}: ${what}: ${err.message}\n  ${url}`)
    const more = err.status ? hint?.(err.status) : undefined
    if (more) console.error(more)
    process.exit(1)
  }
}

/** True when `dir` holds `file` and its `.source` stamp reads `value`: the
 *  pinned download is already unpacked there. */
export function stampHolds(dir, file, value) {
  const stamp = join(dir, '.source')
  return existsSync(join(dir, file)) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === value
}

/** Write the `.source` stamp `stampHolds` reads. */
export function writeStamp(dir, value) {
  writeFileSync(join(dir, '.source'), value + '\n')
}

/**
 * Copy the named entries of a release zip into `dir`, flattened: every entry
 * sits under one top-level folder named after the build, so each is found by
 * its tail. A missing one ends the script under `label`. Returns how many.
 */
export async function unzipFlat(label, buf, wanted, dir) {
  const { default: AdmZip } = await import('adm-zip')
  const entries = new AdmZip(buf).getEntries()
  for (const want of wanted) {
    const hit = entries.find((e) => e.entryName.endsWith('/' + want))
    if (!hit) {
      console.error(`${label}: ${want} is missing from the archive`)
      process.exit(1)
    }
    writeFileSync(join(dir, want.split('/').pop()), hit.getData())
  }
  return wanted.length
}

/** The e2e's downloads: fetched once into `dir`, verified, and kept there;
 *  a cached copy is used only while its hash still matches. */
export async function cachedDownload(dir, name, url, sha256) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  if (existsSync(file) && sha256Of(readFileSync(file)) === sha256) return file
  console.log(`  (fetching ${name} into .e2e/cache, once)`)
  try {
    writeFileSync(file, await fetchVerified(url, sha256))
  } catch (err) {
    throw new Error(`${name}: ${err.message}`, { cause: err })
  }
  return file
}
