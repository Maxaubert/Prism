import { spawn, type ChildProcess } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, describe, expect, it } from 'vitest'
import type { DictationEngine, TranscribeRequest, TranscribeResult } from '../shared/dictationTypes'
import { createDictationEngine, type DictationEngineDeps } from './dictationEngine'

/**
 * The resident server's lifecycle, against a REAL child process and a REAL
 * local HTTP server: the fixture is a Node script that speaks whisper-server's
 * two routes and answers with what it received. Nothing is mocked, because
 * every rule here is about processes and sockets (who is alive, who was
 * killed, what went over the wire), and a mock of `spawn` would only prove
 * the engine agrees with the mock.
 */

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'fakeWhisperServer.mjs')
const PARAKEET_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'fakeParakeetCli.mjs')
const MODELS: Record<string, string> = {
  base: 'C:\\Prism Dictation\\models\\ggml-base.bin',
  small: 'C:\\Prism Dictation\\models\\ggml-small.bin',
  pk: 'C:\\Prism Dictation\\models\\parakeet-v3.bin'
}
const WAV = new Uint8Array(1234).fill(7)

/** What the fixture says it saw, read back out of the `text` it answered with. */
interface Seen {
  n: number
  maxActive: number
  bytes: number
  filename: string | null
  type: string | null
  format: string | null
  model: string | null
  language: string | null
  host: string
  port: number
  pid: number
  cwd: string
  cudaCache: string | null
  cudaMax: string | null
}

interface World {
  engine: DictationEngine
  cpuDir: string
  gpuDir: string
  /** Everything the engine launched, in order: which engine folder, and its argv. */
  launched: Array<{ kind: 'cpu' | 'gpu'; exePath: string; args: string[] }>
  children: ChildProcess[]
  set: (next: Partial<Knobs>) => void
}

interface Knobs {
  cpu: boolean
  gpu: boolean
  nvidia: boolean | 'throws'
  cpuFlags: string[]
  gpuFlags: string[]
}

const engines: DictationEngine[] = []
const allChildren: ChildProcess[] = []
const folders: string[] = []

function world(knobs: Partial<Knobs> = {}, deps: Partial<DictationEngineDeps> = {}): World {
  const k: Knobs = { cpu: true, gpu: false, nvidia: false, cpuFlags: [], gpuFlags: [], ...knobs }
  // A space in the folder on purpose: the real one is under a user's profile.
  const cpuDir = mkdtempSync(join(tmpdir(), 'prism dictation cpu '))
  const gpuDir = mkdtempSync(join(tmpdir(), 'prism dictation gpu '))
  folders.push(cpuDir, gpuDir)
  const launched: World['launched'] = []
  const children: ChildProcess[] = []
  const engine = createDictationEngine({
    cpuDir: () => (k.cpu ? cpuDir : null),
    store: { modelPath: (id) => MODELS[id] ?? null, gpuEngineDir: () => (k.gpu ? gpuDir : null) },
    hasNvidia: async () => {
      if (k.nvidia === 'throws') throw new Error('no gpu info')
      return k.nvidia
    },
    spawnImpl: ((file: string, args: string[], options: object) => {
      const child = spawn(file, args, options)
      children.push(child)
      allChildren.push(child)
      return child
    }) as typeof spawn,
    // The "exe" is the fixture script, run by this very Node. The engine's own
    // argv is kept in front, so the fixture is started the way the real one is.
    command: (exePath, args) => {
      const kind = exePath.startsWith(gpuDir) ? 'gpu' : 'cpu'
      launched.push({ kind, exePath, args })
      const fixture = exePath.endsWith('parakeet-cli.exe') ? PARAKEET_FIXTURE : FIXTURE
      return { file: process.execPath, args: [fixture, ...args, ...(kind === 'gpu' ? k.gpuFlags : k.cpuFlags)] }
    },
    // 'pk' stands for a Parakeet model; the rest are Whisper's.
    engineFor: (id) => (id === 'pk' ? 'parakeet' : 'whisper'),
    threads: 6,
    ...deps
  })
  engines.push(engine)
  return { engine, cpuDir, gpuDir, launched, children, set: (next) => Object.assign(k, next) }
}

const req = (over: Partial<TranscribeRequest> = {}): TranscribeRequest => ({
  wav: WAV,
  modelId: 'base',
  language: 'auto',
  final: true,
  ...over
})

function seen(r: TranscribeResult): Seen {
  if (!r.ok) throw new Error(`expected an answer, got ${r.reason}: ${r.detail ?? ''}`)
  return JSON.parse(r.text) as Seen
}

const gone = (c: ChildProcess): boolean => c.exitCode !== null || c.signalCode !== null
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until(what: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms
  while (!what()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await sleep(10)
  }
}

afterEach(async () => {
  for (const e of engines.splice(0)) e.stop()
  // No test may leave a process behind: every child ever launched must be gone.
  await until(() => allChildren.every(gone))
  allChildren.splice(0)
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})

describe('what can answer', () => {
  it('says no-model for a model that is not installed, and starts nothing', async () => {
    const w = world()
    expect(await w.engine.transcribe(req({ modelId: 'large' }))).toEqual({ ok: false, reason: 'no-model' })
    expect(w.launched).toHaveLength(0)
  })

  it('says no-engine when there is neither a bundled engine nor a usable GPU pack', async () => {
    const none = world({ cpu: false })
    expect(await none.engine.transcribe(req())).toEqual({ ok: false, reason: 'no-engine' })
    // A GPU pack without an NVIDIA adapter is not an engine either.
    const packOnly = world({ cpu: false, gpu: true, nvidia: false })
    expect(await packOnly.engine.transcribe(req())).toEqual({ ok: false, reason: 'no-engine' })
    expect(packOnly.launched).toHaveLength(0)
  })

  it('takes the GPU pack when it is installed AND an NVIDIA adapter is present', async () => {
    const w = world({ gpu: true, nvidia: true })
    const r = await w.engine.transcribe(req())
    expect(r.ok && r.engine).toBe('gpu')
    expect(seen(r).cwd).toBe(w.gpuDir)
    expect(w.engine.info()).toEqual({ running: true, engine: 'gpu', gpuFellBack: false })
  })

  it('stays on CPU with the pack installed and no NVIDIA adapter, or an adapter nobody could ask about', async () => {
    const w = world({ gpu: true, nvidia: false })
    const r = await w.engine.transcribe(req())
    expect(r.ok && r.engine).toBe('cpu')
    const t = world({ gpu: true, nvidia: 'throws' })
    const r2 = await t.engine.transcribe(req())
    expect(r2.ok && r2.engine).toBe('cpu')
    expect(t.engine.info().gpuFellBack).toBe(false)
  })
})

describe('the server', () => {
  it('is not started until the first transcribe, and is started the way the real one is', async () => {
    const w = world()
    expect(w.engine.info()).toEqual({ running: false, engine: null, gpuFellBack: false })
    expect(w.launched).toHaveLength(0)

    const s = seen(await w.engine.transcribe(req({ language: 'nb' })))
    expect(w.launched).toHaveLength(1)
    const { exePath, args } = w.launched[0]
    expect(exePath).toBe(join(w.cpuDir, 'whisper-server.exe'))
    expect(args).toEqual(['-m', MODELS.base, '--host', '127.0.0.1', '--port', String(s.port), '-l', 'nb'])
    expect(s.port).toBeGreaterThan(0)
    // Its DLLs are beside it, so it runs IN its own folder.
    expect(s.cwd).toBe(w.cpuDir)
    expect(w.engine.info()).toEqual({ running: true, engine: 'cpu', gpuFellBack: false })
  })

  it('is sent the wav as multipart form-data and asked for json', async () => {
    const w = world()
    const r = await w.engine.transcribe(req())
    const s = seen(r)
    expect(s).toMatchObject({
      bytes: WAV.length,
      filename: 'audio.wav',
      type: 'audio/wav',
      format: 'json',
      model: MODELS.base,
      language: 'auto'
    })
    expect(r.ok && r.engine).toBe('cpu')
  })

  it('is reused from one pass to the next', async () => {
    const w = world()
    await w.engine.warm({ modelId: 'base', language: 'auto' })
    const a = seen(await w.engine.transcribe(req({ final: false })))
    const b = seen(await w.engine.transcribe(req()))
    expect(b.pid).toBe(a.pid)
    expect(b.n).toBe(3)
    expect(w.launched).toHaveLength(1)
  })

  it('is replaced when the model, the language or the engine kind changes', async () => {
    const w = world({ nvidia: true })
    const first = seen(await w.engine.transcribe(req()))
    const model = seen(await w.engine.transcribe(req({ modelId: 'small' })))
    expect(model.pid).not.toBe(first.pid)
    expect(model.model).toBe(MODELS.small)
    const lang = seen(await w.engine.transcribe(req({ modelId: 'small', language: 'en' })))
    expect(lang.pid).not.toBe(model.pid)
    expect(lang.language).toBe('en')
    // The GPU pack finishes downloading mid-session: the next pass moves to it.
    w.set({ gpu: true })
    const kind = await w.engine.transcribe(req({ modelId: 'small', language: 'en' }))
    expect(kind.ok && kind.engine).toBe('gpu')
    expect(seen(kind).pid).not.toBe(lang.pid)
    expect(w.launched.map((l) => l.kind)).toEqual(['cpu', 'cpu', 'cpu', 'gpu'])
    // One server at a time: the three it replaced are gone.
    await until(() => w.children.slice(0, 3).every(gone))
    expect(gone(w.children[3])).toBe(false)
  })
})

describe('a GPU engine that will not start', () => {
  it('falls back to CPU for the life of the engine when it exits at start, and answers from there', async () => {
    const w = world({ gpu: true, nvidia: true, gpuFlags: ['--fake-exit'] })
    const r = await w.engine.transcribe(req())
    expect(r.ok && r.engine).toBe('cpu')
    expect(w.engine.info()).toEqual({ running: true, engine: 'cpu', gpuFellBack: true })
    // Never again this session: the second pass does not even try it.
    const again = await w.engine.transcribe(req())
    expect(again.ok && again.engine).toBe('cpu')
    expect(w.launched.map((l) => l.kind)).toEqual(['gpu', 'cpu'])
  })

  it('falls back the same way when it never becomes ready, and the stuck one is killed', async () => {
    const w = world({ gpu: true, nvidia: true, gpuFlags: ['--fake-never-ready'] }, { startTimeoutMs: 400 })
    const r = await w.engine.transcribe(req())
    expect(r.ok && r.engine).toBe('cpu')
    expect(w.engine.info().gpuFellBack).toBe(true)
    await until(() => gone(w.children[0]))
  })

  it('is a failure, not a loop, when there is no CPU engine to fall back to', async () => {
    const w = world({ cpu: false, gpu: true, nvidia: true, gpuFlags: ['--fake-exit'] })
    const r = await w.engine.transcribe(req())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(!r.ok && r.detail).toContain('CUDA error')
    expect(w.launched).toHaveLength(1)
    // The GPU engine is out for the session, so now nothing is left at all.
    expect(await w.engine.transcribe(req())).toEqual({ ok: false, reason: 'no-engine' })
    expect(w.launched).toHaveLength(1)
  })
})

describe('a CPU engine that will not start', () => {
  it('fails that request with what the server said, once, and tries afresh on the next', async () => {
    const w = world({ cpuFlags: ['--fake-exit'] })
    const r = await w.engine.transcribe(req())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(!r.ok && r.detail).toContain('fake: CUDA error')
    expect(w.launched).toHaveLength(1)
    expect(w.engine.info().running).toBe(false)

    w.set({ cpuFlags: [] })
    expect((await w.engine.transcribe(req())).ok).toBe(true)
    expect(w.launched).toHaveLength(2)
  })

  it('fails when the exe cannot be launched at all', async () => {
    const w = world({}, { command: () => ({ file: join(tmpdir(), 'no such whisper-server.exe'), args: [] }) })
    const r = await w.engine.transcribe(req())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
  })
})

describe('passes are serialised to one in flight', () => {
  it('drops a waiting partial for a newer one, and never sends two at once', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '120'] })
    await w.engine.warm({ modelId: 'base', language: 'auto' })
    const a = w.engine.transcribe(req({ final: false }))
    const b = w.engine.transcribe(req({ final: false }))
    const c = w.engine.transcribe(req({ final: false }))
    // b never reaches the server: it answers as soon as c takes its place.
    expect(await b).toEqual({ ok: false, reason: 'superseded' })
    expect(seen(await a).n).toBe(2)
    const last = seen(await c)
    expect(last.n).toBe(3)
    expect(last.maxActive).toBe(1)
  })

  it('never drops a final, and lets it jump ahead of a waiting partial', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '120'] })
    await w.engine.warm({ modelId: 'base', language: 'auto' })
    const inFlight = w.engine.transcribe(req({ final: false }))
    const waiting = w.engine.transcribe(req({ final: false }))
    const final1 = w.engine.transcribe(req({ final: true }))
    // The next recording has begun before the last one's final was answered.
    const nextPartial = w.engine.transcribe(req({ final: false }))
    const final2 = w.engine.transcribe(req({ final: true }))
    const newest = w.engine.transcribe(req({ final: false }))

    // A partial waiting when a final arrives is for a clip the final covers whole.
    expect(await waiting).toEqual({ ok: false, reason: 'superseded' })
    expect(await nextPartial).toEqual({ ok: false, reason: 'superseded' })
    expect(seen(await inFlight).n).toBe(2)
    expect(seen(await final1).n).toBe(3)
    expect(seen(await final2).n).toBe(4)
    const end = seen(await newest)
    expect(end.n).toBe(5)
    expect(end.maxActive).toBe(1)
  })
})

// THE ENGINE IS WARM BEFORE ANYBODY SPEAKS (2026-09-28; MEASURED on an RTX
// 5090: the first pass of a cold GPU engine compiled kernels for 31.8 s, and
// the partials queued behind it showed nothing for as long).
describe('warming up', () => {
  it('answers a partial on a cold engine at once with warming, and warms it', async () => {
    const w = world()
    expect(await w.engine.transcribe(req({ final: false }))).toEqual({ ok: false, reason: 'warming' })
    await until(() => w.engine.info().running)
    // The warm-up pass lands; the next partial is served by the same server.
    await until(() => w.launched.length === 1)
    let served: TranscribeResult | null = null
    await until(() => {
      void w.engine.transcribe(req({ final: false })).then((r) => (served = r))
      return served !== null && (served as TranscribeResult).ok
    }, 6000)
    expect(w.launched).toHaveLength(1)
  })

  it('is asked for freely: one server and one silent pass however often', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '100'] })
    const first = w.engine.warm({ modelId: 'base', language: 'auto' })
    expect(await w.engine.warm({ modelId: 'base', language: 'auto' })).toEqual({ ok: false, reason: 'warming' })
    expect((await first).ok).toBe(true)
    expect((await w.engine.warm({ modelId: 'base', language: 'auto' })).ok).toBe(true)
    // The final is the SECOND pass the server ever saw: the warm-up was the first.
    expect(seen(await w.engine.transcribe(req())).n).toBe(2)
    expect(w.launched).toHaveLength(1)
  })

  it('a final is never refused while warming: it waits for the warm server', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '100'] })
    void w.engine.warm({ modelId: 'base', language: 'auto' })
    const final = seen(await w.engine.transcribe(req()))
    expect(final.n).toBe(2)
    expect(final.maxActive).toBe(1)
  })

  it('gives the GPU engine its own kernel cache, with room, and the CPU one nothing', async () => {
    const g = world({ gpu: true, nvidia: true }, { cudaCacheDir: () => 'C:\\Prism Dictation\\cuda-cache' })
    const gpu = seen(await g.engine.transcribe(req()))
    expect(gpu.cudaCache).toBe('C:\\Prism Dictation\\cuda-cache')
    expect(Number(gpu.cudaMax)).toBeGreaterThanOrEqual(4 * 1024 * 1024 * 1024)
    const c = world({}, { cudaCacheDir: () => 'C:\\Prism Dictation\\cuda-cache' })
    expect(seen(await c.engine.transcribe(req())).cudaCache).toBeNull()
  })

  it('after a failed warm-up, a partial goes the ordinary way and says what failed', async () => {
    const w = world({ cpuFlags: ['--fake-exit'] })
    expect((await w.engine.warm({ modelId: 'base', language: 'auto' })).ok).toBe(false)
    expect(await w.engine.transcribe(req({ final: false }))).toMatchObject({ ok: false, reason: 'engine-failed' })
  })

  // Perf review 2026-10-16: each partial on a broken engine launched a server.
  it('after a server would not start, a held key starts no more servers; a final still tries', async () => {
    const w = world({ cpuFlags: ['--fake-exit'] })
    expect((await w.engine.warm({ modelId: 'base', language: 'auto' })).ok).toBe(false)
    expect(w.launched).toHaveLength(1)
    for (let i = 0; i < 4; i += 1) {
      const r = await w.engine.transcribe(req({ final: false }))
      expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
      expect(!r.ok && r.detail).toContain('fake: CUDA error')
    }
    expect(w.launched).toHaveLength(1)
    w.set({ cpuFlags: [] })
    expect((await w.engine.transcribe(req())).ok).toBe(true)
    expect(w.launched).toHaveLength(2)
  })
})

describe('standing down', () => {
  it('kills the server after idleMs with no request, and starts a fresh one on the next', async () => {
    const w = world({}, { idleMs: 150 })
    const first = seen(await w.engine.transcribe(req()))
    expect(w.engine.info().running).toBe(true)
    await until(() => gone(w.children[0]))
    expect(w.engine.info()).toEqual({ running: false, engine: 'cpu', gpuFellBack: false })

    const second = seen(await w.engine.transcribe(req()))
    expect(second.pid).not.toBe(first.pid)
    expect(w.launched).toHaveLength(2)
  })

  // Prism Terminal's dictation service (owner, 2026-10-17: "It needs to be
  // ready at all times"): Infinity never stands down; stop() still ends it.
  it('never stands down with an idleMs of Infinity', async () => {
    const w = world({}, { idleMs: Infinity })
    await w.engine.transcribe(req())
    await sleep(300)
    expect(w.engine.info().running).toBe(true)
    w.engine.stop()
    await until(() => gone(w.children[0]))
  })

  it('counts the idle time from the LAST request, not the first', async () => {
    const w = world({}, { idleMs: 500 })
    await w.engine.transcribe(req())
    await sleep(300)
    await w.engine.transcribe(req())
    await sleep(300)
    // 600 ms since the first pass, 300 since the second: still up.
    expect(w.engine.info().running).toBe(true)
    expect(w.launched).toHaveLength(1)
    await until(() => gone(w.children[0]))
  })

  it('does not stand down under a pass that takes longer than idleMs', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '250'] }, { idleMs: 60 })
    expect((await w.engine.transcribe(req())).ok).toBe(true)
  })
})

describe('stop()', () => {
  it('kills the server at once and fails what was in flight and what was waiting', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '2000'] })
    await w.engine.warm({ modelId: 'base', language: 'auto' })
    const inFlight = w.engine.transcribe(req({ final: true }))
    const waitingFinal = w.engine.transcribe(req({ final: true }))
    const waitingPartial = w.engine.transcribe(req({ final: false }))
    // Long enough for the server to be holding the first pass.
    await sleep(250)
    w.engine.stop()
    expect(w.engine.info().running).toBe(false)
    for (const p of [inFlight, waitingFinal, waitingPartial]) {
      expect(await p).toMatchObject({ ok: false, reason: 'engine-failed' })
    }
    await until(() => gone(w.children[0]))
  })

  it('leaves the engine usable: switched back on, the next pass starts a server', async () => {
    const w = world()
    const first = seen(await w.engine.transcribe(req()))
    w.engine.stop()
    const second = seen(await w.engine.transcribe(req()))
    expect(second.pid).not.toBe(first.pid)
  })

  it('during a GPU start is a stop, not a failed GPU: no fallback, no CPU server', async () => {
    const w = world({ gpu: true, nvidia: true, gpuFlags: ['--fake-never-ready'] }, { startTimeoutMs: 5000 })
    const p = w.engine.transcribe(req())
    await until(() => w.children.length === 1)
    w.engine.stop()
    expect(await p).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(w.engine.info()).toEqual({ running: false, engine: null, gpuFellBack: false })
    expect(w.launched.map((l) => l.kind)).toEqual(['gpu'])
  })
})

describe('a server that dies mid-request', () => {
  it('fails that request with the tail of its stderr, and the next one gets a fresh server', async () => {
    const w = world({ cpuFlags: ['--fake-die-on-inference'] })
    const r = await w.engine.transcribe(req())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(!r.ok && r.detail).toContain('out of memory')
    expect(w.engine.info().running).toBe(false)

    w.set({ cpuFlags: [] })
    const next = await w.engine.transcribe(req())
    expect(next.ok).toBe(true)
    expect(w.launched).toHaveLength(2)
  })

  it('counts against a GPU engine too: the next pass goes to the CPU one', async () => {
    const w = world({ gpu: true, nvidia: true, gpuFlags: ['--fake-die-on-inference'] })
    expect(await w.engine.transcribe(req())).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(w.engine.info().gpuFellBack).toBe(true)
    const next = await w.engine.transcribe(req())
    expect(next.ok && next.engine).toBe('cpu')
    expect(w.launched.map((l) => l.kind)).toEqual(['gpu', 'cpu'])
  })

  it('does not take the requests waiting behind it down with it', async () => {
    const w = world({ cpuFlags: ['--fake-die-on-inference'] })
    const dies = w.engine.transcribe(req())
    const waits = w.engine.transcribe(req())
    await until(() => w.children.length === 1)
    w.set({ cpuFlags: [] })
    expect((await dies).ok).toBe(false)
    expect((await waits).ok).toBe(true)
  })
})

// PARAKEET (#121): one parakeet-cli per pass, the WAV on its stdin.
interface PkSeen {
  bytes: number
  model: string
  file: string
  noPrints: boolean
  threads: string
  noGpu: boolean
  pid: number
  cwd: string
  cudaCache: string | null
}
const pk = (over: Partial<TranscribeRequest> = {}): TranscribeRequest => req({ modelId: 'pk', ...over })
function pkSeen(r: TranscribeResult): PkSeen {
  if (!r.ok) throw new Error(`expected an answer, got ${r.reason}: ${r.detail ?? ''}`)
  return JSON.parse(r.text) as PkSeen
}

describe('a Parakeet model', () => {
  it('runs parakeet-cli once per pass, the wav on stdin and never a file, and no language', async () => {
    const w = world()
    const r = await w.engine.transcribe(pk({ language: 'auto' }))
    const s = pkSeen(r)
    expect(w.launched).toHaveLength(1)
    expect(w.launched[0].exePath).toBe(join(w.cpuDir, 'parakeet-cli.exe'))
    // `-f -` is stdin: the audio never touches the disk.
    expect(w.launched[0].args).toEqual(['-m', MODELS.pk, '-f', '-', '-np', '-t', '6', '-ng'])
    expect(s).toMatchObject({ bytes: WAV.length, model: MODELS.pk, file: '-', noPrints: true, noGpu: true, cwd: w.cpuDir })
    expect(r.ok && r.engine).toBe('cpu')
    // Nothing stays up between passes.
    await until(() => w.children.every(gone))
    expect(w.engine.info().running).toBe(false)
    const again = pkSeen(await w.engine.transcribe(pk()))
    expect(again.pid).not.toBe(s.pid)
    expect(w.launched).toHaveLength(2)
  })

  it('takes the text off stdout as UTF-8, CRLF trimmed', async () => {
    const w = world({ cpuFlags: ['--fake-unicode'] })
    expect(await w.engine.transcribe(pk())).toEqual({ ok: true, text: 'Grüß Gott, æøå, ¿qué tal?', engine: 'cpu' })
  })

  it('uses the GPU pack, with its kernel cache and without -ng, where a Whisper server would', async () => {
    const w = world({ gpu: true, nvidia: true }, { cudaCacheDir: () => 'C:\\Prism Dictation\\cuda-cache' })
    const r = await w.engine.transcribe(pk())
    const s = pkSeen(r)
    expect(r.ok && r.engine).toBe('gpu')
    expect(s.noGpu).toBe(false)
    expect(s.cwd).toBe(w.gpuDir)
    expect(s.cudaCache).toBe('C:\\Prism Dictation\\cuda-cache')
  })

  it('falls back to the CPU, for good, when the GPU pass fails', async () => {
    const w = world({ gpu: true, nvidia: true, gpuFlags: ['--fake-exit'] })
    const r = await w.engine.transcribe(pk())
    expect(r.ok && r.engine).toBe('cpu')
    expect(w.engine.info().gpuFellBack).toBe(true)
    expect((await w.engine.transcribe(pk())).ok).toBe(true)
    expect(w.launched.map((l) => l.kind)).toEqual(['gpu', 'cpu', 'cpu'])
  })

  it('keeps the GPU when a GPU pass only says error about the audio (exit 0)', async () => {
    const w = world({ gpu: true, nvidia: true, gpuFlags: ['--fake-error-zero'] })
    const r = await w.engine.transcribe(pk())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(w.engine.info().gpuFellBack).toBe(false)
    expect(w.launched.map((l) => l.kind)).toEqual(['gpu'])
  })

  it('fails with what it said when it exits badly, or says error with exit 0', async () => {
    const bad = world({ cpuFlags: ['--fake-exit'] })
    const r = await bad.engine.transcribe(pk())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(!r.ok && r.detail).toContain('CUDA error')
    const zero = world({ cpuFlags: ['--fake-error-zero'] })
    const z = await zero.engine.transcribe(pk())
    expect(z).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(!z.ok && z.detail).toContain('failed to read audio')
  })

  it('answers a partial before the first pass with warming, warms with a silent pass, then serves partials', async () => {
    const w = world()
    expect(await w.engine.transcribe(pk({ final: false }))).toEqual({ ok: false, reason: 'warming' })
    await until(() => w.launched.length === 1)
    let served: TranscribeResult | null = null
    await until(() => {
      void w.engine.transcribe(pk({ final: false })).then((r) => (served = r))
      return served !== null && (served as TranscribeResult).ok
    }, 6000)
    // The warm-up was a real pass of the silent wav, the 0.5 s of it.
    expect(w.launched[0].args).toContain('-ng')
  })

  it('is warmed once per model, not once per press', async () => {
    const w = world()
    expect((await w.engine.warm({ modelId: 'pk', language: 'auto' })).ok).toBe(true)
    expect((await w.engine.warm({ modelId: 'pk', language: 'no' })).ok).toBe(true)
    expect(w.launched).toHaveLength(1)
  })

  it('takes down a resident Whisper server, which holds a model nobody uses now', async () => {
    const w = world()
    await w.engine.transcribe(req())
    expect(gone(w.children[0])).toBe(false)
    await w.engine.transcribe(pk())
    await until(() => gone(w.children[0]))
    // And back on Whisper, a fresh server.
    expect((await w.engine.transcribe(req())).ok).toBe(true)
    expect(w.launched.map((l) => l.exePath.endsWith('whisper-server.exe'))).toEqual([true, false, true])
  })

  it('stop() ends a pass in flight at once, fails it and what waits, and the next arm warms again', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '3000'] })
    const inFlight = w.engine.transcribe(pk())
    const waiting = w.engine.transcribe(pk())
    await until(() => w.children.length === 1)
    await sleep(150)
    expect(w.engine.info().running).toBe(true)
    w.engine.stop()
    expect(w.engine.info().running).toBe(false)
    expect(await inFlight).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(await waiting).toMatchObject({ ok: false, reason: 'engine-failed' })
    await until(() => gone(w.children[0]), 1500)
    // Off means off: no second process was started for the waiting one.
    expect(w.launched).toHaveLength(1)
    w.set({ cpuFlags: [] })
    expect(await w.engine.transcribe(pk({ final: false }))).toEqual({ ok: false, reason: 'warming' })
  })

  it('kills a pass that never answers, and says so', async () => {
    const w = world({ cpuFlags: ['--fake-delay', '5000'] }, { requestTimeoutMs: 200 })
    const r = await w.engine.transcribe(pk())
    expect(r).toMatchObject({ ok: false, reason: 'engine-failed' })
    expect(!r.ok && r.detail).toContain('no answer')
    await until(() => gone(w.children[0]))
  })
})

// THE RESIDENT PARAKEET HOST (2026-10-17): the model kept loaded in one
// process (core/dictation-host/parakeetHost.ps1), parakeet-cli only when it
// cannot start. The stand-in speaks its protocol, run by this Node.
const HOST_FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'fakeParakeetHost.mjs')
function hostWorld(env: Record<string, string> = {}, knobs: Partial<Knobs> = {}): World & { hosts: ChildProcess[] } {
  const hosts: ChildProcess[] = []
  const w = world(knobs, {
    powershell: 'FAKE-POWERSHELL',
    parakeetHost: () => ({ script: 'parakeetHost.ps1', cache: null }),
    spawnImpl: ((file: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      let child: ChildProcess
      if (file === 'FAKE-POWERSHELL') {
        // The host's own argv after `-File <script>`.
        const rest = args.slice(args.indexOf('-File') + 2)
        child = spawn(process.execPath, [HOST_FIXTURE, ...rest], { ...options, env: { ...options.env, ...env } })
        hosts.push(child)
      } else child = spawn(file, args, options)
      allChildren.push(child)
      return child
    }) as typeof spawn
  })
  return { ...w, hosts }
}
const hostSaw = (r: TranscribeResult): { n: number; bytes: number; pid: number; gpu: boolean; model: string } => {
  if (!r.ok) throw new Error(`expected an answer, got ${r.reason}: ${r.detail ?? ''}`)
  return JSON.parse(r.text)
}

describe('the resident Parakeet host', () => {
  it('answers every pass from ONE process that keeps the model, and runs no parakeet-cli', async () => {
    const w = hostWorld()
    const a = hostSaw(await w.engine.transcribe(req({ modelId: 'pk' })))
    const b = hostSaw(await w.engine.transcribe(req({ modelId: 'pk' })))
    expect([a.n, b.n]).toEqual([1, 2])
    expect(b.pid).toBe(a.pid)
    expect(a.bytes).toBe(WAV.byteLength)
    expect(a.model).toBe(MODELS.pk)
    expect(w.launched).toHaveLength(0)
    expect(w.hosts).toHaveLength(1)
  })

  it('falls back to parakeet-cli when the host never gets ready, and does not try it again', async () => {
    const w = hostWorld({ FAKE_HOST: 'never' }, {})
    const eng = createDictationEngine({
      cpuDir: () => w.cpuDir,
      store: { modelPath: (id) => MODELS[id] ?? null, gpuEngineDir: () => null },
      hasNvidia: async () => false,
      engineFor: (id) => (id === 'pk' ? 'parakeet' : 'whisper'),
      startTimeoutMs: 300,
      powershell: 'FAKE-POWERSHELL',
      parakeetHost: () => ({ script: 'parakeetHost.ps1', cache: null }),
      spawnImpl: ((file: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
        const child =
          file === 'FAKE-POWERSHELL'
            ? spawn(process.execPath, [HOST_FIXTURE, ...args.slice(args.indexOf('-File') + 2)], { ...options, env: { ...options.env, FAKE_HOST: 'never' } })
            : spawn(file, args, options)
        if (file === 'FAKE-POWERSHELL') w.hosts.push(child)
        allChildren.push(child)
        return child
      }) as typeof spawn,
      command: (_exePath, args) => ({ file: process.execPath, args: [PARAKEET_FIXTURE, ...args] })
    })
    engines.push(eng)
    expect((await eng.transcribe(req({ modelId: 'pk' }))).ok).toBe(true)
    expect((await eng.transcribe(req({ modelId: 'pk' }))).ok).toBe(true)
    expect(w.hosts).toHaveLength(1)
    await until(() => w.hosts.every(gone))
  })

  it('is ended by stop(), and by a Whisper model taking over', async () => {
    const w = hostWorld()
    await w.engine.transcribe(req({ modelId: 'pk' }))
    expect(w.engine.info().running).toBe(true)
    w.engine.stop()
    await until(() => w.hosts.every(gone))
    await w.engine.transcribe(req({ modelId: 'pk' }))
    expect(w.hosts).toHaveLength(2)
    seen(await w.engine.transcribe(req({ modelId: 'base' })))
    await until(() => w.hosts.every(gone))
  })
})
