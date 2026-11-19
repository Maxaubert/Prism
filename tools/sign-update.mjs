// Signs a built installer for the in-app update (#534 #10). release.yml runs
// it after electron-builder:
//
//   node tools/sign-update.mjs dist/Prism-Setup-x64-<version>.exe
//
// The Ed25519 private key comes from the PRISM_UPDATE_KEY environment variable
// (the Actions secret, a PKCS#8 PEM). It writes `<installer>.sig`, the base64
// signature of `prism-update-v1\n<file name>\n<sha256 hex>\n`, the message
// src/main/updateSignature.ts checks. Before writing it makes sure the key's
// public half is the one the app carries, so a wrong secret fails the release
// instead of shipping installers no app will accept.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
const pem = process.env.PRISM_UPDATE_KEY
if (!file) throw new Error('usage: node tools/sign-update.mjs <installer.exe>')
if (!pem || !pem.includes('PRIVATE KEY')) throw new Error('PRISM_UPDATE_KEY is not set: the update cannot be signed')

const key = createPrivateKey(pem)
const shipped = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'main', 'updateSignature.ts'), 'utf8')
// The unit test signs with a throwaway key and names its public half here.
const carried =
  process.env.PRISM_UPDATE_PUBLIC_KEY_TEST ?? /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/.exec(shipped)?.[0]
const ours = createPublicKey(key).export({ type: 'spki', format: 'pem' }).toString().trim()
if (!carried || carried.replace(/\s+/g, '') !== ours.replace(/\s+/g, '')) {
  throw new Error('PRISM_UPDATE_KEY does not match UPDATE_PUBLIC_KEY in src/main/updateSignature.ts')
}

const hash = createHash('sha256')
for await (const chunk of createReadStream(file)) hash.update(chunk)
const message = Buffer.from(`prism-update-v1\n${basename(file)}\n${hash.digest('hex')}\n`, 'utf8')
writeFileSync(`${file}.sig`, sign(null, message, key).toString('base64') + '\n')
console.log(`signed ${basename(file)} -> ${basename(file)}.sig`)
