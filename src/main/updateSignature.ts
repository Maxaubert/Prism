import { createPublicKey, verify } from 'node:crypto'

/**
 * THE UPDATE IS SIGNED (#534 #10; owner, 2026-11-19: "Signed list").
 *
 * Before this the in-app update downloaded the installer from this repo's
 * releases and ran it, trusting GitHub alone: a swapped release asset would
 * have run silently. Now release.yml signs every installer with an Ed25519
 * key held only in the PRISM_UPDATE_KEY Actions secret (and one offline
 * backup on the owner's PC, `%USERPROFILE%\.keys\prism-update-ed25519.pem`),
 * and the app checks that signature with the public half below before it
 * starts anything. No signature, a wrong one, or a signature for another
 * file name means nothing is installed.
 *
 * What is signed is the LINE `prism-update-v1`, the installer's file name and
 * its SHA-256, so an old genuine installer cannot be passed off under a newer
 * version's name. `tools/sign-update.mjs` writes the same message; the test
 * runs that tool and checks its output here, so the two cannot drift.
 *
 * A new key means every installed copy stops updating itself until the owner
 * installs a build carrying the new public half by hand. Keep the backup.
 */
export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEArCZKiDvtps0r0Sbn9y5u2QECwX8m2gxG2VD81LgPQhk=
-----END PUBLIC KEY-----
`

/** The bytes that are signed for one installer. */
export function signedMessage(fileName: string, sha256Hex: string): Buffer {
  return Buffer.from(`prism-update-v1\n${fileName}\n${sha256Hex.toLowerCase()}\n`, 'utf8')
}

/** The largest signature file read: an Ed25519 signature is 88 base64 chars. */
export const MAX_SIGNATURE_CHARS = 512

/** True only when `signatureB64` is the key's signature for this file name and hash. */
export function verifyInstaller(
  fileName: string,
  sha256Hex: string,
  signatureB64: string,
  publicKeyPem: string = UPDATE_PUBLIC_KEY
): boolean {
  const sig = signatureB64.trim()
  if (!sig || sig.length > MAX_SIGNATURE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) return false
  if (!/^[0-9a-f]{64}$/i.test(sha256Hex)) return false
  try {
    return verify(null, signedMessage(fileName, sha256Hex), createPublicKey(publicKeyPem), Buffer.from(sig, 'base64'))
  } catch {
    return false
  }
}
