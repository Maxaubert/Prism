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
      await promisify(execFile)(
        runtime.endpoint.exe,
        [
          '-instance',
          runtime.endpoint.instance,
          '-timeout',
          '120000',
          '-json',
          '-n',
          '1',
          '-search*',
          '*'
        ],
        { windowsHide: true, windowsVerbatimArguments: true, timeout: 125000 }
      )
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
        const diagnostic = await promisify(execFile)(
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
        const failed = failure as { status?: number; stdout?: string; stderr?: string }
        console.error(
          'Indexer diagnostic failed',
          args,
          failed.status,
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
  240000
)
