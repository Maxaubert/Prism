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

  it('shares one failed startup attempt across concurrent callers without recursive retry chains', async () => {
    const { options, deps } = await setup()
    deps.start.mockRejectedValue(new Error('Engine cannot start'))
    const runtime = createIndexerRuntime(options, deps)
    expect(
      await Promise.all(
        Array.from({ length: 12 }, (_, index) => runtime.ensureReady(`C:\\Fixture${index}`))
      )
    ).toEqual(Array(12).fill(null))
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(await runtime.ensureReady('C:\\Fixture')).toBeNull()
    expect(deps.start).toHaveBeenCalledTimes(1)
    await runtime.dispose()
  })

  it('coalesces locations visited during rootless startup into a successful follow-up', async () => {
    const { options, deps } = await setup()
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>((done) => {
      release = done
    })
    const probing = new Promise<void>((done) => {
      entered = done
    })
    const run = deps.run.getMockImplementation()!
    deps.run.mockImplementationOnce(async (exe, args) => {
      entered()
      await blocked
      return run(exe, args)
    })
    const runtime = createIndexerRuntime(options, deps)
    const startup = runtime.ensureReady()
    await probing
    const first = runtime.ensureReady('C:\\Fixture')
    const nested = runtime.ensureReady('C:\\Fixture\\nested')
    const other = runtime.ensureReady('D:\\Other')
    release()
    expect(await Promise.all([startup, first, nested, other])).toEqual(
      Array(4).fill(runtime.endpoint)
    )
    expect(
      JSON.parse(await readFile(join(options.storageDirectory, 'roots.json'), 'utf8'))
    ).toEqual(['C:\\Fixture', 'D:\\Other'])
    expect(deps.start).toHaveBeenCalledTimes(2)
    expect(await runtime.queryEndpoint('D:\\Other')).toEqual(runtime.endpoint)
    expect(deps.start).toHaveBeenCalledTimes(2)
    await runtime.dispose()
  })

  it('enforces a fixture boundary through direct startup and the query closure', async () => {
    const { options, deps } = await setup()
    const serviceAvailable = vi.fn(async () => true)
    const runtime = createIndexerRuntime(
      {
        ...options,
        allowedRoot: 'C:\\Fixture',
        initialRoots: ['C:\\Users', 'C:\\Fixture\\initial'],
        allowService: true,
        serviceInstance: 'Prism-install123'
      },
      { ...deps, serviceAvailable }
    )
    expect(await runtime.ensureReady('C:\\Users')).toBeNull()
    expect(await runtime.queryEndpoint('C:\\Fixture-other')).toBeNull()
    expect(deps.start).not.toHaveBeenCalled()
    expect(await runtime.queryEndpoint('C:\\Fixture\\nested')).toEqual(runtime.endpoint)
    expect(serviceAvailable).not.toHaveBeenCalled()
    expect(
      JSON.parse(await readFile(join(options.storageDirectory, 'roots.json'), 'utf8'))
    ).toEqual(['C:\\Fixture\\initial', 'C:\\Fixture\\nested'])
    expect(await runtime.queryEndpoint('D:\\Other')).toBeNull()
    await runtime.dispose()
  })

  it('reconciles an already running broader index before reusing a bounded profile', async () => {
    const { options, deps } = await setup()
    const savedRoots = ['C:\\Users', 'C:\\Fixture']
    await mkdir(options.storageDirectory)
    await writeFile(join(options.storageDirectory, 'roots.json'), JSON.stringify(savedRoots))
    await writeFile(join(options.storageDirectory, 'Everything.ini'), indexerConfig(savedRoots))
    await deps.start()
    deps.start.mockClear()
    const runtime = createIndexerRuntime({ ...options, allowedRoot: 'C:\\Fixture' }, deps)
    expect(await runtime.ensureReady()).toEqual(runtime.endpoint)
    expect(deps.run.mock.calls.filter(([, args]) => args.includes('-exit'))).toHaveLength(1)
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(await readFile(join(options.storageDirectory, 'roots.json'), 'utf8'))
    ).toEqual(['C:\\Fixture'])
    expect(await readFile(join(options.storageDirectory, 'Everything.ini'), 'utf8')).toBe(
      indexerConfig(['C:\\Fixture'])
    )
    expect(await runtime.queryEndpoint('C:\\Users')).toBeNull()
    await runtime.dispose()
  })

  it('bounds a query wait while shared preparation continues and observes cancellation immediately', async () => {
    const { options, deps } = await setup()
    let release!: () => void
    const blocked = new Promise<void>((done) => {
      release = done
    })
    const run = deps.run.getMockImplementation()!
    deps.run.mockImplementation(async (exe, args) => {
      await blocked
      return run(exe, args)
    })
    const runtime = createIndexerRuntime(options, deps)
    const first = runtime.queryEndpoint('C:\\Fixture')
    const controller = new AbortController()
    const cancelled = runtime.queryEndpoint('C:\\Fixture', controller.signal)
    controller.abort()
    expect(await cancelled).toBeNull()
    expect(await first).toBeNull()
    expect(deps.start).not.toHaveBeenCalled()
    release()
    expect(await runtime.ensureReady('C:\\Fixture')).toEqual(runtime.endpoint)
    expect(deps.start).toHaveBeenCalledTimes(1)
    expect(await runtime.queryEndpoint('C:\\Fixture')).toEqual(runtime.endpoint)
    await runtime.dispose()
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
