import { execFile, spawn } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { access, mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { createConnection, createServer, type Server } from 'net'

export interface IndexerOptions {
  binaryDirectory: string
  storageDirectory: string
  allowService?: boolean
  serviceInstance?: string
  initialRoots?: string[]
}

export interface IndexerEndpoint {
  exe: string
  instance: string
}

interface RuntimeDependencies {
  run(exe: string, args: string[]): Promise<string>
  start(exe: string, args: string[]): Promise<number | void>
  alive(pid: number): boolean
  pid: number
  serviceAvailable?(pipe: string): Promise<boolean>
}

function serviceAvailable(pipe: string): Promise<boolean> {
  return new Promise((done) => {
    const socket = createConnection(pipe)
    const finish = (available: boolean): void => {
      socket.destroy()
      done(available)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(250, () => finish(false))
  })
}

const defaults: RuntimeDependencies = {
  run: (exe, args) =>
    new Promise((done, fail) => {
      execFile(exe, args, { windowsHide: true, timeout: 2000 }, (error, out) =>
        error ? fail(error) : done(out)
      )
    }),
  start: (exe, args) =>
    new Promise((done, fail) => {
      const child = spawn(exe, args, { windowsHide: true, detached: true, stdio: 'ignore' })
      child.once('error', fail)
      child.once('spawn', () => {
        child.unref()
        done(child.pid)
      })
    }),
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  pid: process.pid
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const key = (path: string): string =>
  resolve(path)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
const contains = (parent: string, child: string): boolean =>
  key(parent) === key(child) || key(child).startsWith(key(parent) + sep)

/** Stable per owner profile; extra Explorer windows share it, previews do not. */
export function indexerInstance(storageDirectory: string): string {
  return 'Prism-' + createHash('sha256').update(key(storageDirectory)).digest('hex').slice(0, 16)
}

export function mergeIndexRoots(
  existing: readonly string[],
  additions: readonly string[]
): string[] {
  const roots = [...existing]
  for (const root of additions) {
    if (/[\r\n\0]/.test(root) || roots.some((parent) => contains(parent, root))) continue
    for (let i = roots.length - 1; i >= 0; i--) if (contains(root, roots[i])) roots.splice(i, 1)
    roots.push(resolve(root))
  }
  return roots
}

/** Everything's quoted INI lists escape backslashes as well as commas. */
export function indexerConfig(roots: readonly string[], servicePipe?: string): string {
  const values: Record<string, string | number> = {
    app_data: 0,
    run_as_admin: 0,
    run_in_background: 1,
    show_tray_icon: 0,
    check_for_updates_on_startup: 0,
    show_indexing_progress: 0,
    index_size: 1,
    index_folder_size: 1,
    index_date_modified: 1,
    index_attributes: 1,
    exclude_hidden_files_and_folders: 0,
    exclude_system_files_and_folders: 0,
    exclude_files: '',
    exclude_folders: '',
    include_only_files: '',
    etp_server_enabled: 0,
    http_server_enabled: 0,
    search_history_enabled: 0,
    run_history_enabled: 0,
    auto_include_fixed_volumes: servicePipe ? 1 : 0,
    auto_include_removable_volumes: servicePipe ? 1 : 0,
    auto_include_fixed_refs_volumes: servicePipe ? 1 : 0,
    auto_include_removable_refs_volumes: servicePipe ? 1 : 0,
    service_pipe_name: servicePipe ?? '\\\\.\\pipe\\Prism-No-Service',
    folders: roots
      .map((root) => '"' + root.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')
      .join(','),
    folder_monitor_changes: roots.map(() => '1').join(','),
    folder_update_types: roots.map(() => '1').join(','),
    folder_update_intervals: roots.map(() => '15').join(','),
    folder_update_interval_types: roots.map(() => '0').join(','),
    folder_rescan_if_full_list: roots.map(() => '1').join(',')
  }
  return (
    '[Everything]\r\n' +
    Object.entries(values)
      .map(([name, value]) => `${name}=${value}\r\n`)
      .join('')
  )
}

export function createIndexerRuntime(
  options: IndexerOptions,
  deps: RuntimeDependencies = defaults
) {
  const directory = resolve(options.storageDirectory)
  const instance = indexerInstance(directory)
  const engine = join(options.binaryDirectory, 'Everything.exe')
  const endpoint: IndexerEndpoint = { exe: join(options.binaryDirectory, 'es.exe'), instance }
  const config = join(directory, 'Everything.ini')
  const rootFile = join(directory, 'roots.json')
  const processFile = join(directory, 'engine-pid')
  // The kernel releases this mutex on process death. Unlike lock files there is
  // no empty-file crash window or race reclaiming another window's stale lock.
  const lockName =
    process.platform === 'win32' ? `\\\\.\\pipe\\${instance}-lifecycle` : `\0${instance}-lifecycle`
  const leases = join(directory, 'clients')
  const lease = join(leases, `${deps.pid}.${randomUUID()}`)
  let disposed = false
  let readyUntil = 0
  let knownRoots: string[] = []
  let pending: Promise<IndexerEndpoint | null> | undefined
  let state: 'starting' | 'ready' | 'unavailable' | 'stopped' = 'starting'

  async function locked<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(directory, { recursive: true })
    const deadline = Date.now() + 8000
    let lock: Server
    while (true) {
      try {
        lock = await new Promise<Server>((done, fail) => {
          const server = createServer((socket) => socket.destroy())
          server.once('error', fail)
          server.listen(lockName, () => done(server))
        })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
        if (Date.now() > deadline) throw new Error('Indexer lifecycle busy', { cause: error })
        await pause(40)
      }
    }
    try {
      return await action()
    } finally {
      await new Promise<void>((done) => lock.close(() => done()))
    }
  }

  async function running(): Promise<boolean> {
    try {
      return /^1\./.test(
        await deps.run(endpoint.exe, ['-instance', instance, '-get-everything-version'])
      )
    } catch (error) {
      // ES can time out while a first folder index is being built. Do not start
      // competing engines, but never trust a reused PID after IPC says absent.
      const timeout =
        (error as { killed?: boolean; code?: string }).killed ||
        (error as { code?: string }).code === 'ETIMEDOUT'
      const pid = Number(await readFile(processFile, 'utf8').catch(() => '0'))
      return !!timeout && pid > 0 && deps.alive(pid)
    }
  }

  async function stop(): Promise<void> {
    await deps.run(engine, ['-instance', instance, '-exit']).catch(() => {})
    const deadline = Date.now() + 4000
    while (await running()) {
      if (Date.now() > deadline) throw new Error('Indexer still shutting down')
      await pause(50)
    }
    await unlink(processFile).catch(() => {})
  }

  async function prepare(root?: string): Promise<IndexerEndpoint | null> {
    try {
      await Promise.all([access(engine), access(endpoint.exe)])
      return await locked(async () => {
        if (disposed) return null
        await mkdir(leases, { recursive: true })
        await writeFile(lease, '')
        const saved = await readFile(rootFile, 'utf8')
          .then((data) => JSON.parse(data) as string[])
          .catch(() => [])
        const previous = Array.isArray(saved) ? saved.filter((s) => typeof s === 'string') : []
        const requested = [...(options.initialRoots ?? []), ...(root ? [root] : [])]
        if (
          requested.every((path) => previous.some((parent) => contains(parent, path))) &&
          (await running())
        ) {
          knownRoots = previous
          readyUntil = Date.now() + 5000
          state = 'ready'
          return endpoint
        }
        let pipe: string | undefined
        let volumes: string[] = []
        if (options.allowService && options.serviceInstance) {
          const candidate = `\\\\.\\PIPE\\Prism Search ${options.serviceInstance.replace(/^Prism-/, '')}`
          if (await (deps.serviceAvailable ?? serviceAvailable)(candidate)) {
            pipe = candidate
            const output = await deps
              .run('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-CimInstance Win32_LogicalDisk | Where-Object { $_.FileSystem -in @("NTFS", "ReFS") } | ForEach-Object { $_.DeviceID + "\\" }'
              ])
              .catch(() => '')
            volumes = output
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter((s) => /^[a-z]:\\$/i.test(s))
          }
        }
        const roots = mergeIndexRoots(previous, [...volumes, ...requested])
        const changed = JSON.stringify(saved) !== JSON.stringify(roots)
        let alive = await running()
        if (alive && changed) {
          await stop()
          alive = false
        }
        if (!alive) {
          await writeFile(rootFile, JSON.stringify(roots))
          // Do not folder-scan NTFS drives already covered by the fast service.
          // UNC paths and non-NTFS volumes still get persistent folder indexes.
          await writeFile(
            config,
            indexerConfig(
              roots.filter((path) => !volumes.some((volume) => contains(volume, path))),
              pipe
            )
          )
          const pid = await deps.start(engine, [
            '-instance',
            instance,
            '-config',
            config,
            '-db',
            join(directory, 'Everything.db'),
            '-startup'
          ])
          if (pid) await writeFile(processFile, String(pid))
          const deadline = Date.now() + 3000
          while (!(await running())) {
            if (disposed || Date.now() > deadline) throw new Error('Indexer not ready')
            await pause(75)
          }
        }
        knownRoots = roots
        readyUntil = Date.now() + 5000
        state = 'ready'
        return endpoint
      })
    } catch {
      state = disposed ? 'stopped' : 'unavailable'
      return null
    }
  }

  async function ensureReady(root?: string): Promise<IndexerEndpoint | null> {
    if (disposed) return null
    if (readyUntil > Date.now() && (!root || knownRoots.some((parent) => contains(parent, root))))
      return endpoint
    if (pending) {
      await pending
      return ensureReady(root)
    }
    pending = prepare(root)
    try {
      return await pending
    } finally {
      pending = undefined
    }
  }

  async function dispose(): Promise<void> {
    disposed = true
    await pending
    await locked(async () => {
      await unlink(lease).catch(() => {})
      const clients = await readdir(leases).catch(() => [])
      for (const client of clients) {
        if (deps.alive(Number(client.split('.')[0]))) return
        await unlink(join(leases, client)).catch(() => {})
      }
      // Exit targets the private instance even while its initial scan is too
      // busy to answer ES IPC; otherwise a warm-up could outlive the last app.
      await stop()
    }).catch(() => {})
    state = 'stopped'
  }

  return { ensureReady, dispose, status: () => state, endpoint }
}

export type IndexerRuntime = ReturnType<typeof createIndexerRuntime>
let runtime: IndexerRuntime | undefined
export function initializeIndexerRuntime(options: IndexerOptions): IndexerRuntime {
  runtime = createIndexerRuntime(options)
  return runtime
}
export function managedIndexerRuntime(): IndexerRuntime | undefined {
  return runtime
}
