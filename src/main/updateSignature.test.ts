import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { UPDATE_PUBLIC_KEY, verifyInstaller } from './updateSignature'

/**
 * THE UPDATE IS SIGNED (#534 #10). The tool release.yml runs and the check the
 * app runs must agree, so these tests sign with the real tool (a throwaway key)
 * and verify with the real check.
 */

const pair = (): { priv: string; pub: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const TOOL = join(process.cwd(), 'tools', 'sign-update.mjs')

/** Runs tools/sign-update.mjs on a fresh installer; returns its bytes and signature. */
function signWithTool(key: { priv: string; pub?: string }, name = 'Prism-Setup-x64-1.2.3.exe') {
  const dir = mkdtempSync(join(tmpdir(), 'sig-'))
  const file = join(dir, name)
  const bytes = Buffer.from(`installer ${name} ${Math.random()}`)
  writeFileSync(file, bytes)
  execFileSync(process.execPath, [TOOL, file], {
    env: {
      ...process.env,
      PRISM_UPDATE_KEY: key.priv,
      ...(key.pub ? { PRISM_UPDATE_PUBLIC_KEY_TEST: key.pub } : { PRISM_UPDATE_PUBLIC_KEY_TEST: undefined })
    },
    stdio: 'pipe'
  })
  return { bytes, sig: readFileSync(`${file}.sig`, 'utf8') }
}

describe('the signed update (#534 #10)', () => {
  it("accepts what the release tool signed, for that file's name and bytes", () => {
    const key = pair()
    const { bytes, sig } = signWithTool(key)
    expect(verifyInstaller('Prism-Setup-x64-1.2.3.exe', sha(bytes), sig, key.pub)).toBe(true)
  })

  it('refuses an old genuine installer passed off under a newer name', () => {
    const key = pair()
    const { bytes, sig } = signWithTool(key, 'Prism-Setup-x64-1.0.0.exe')
    expect(verifyInstaller('Prism-Setup-x64-9.0.0.exe', sha(bytes), sig, key.pub)).toBe(false)
  })

  it('refuses changed bytes, another key, and the app key for a stranger signature', () => {
    const key = pair()
    const { bytes, sig } = signWithTool(key)
    const name = 'Prism-Setup-x64-1.2.3.exe'
    expect(verifyInstaller(name, sha(Buffer.concat([bytes, Buffer.from('x')])), sig, key.pub)).toBe(false)
    expect(verifyInstaller(name, sha(bytes), sig, pair().pub)).toBe(false)
    expect(verifyInstaller(name, sha(bytes), sig, UPDATE_PUBLIC_KEY)).toBe(false)
  })

  it('refuses no signature, junk and an oversized file without throwing', () => {
    const h = sha(Buffer.from('a'))
    for (const sig of ['', '   ', 'not base64 !!', 'A'.repeat(4000), '<html>404</html>']) {
      expect(verifyInstaller('Prism-Setup-x64-1.2.3.exe', h, sig)).toBe(false)
    }
    expect(verifyInstaller('Prism-Setup-x64-1.2.3.exe', 'nothex', 'AAAA')).toBe(false)
  })

  it('the tool refuses a key whose public half the app does not carry', () => {
    expect(() => signWithTool({ priv: pair().priv })).toThrow()
  })

  it('the tool refuses to run with no key', () => {
    expect(() => signWithTool({ priv: '' , pub: pair().pub })).toThrow()
  })
})

describe('installUpdate checks the signature before it runs anything', () => {
  const URL_ =
    'https://github.com/Maxaubert/Prism/releases/download/v9.9.9/Prism-Setup-x64-9.9.9.exe'

  async function attempt(sigFor: (bytes: Buffer, key: { priv: string; pub: string }) => string | null) {
    const key = pair()
    const bytes = Buffer.from('the installer')
    const sig = sigFor(bytes, key)
    vi.resetModules()
    const spawn = vi.fn(() => ({ unref: vi.fn() }))
    vi.doMock('node:child_process', () => ({ spawn }))
    vi.doMock('electron', () => ({ app: { getVersion: () => '0.7.0', isPackaged: false, quit: vi.fn() } }))
    vi.doMock('./updateSignature', async (orig) => ({
      ...(await orig<typeof import('./updateSignature')>()),
      UPDATE_PUBLIC_KEY: key.pub
    }))
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(url)
        if (url.endsWith('.sig')) return sig === null ? new Response('nope', { status: 404 }) : new Response(sig)
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
      })
    )
    const { installUpdate } = await import('./update')
    const ok = await installUpdate(URL_, () => {})
    vi.doUnmock('node:child_process')
    vi.doUnmock('electron')
    vi.doUnmock('./updateSignature')
    vi.unstubAllGlobals()
    return { ok, spawned: spawn.mock.calls.length, asked }
  }

  /** Signs the bytes the way release.yml does, by running the tool on a copy. */
  const toolSig = (bytes: Buffer, key: { priv: string; pub: string }, name = 'Prism-Setup-x64-9.9.9.exe'): string => {
    const dir = mkdtempSync(join(tmpdir(), 'sig-'))
    const file = join(dir, name)
    writeFileSync(file, bytes)
    execFileSync(process.execPath, [TOOL, file], {
      env: { ...process.env, PRISM_UPDATE_KEY: key.priv, PRISM_UPDATE_PUBLIC_KEY_TEST: key.pub },
      stdio: 'pipe'
    })
    return readFileSync(`${file}.sig`, 'utf8')
  }

  it('a signed installer is handed to the installer', async () => {
    const r = await attempt((b, k) => toolSig(b, k))
    expect(r.ok).toBe(true)
    expect(r.spawned).toBe(1)
    expect(r.asked).toEqual([URL_, `${URL_}.sig`])
  })

  it('no signature, or one for another version, runs nothing', async () => {
    for (const sigFor of [
      () => null,
      (b: Buffer, k: { priv: string; pub: string }) => toolSig(b, k, 'Prism-Setup-x64-1.0.0.exe'),
      () => 'AAAA'
    ]) {
      const r = await attempt(sigFor)
      expect(r.ok).toBe(false)
      expect(r.spawned).toBe(0)
    }
  })
})
