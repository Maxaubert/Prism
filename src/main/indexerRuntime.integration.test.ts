import { expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { createIndexerRuntime, initializeIndexerRuntime } from './indexerRuntime'
import {
  getIndexedFolderSizes,
  searchEverythingBrowse,
  searchEverythingBrowseWindow
} from './everythingBrowse'
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'

const run = promisify(execFile)

// The first full NTFS index of a fresh runner's fixed volumes. Measured on
// windows-latest, 2026-10-12..30: the whole service smoke passed in 77-114 s,
// and all 16 failures in that time were ES giving up at the old 120 s mark.
const FIRST_INDEX_BUDGET_MS = 300000
// One ES attempt is short so a stuck client cannot spend the whole budget.
const ATTEMPT_MS = 15000

function esFailure(error: unknown): string {
  const e = error as { stdout?: string; stderr?: string; message?: string }
  return `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`
}

/**
 * Waits until the instance's database has loaded, within a bounded budget.
 * ES answers "Error 8: Everything IPC not found" both when the IPC window is
 * missing AND when -timeout runs out while the database is still loading
 * (measured: it returns only after the full -timeout), so Error 8 alone is
 * retried; any other failure ends the wait at once. On timeout the error says
 * which of the two it was, by asking for the engine version, which needs only
 * the IPC window.
 */
async function waitForDatabase(exe: string, instance: string): Promise<void> {
  const started = Date.now()
  const until = started + FIRST_INDEX_BUDGET_MS
  for (;;) {
    const attempt = Math.max(1000, Math.min(ATTEMPT_MS, until - Date.now()))
    try {
      await run(
        exe,
        ['-instance', instance, '-timeout', String(attempt), '-json', '-n', '1', '-search*', '*'],
        { windowsHide: true, windowsVerbatimArguments: true, timeout: attempt + 10000 }
      )
      console.log(
        `Private index database ready after ${Math.round((Date.now() - started) / 1000)} s`
      )
      return
    } catch (error) {
      const e = error as { code?: number }
      if (e.code !== 8 && !/Error 8:/.test(esFailure(error))) throw error
      if (Date.now() >= until) {
        const window = await run(exe, ['-instance', instance, '-get-everything-version'], {
          windowsHide: true,
          windowsVerbatimArguments: true,
          timeout: 5000
        }).then(
          () => 'the IPC window answers, so the database was still loading',
          () => 'the IPC window was never found'
        )
        throw new Error(
          `Private index not ready after ${FIRST_INDEX_BUDGET_MS / 1000} s: ${window}. ${esFailure(error)}`,
          { cause: error }
        )
      }
    }
    await new Promise((done) => setTimeout(done, 500))
  }
}

async function smoke(service: boolean): Promise<void> {
  if (service && process.env.PRISM_INDEXER_TEST_REQUIRE_NONADMIN === '1') {
    const elevated = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
      ],
      { windowsHide: true, encoding: 'utf8' }
    ).trim()
    expect(elevated).toBe('False')
  }
  const directory = await mkdtemp(join(tmpdir(), 'prism-private-index-'))
  const root = join(directory, 'files with spaces')
  const folder = join(root, 'folder, with comma')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'sample.dll'), Buffer.alloc(321))
  await writeFile(join(folder, '.hidden'), Buffer.alloc(123))
  const options = {
    binaryDirectory: service
      ? join(process.env.PRISM_INDEXER_TEST_INSTALL_DIRECTORY!, 'resources', 'everything')
      : resolve('vendor/everything'),
    storageDirectory: join(directory, 'private-profile'),
    allowService: service,
    serviceInstance: service ? process.env.PRISM_INDEXER_TEST_SERVICE_INSTANCE : undefined
  }
  const runtime = initializeIndexerRuntime(options)
  let second: ReturnType<typeof createIndexerRuntime> | undefined
  try {
    const endpoint = await runtime.ensureReady(root)
    expect(endpoint?.exe).toBe(join(options.binaryDirectory, 'es.exe'))
    expect(endpoint?.instance).toMatch(/^Prism-/)
    if (service) {
      // A clean runner must build its first volume index. Wait for database
      // readiness explicitly before testing normal short query deadlines.
      // The old wait was one ES call with a 120 s -timeout; on a slow runner
      // the first index outlasted it and ES reported Error 8 although the IPC
      // window was there (the version diagnostic right after answered; CI
      // 2026-10-12..29, 16 failures, every one at the 120 s mark).
      await waitForDatabase(runtime.endpoint.exe, runtime.endpoint.instance)
    }
    await expect
      .poll(
        async () =>
          (
            await searchEverythingBrowse(root, 'file: ext:dll', 100, new AbortController().signal)
          )?.map((entry) => entry.filename),
        { timeout: service ? 60000 : 30000 }
      )
      .toEqual([join(folder, 'sample.dll')])
    await expect
      .poll(async () => (await getIndexedFolderSizes([folder]))?.get(folder)?.bytes, {
        timeout: service ? 60000 : 30000
      })
      .toBe(444)
    const viewport = await searchEverythingBrowseWindow(
      root,
      'file:',
      { offset: 1, limit: 1, sort: { key: 'size', direction: 'asc' } },
      new AbortController().signal
    )
    expect(viewport).toMatchObject({
      offset: 1,
      total: 2,
      rows: [{ filename: join(folder, 'sample.dll'), size: 321 }]
    })
    expect(viewport?.rows).toHaveLength(1)
    const ini = await readFile(join(options.storageDirectory, 'Everything.ini'), 'utf8')
    expect(ini).toContain('show_tray_icon=0')
    expect(ini).toContain(`auto_include_fixed_volumes=${service ? 1 : 0}`)
    if (service) expect(ini).toContain('folders=\r\n')
    second = createIndexerRuntime(options)
    expect(await second.ensureReady(root)).toEqual(endpoint)
    await second.dispose()
    second = undefined
    expect(
      (await searchEverythingBrowse(root, 'file: ext:dll', 100, new AbortController().signal))
        ?.length
    ).toBe(1)
    // A new runtime loads the same database after an orderly close.
    await runtime.dispose()
    const restarted = initializeIndexerRuntime(options)
    try {
      expect(await restarted.ensureReady(root)).toEqual(endpoint)
      await expect
        .poll(
          async () =>
            (await searchEverythingBrowse(root, 'file: ext:dll', 100, new AbortController().signal))
              ?.length,
          { timeout: 30000 }
        )
        .toBe(1)
    } finally {
      await restarted.dispose()
    }
    expect(
      (await readFile(join(options.storageDirectory, 'Everything.db'))).length
    ).toBeGreaterThan(0)
  } catch (error) {
    console.error('Private indexer status:', runtime.status())
    console.error(
      await readFile(join(options.storageDirectory, 'Everything.ini'), 'utf8').catch(
        () => 'No indexer config'
      )
    )
    for (const args of [
      ['-get-everything-version'],
      ['-json', '-n', '3', '-search*', '*'],
      ['-json', '-n', '3', '-path', `"${root}"`, '-search*', '*']
    ]) {
      try {
        const diagnostic = await run(
          runtime.endpoint.exe,
          ['-instance', runtime.endpoint.instance, ...args],
          {
            windowsHide: true,
            windowsVerbatimArguments: true,
            encoding: 'utf8',
            timeout: 3000,
            maxBuffer: 65536
          }
        )
        console.error('Indexer diagnostic', args, diagnostic.stdout)
      } catch (failure) {
        const failed = failure as { code?: number | string; stdout?: string; stderr?: string }
        console.error(
          'Indexer diagnostic failed',
          args,
          failed.code,
          String(failed.stdout ?? '').slice(0, 1000),
          String(failed.stderr ?? '').slice(0, 1000)
        )
      }
    }
    throw error
  } finally {
    await second?.dispose()
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}
it.skipIf(process.env.PRISM_INDEXER_INTEGRATION !== '1')(
  'bundled engine indexes without an installed Everything, shares windows and persists its database',
  () => smoke(false),
  90000
)
it.skipIf(
  !process.env.PRISM_INDEXER_TEST_SERVICE_INSTANCE ||
    !process.env.PRISM_INDEXER_TEST_INSTALL_DIRECTORY
)(
  'bundled engine uses the protected private service for NTFS search and folder totals',
  () => smoke(true),
  // The 300 s first-index wait, then the query polls (up to 150 s).
  480000
)
