import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.7.0', isPackaged: false } }))

const { newerVersion, isReleaseAssetUrl, isInstallerName } = await import('./update')

describe('newerVersion', () => {
  it('orders plain x.y.z triples', () => {
    expect(newerVersion('0.7.1', '0.7.0')).toBe(true)
    expect(newerVersion('0.8.0', '0.7.9')).toBe(true)
    expect(newerVersion('1.0.0', '0.9.9')).toBe(true)
    expect(newerVersion('0.7.0', '0.7.0')).toBe(false)
    expect(newerVersion('0.6.9', '0.7.0')).toBe(false)
  })
  it('accepts a v prefix, the way tags are spelled', () => {
    expect(newerVersion('v0.7.1', '0.7.0')).toBe(true)
    expect(newerVersion('v0.7.0', 'v0.7.0')).toBe(false)
  })
  it('never lets a malformed tag claim to be an upgrade', () => {
    expect(newerVersion('nightly', '0.7.0')).toBe(false)
    expect(newerVersion('', '0.7.0')).toBe(false)
  })
})

describe('isReleaseAssetUrl', () => {
  it("accepts only this repo's release installers", () => {
    expect(
      isReleaseAssetUrl('https://github.com/Maxaubert/Prism/releases/download/v0.7.1/Prism-Setup-x64-0.7.1.exe')
    ).toBe(true)
    expect(isReleaseAssetUrl('https://github.com/evil/repo/releases/download/v1/x.exe')).toBe(false)
    expect(isReleaseAssetUrl('https://example.com/Prism-Setup-x64-0.7.1.exe')).toBe(false)
    expect(
      isReleaseAssetUrl('http://github.com/Maxaubert/Prism/releases/download/v0.7.1/a.exe')
    ).toBe(false)
  })
  it('rejects lookalikes: userinfo tricks, query strings, non-exe payloads', () => {
    expect(
      isReleaseAssetUrl('https://github.com@evil.com/Maxaubert/Prism/releases/download/v1/a.exe')
    ).toBe(false)
    expect(
      isReleaseAssetUrl('https://github.com/Maxaubert/Prism/releases/download/v1/a.exe?x=1')
    ).toBe(false)
    expect(
      isReleaseAssetUrl('https://github.com/Maxaubert/Prism/releases/download/v1/a.msi')
    ).toBe(false)
    expect(isReleaseAssetUrl('not a url')).toBe(false)
  })
})

describe('isInstallerName', () => {
  it("picks this app's installer out of a release's assets", () => {
    expect(isInstallerName('Prism-Setup-x64-0.56.0.exe')).toBe(true)
    expect(isInstallerName('prism-setup-x64-1.2.3.EXE')).toBe(true)
  })
  it('passes over everything else a release can carry', () => {
    // The sibling app shares the owner and the prefix: anchored, so it is not it.
    expect(isInstallerName('PrismTerminal-Setup-x64-0.5.0.exe')).toBe(false)
    expect(isInstallerName('Prism-Setup-x64-0.56.0.exe.blockmap')).toBe(false)
    expect(isInstallerName('latest.yml')).toBe(false)
    expect(isInstallerName('')).toBe(false)
  })
})

describe('latestUpdate', () => {
  // Re-imported so each case reads its own stubbed fetch and a fresh counter.
  const load = async (): Promise<typeof import('./update')> => {
    vi.resetModules()
    return import('./update')
  }
  const asset = {
    name: 'Prism-Setup-x64-0.8.0.exe',
    browser_download_url:
      'https://github.com/Maxaubert/Prism/releases/download/v0.8.0/Prism-Setup-x64-0.8.0.exe'
  }
  const serve = (json: unknown, ok = true): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, json: async () => json }))
    )
  }

  it("carries the release's body as the notes, raw", async () => {
    const body = "## What's Changed\n* A change by @someone in https://github.com/o/r/pull/1"
    serve({ tag_name: 'v0.8.0', body, assets: [asset] })
    const { latestUpdate } = await load()
    expect(await latestUpdate()).toEqual({
      version: '0.8.0',
      url: asset.browser_download_url,
      notes: body
    })
  })

  it('reads a missing, null or non-string body as no notes, never as a crash', async () => {
    for (const body of [undefined, null, 42, { x: 1 }]) {
      serve({ tag_name: 'v0.8.0', body, assets: [asset] })
      const { latestUpdate } = await load()
      expect((await latestUpdate())?.notes).toBe('')
    }
  })

  it('does not carry an enormous body over IPC: the head is all the dialog reads', async () => {
    const { MAX_BODY_CHARS } = await import('prism-term-core/shared/releaseNotes')
    serve({ tag_name: 'v0.8.0', body: 'x'.repeat(MAX_BODY_CHARS * 5), assets: [asset] })
    const { latestUpdate } = await load()
    expect((await latestUpdate())?.notes.length).toBe(MAX_BODY_CHARS)
  })

  it('offers nothing when the release is not newer, has no installer, or the request failed', async () => {
    serve({ tag_name: 'v0.7.0', body: 'x', assets: [asset] })
    expect(await (await load()).latestUpdate()).toBeNull()
    serve({
      tag_name: 'v0.8.0',
      body: 'x',
      assets: [{ name: 'latest.yml', browser_download_url: 'https://x.test/y' }]
    })
    expect(await (await load()).latestUpdate()).toBeNull()
    serve({ tag_name: 'v0.8.0', body: 'x', assets: [asset] }, false)
    expect(await (await load()).latestUpdate()).toBeNull()
  })

  it('counts what it did, which is how the e2e proves a preview did nothing', async () => {
    serve({ tag_name: 'v0.8.0', body: 'x', assets: [asset] })
    const u = await load()
    expect(u.updateCalls()).toEqual({ checks: 0, installs: 0 })
    await u.latestUpdate()
    expect(u.updateCalls()).toEqual({ checks: 1, installs: 0 })
    // Refused before any request: the url is not one of this repo's installers.
    expect(await u.installUpdate('https://example.com/a.exe', () => {})).toBe(false)
    expect(u.updateCalls()).toEqual({ checks: 1, installs: 1 })
  })
})

describe('installUpdate, cancelled (#178)', () => {
  it('stops the download, removes the partial installer and never spawns anything', async () => {
    const { readdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dirs = (): string =>
      readdirSync(tmpdir())
        .filter((n) => n.startsWith('prism-update-'))
        .sort()
        .join('|')
    const before = dirs()
    vi.resetModules()
    const spawn = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn }))
    const run = new AbortController()
    // A download that hands over its first kilobyte and then waits for ever:
    // only the cancel can end it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
        expect(init?.signal).toBe(run.signal)
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(1024))
            }
          }),
          { headers: { 'content-length': '4096' } }
        )
      })
    )
    const { installUpdate } = await import('./update')
    const seen: number[] = []
    const canInstall = vi.fn(async () => true)
    const done = installUpdate(
      'https://github.com/Maxaubert/Prism/releases/download/v9.9.9/Prism-Setup-x64-9.9.9.exe',
      (pct) => {
        seen.push(pct)
        run.abort()
      },
      canInstall,
      run.signal
    )
    expect(await done).toBe(false)
    expect(seen).toEqual([25])
    expect(canInstall).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(dirs()).toBe(before)
    vi.doUnmock('node:child_process')
  })
})

describe('watchForUpdates', () => {
  it('never asks the network from an unpackaged build, and sends nothing itself', async () => {
    // It used to SEND an inert mock from here. The preview is index.ts's to
    // offer now (the core's fake, with notes and a fake install), so an
    // unpackaged watch is simply silent.
    vi.resetModules()
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    const { watchForUpdates, updateCalls } = await import('./update')
    const sent = vi.fn()
    watchForUpdates(sent)
    await Promise.resolve()
    expect(fetched).not.toHaveBeenCalled()
    expect(sent).not.toHaveBeenCalled()
    expect(updateCalls().checks).toBe(0)
  })
})
