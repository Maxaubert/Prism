import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createIndexerRuntime,
  indexerConfig,
  indexerInstance,
  mergeIndexRoots
} from './indexerRuntime'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'prism-indexer-'))
  temporary.push(directory)
  const binaryDirectory = join(directory, 'bin')
  const storageDirectory = join(directory, 'profile')
  await mkdir(binaryDirectory)
  await Promise.all(
    ['Everything.exe', 'es.exe'].map((name) => writeFile(join(binaryDirectory, name), ''))
  )
  let started = false
  const run = vi.fn(async (_exe: string, args: string[]): Promise<string> => {
    if (args.includes('-exit')) {
      started = false
      return ''
    }
    if (args.includes('-get-everything-version')) {
      if (!started) throw new Error('IPC unavailable')
      return '1.4.1.1032'
    }
    return ''
  })
  const start = vi.fn(async () => {
    started = true
  })
  const alive = vi.fn((pid: number) => pid === 101 || pid === 102)
  return {
    options: { binaryDirectory, storageDirectory, allowService: false },
    deps: { run, start, alive, pid: 101 }
  }
}

describe('private bundled indexer', () => {
  it('has stable shared profile identity without sharing with another profile', () => {
    expect(indexerInstance('C:\\Profiles\\Main\\')).toBe(indexerInstance('c:\\profiles\\MAIN'))
    expect(indexerInstance('C:\\Profiles\\Main')).not.toBe(indexerInstance('C:\\Profiles\\Preview'))
  })

  it('preserves all files and folder-size indexing without personal settings or servers', () => {
    const ini = indexerConfig(['C:\\a,b', 'C:\\regular'])
    expect(ini).toContain('folders="C:\\\\a,b","C:\\\\regular"')
    expect(ini).toContain('index_folder_size=1')
    expect(ini).toContain('exclude_hidden_files_and_folders=0')
    expect(ini).toContain('show_tray_icon=0')
    expect(ini).toContain('auto_include_fixed_volumes=0')
    expect(ini).toContain('http_server_enabled=0')
    expect(ini).toContain('folder_monitor_changes=1,1')
  })

  it('coalesces nested roots without confusing sibling prefixes', () => {
    expect(mergeIndexRoots(['C:\\work\\a'], ['C:\\work', 'C:\\worker', 'C:\\work\\b'])).toEqual([
      'C:\\work',
      'C:\\worker'
    ])
  })

  it('shares one private instance and only exits after the last window releases it', async () => {
    const { options, deps } = await setup()
    const first = createIndexerRuntime(options, deps)
    const second = createIndexerRuntime(options, { ...deps, pid: 102 })
    const endpoint = await first.ensureReady('C:\\Fixture')
    expect(endpoint?.exe).toBe(join(options.binaryDirectory, 'es.exe'))
    expect(await second.ensureReady('C:\\Fixture\\nested')).toEqual(endpoint)
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(deps.start.mock.calls[0]).toEqual([
      join(options.binaryDirectory, 'Everything.exe'),
      expect.arrayContaining(['-instance', endpoint!.instance, '-startup'])
    ])
    await first.dispose()
    expect(deps.run.mock.calls.some(([, args]) => args.includes('-exit'))).toBe(false)
    await second.dispose()
    expect(deps.run.mock.calls.filter(([, args]) => args.includes('-exit'))).toHaveLength(1)
  })

  it('persists visited roots, recovers stale clients and restarts only its private instance for a new root', async () => {
    const { options, deps } = await setup()
    const runtime = createIndexerRuntime(options, deps)
    await runtime.ensureReady('C:\\Fixture')
    await writeFile(join(options.storageDirectory, 'clients', '9999'), '')
    await runtime.ensureReady('D:\\Other')
    expect(
      JSON.parse(await readFile(join(options.storageDirectory, 'roots.json'), 'utf8'))
    ).toEqual(['C:\\Fixture', 'D:\\Other'])
    expect(deps.start).toHaveBeenCalledTimes(2)
    expect(deps.run.mock.calls.every(([, args]) => args.includes(runtime.endpoint.instance))).toBe(
      true
    )
    await runtime.dispose()
    expect(runtime.status()).toBe('stopped')
    expect(await runtime.ensureReady()).toBeNull()
  })

  it('returns unavailable when bundled files are missing without discovering another installation', async () => {
    const { options, deps } = await setup()
    await rm(join(options.binaryDirectory, 'Everything.exe'))
    const runtime = createIndexerRuntime(options, deps)
    expect(await runtime.ensureReady()).toBeNull()
    expect(deps.start).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
    expect(runtime.status()).toBe('unavailable')
  })

  it('is not blocked by abandoned lock files from a crashed process', async () => {
    const { options, deps } = await setup()
    await mkdir(options.storageDirectory)
    await writeFile(join(options.storageDirectory, 'lifecycle.lock'), '')
    const runtime = createIndexerRuntime(options, deps)
    expect(await runtime.ensureReady('C:\\Fixture')).not.toBeNull()
    await runtime.dispose()
  })

  it('reuses a live private engine while IPC times out and exits only that instance', async () => {
    const { options, deps } = await setup()
    await mkdir(options.storageDirectory)
    await writeFile(join(options.storageDirectory, 'roots.json'), JSON.stringify(['C:\\Fixture']))
    await writeFile(join(options.storageDirectory, 'engine-pid'), '303')
    let engineAlive = true
    deps.alive.mockImplementation((pid) => pid === 101 || (pid === 303 && engineAlive))
    deps.run.mockImplementation(async (_exe, args) => {
      if (args.includes('-exit')) {
        engineAlive = false
        return ''
      }
      throw Object.assign(new Error('Initial index still busy'), { killed: true })
    })
    const runtime = createIndexerRuntime(options, deps)
    expect(await runtime.ensureReady('C:\\Fixture\\nested')).toEqual(runtime.endpoint)
    expect(runtime.status()).toBe('ready')
    expect(deps.start).not.toHaveBeenCalled()
    await runtime.dispose()
    expect(deps.run.mock.calls.filter(([, args]) => args.includes('-exit'))).toEqual([
      [
        join(options.binaryDirectory, 'Everything.exe'),
        ['-instance', runtime.endpoint.instance, '-exit']
      ]
    ])
    expect(deps.run.mock.calls.every(([, args]) => args.includes(runtime.endpoint.instance))).toBe(
      true
    )
    expect(engineAlive).toBe(false)
    expect(runtime.status()).toBe('stopped')
    await expect(readFile(join(options.storageDirectory, 'engine-pid'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('uses only its owned service pipe and avoids folder-scanning native indexed volumes', async () => {
    const { options, deps } = await setup()
    const original = deps.run.getMockImplementation()!
    deps.run.mockImplementation(async (exe, args) =>
      exe === 'powershell.exe' ? 'C:\\\r\nD:\\\r\n' : original(exe, args)
    )
    const serviceAvailable = vi.fn(async () => true)
    const runtime = createIndexerRuntime(
      { ...options, allowService: true, serviceInstance: 'Prism-install123' },
      { ...deps, serviceAvailable }
    )
    await runtime.ensureReady('C:\\Fixture')
    const ini = await readFile(join(options.storageDirectory, 'Everything.ini'), 'utf8')
    expect(serviceAvailable).toHaveBeenCalledWith('\\\\.\\PIPE\\Prism Search install123')
    expect(ini).toContain('auto_include_fixed_volumes=1')
    expect(ini).toContain('folders=\r\n')
    await runtime.ensureReady('D:\\Other')
    expect(deps.start).toHaveBeenCalledTimes(1)
    await runtime.dispose()
  })
})
