import { spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { request } from 'http'
import { createServer } from 'net'
import { availableParallelism } from 'os'
import { join } from 'path'
import { engineFor as catalogEngineFor } from '../shared/dictationCatalog'
import type {
  DictationEngine,
  DictationStore,
  EngineKind,
  TranscribeRequest,
  TranscribeResult
} from '../shared/dictationTypes'

/* ------------------------------------------------------------------ *
 * The resident whisper-server (#13), main side.
 *
 * WHY A SERVER AND NOT A RUN PER CLIP. Loading the model is the slow part
 * and the pass is the fast one. MEASURED 2026-09-19 on the owner's PC: a
 * resident server answers a Base pass on CPU in about 0.9 s whatever the
 * clip's length (2 s to 11 s), and Large-v3 on the NVIDIA pack in 0.36 to
 * 0.50 s, where a fresh process pays the model load every time and, on the
 * GPU, a 9.1 s kernel compile on its first run. Live text once a second is
 * only possible because the process stays up between passes.
 *
 * WHAT THE REAL SERVER SPEAKS (release b5130, measured the same day): it is
 * started as `whisper-server.exe -m <model> --host 127.0.0.1 --port <n>
 * -l <language or auto>`, it is ready when GET / answers, and a pass is a
 * POST /inference of multipart form-data with the wav as `file` and
 * `response_format=json`; the answer is `{ "text": "..." }`.
 *
 * The audio is never written to disk: it arrives as bytes over IPC and
 * leaves as bytes over a loopback socket to a port nobody else was told.
 *
 * PARAKEET IS ONE PROCESS PER PASS (#121). The pinned release has no server
 * for it, only parakeet-cli, and none is needed: MEASURED on the owner's PC,
 * a fresh process loads Parakeet v3 (q8_0) and answers the 11 s clip in 0.73
 * to 0.86 s on the CPU and 0.76 to 0.78 s on the GPU pack, under the time a
 * resident Whisper Base takes. It is started as `parakeet-cli.exe -m <model>
 * -f - -np -t <n>` (plus `-ng` on the CPU engine), the WAV goes in on STDIN
 * (its `-f -`, read into memory, MEASURED: "read 352078 bytes from stdin"),
 * and the text comes back on stdout. So this path writes no audio to disk
 * either. It has no language switch: the model detects the language itself.
 * ------------------------------------------------------------------ */

/** The first CUDA run compiles its kernels for about 9 s (MEASURED), so a
 *  start is given a minute before it is called a failure. */
export const DICTATION_START_TIMEOUT_MS = 60000
/** Five minutes idle and the server stands down (owner decision); the model
 *  reloads in about a second on the next press. */
export const DICTATION_IDLE_MS = 300000
/** A pass that has not answered by now never will. Large on a CPU was
 *  measured at 20 s for an 11 s clip, and a recording is capped at five
 *  minutes, so two minutes is far past anything a live server takes. */
export const DICTATION_REQUEST_TIMEOUT_MS = 120000

/**
 * THE GPU ENGINE'S OWN KERNEL CACHE (2026-09-28; owner: the model "is slow to
 * start up ... after like one to two minutes it suddenly transcribed"). The
 * official pack has no kernels for the newest cards, so the driver compiles
 * them at the FIRST pass: MEASURED on an RTX 5090 with Large v3 Turbo, 31.8 s
 * with no cached kernels and 0.26 s with them. The driver's cache is shared
 * with every CUDA program on the PC and capped, so ours were evicted and paid
 * again. A folder of our own, with room, keeps them for good.
 */
export const DICTATION_CUDA_CACHE_BYTES = 4 * 1024 * 1024 * 1024

/** Half a second of silence, the pass that warms a new server: it loads the
 *  model onto the device and compiles the kernels before anybody speaks. */
export function silentWav(seconds = 0.5, rate = 16000): Uint8Array {
  const samples = Math.round(seconds * rate)
  const out = new Uint8Array(44 + samples * 2)
  const v = new DataView(out.buffer)
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) out[at + i] = s.charCodeAt(i)
  }
  text(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  text(36, 'data')
  v.setUint32(40, samples * 2, true)
  return out
}

/** Parakeet's CPU threads: one per physical core (half the logical ones, as
 *  SMT doubles them), at most 16. MEASURED on a 32-thread PC with the 11 s
 *  clip: its default of 4 took 1.15 to 1.26 s a pass, 8 took 0.83 to 0.96 s
 *  and 16 took 0.72 to 0.77 s. */
export const PARAKEET_THREADS = Math.max(1, Math.min(16, Math.floor(availableParallelism() / 2)))

/** How often a starting server is asked whether it is up yet. */
const READY_POLL_MS = 100
/** How much of the server's stderr is kept: enough for its last few lines,
 *  which is where it says why it died. */
const STDERR_KEEP = 2000

export interface DictationEngineDeps {
  /** The folder of the bundled CPU engine, or null when the host has none. */
  cpuDir: () => string | null
  store: Pick<DictationStore, 'modelPath' | 'gpuEngineDir'>
  /** An NVIDIA adapter is present. Asked until it answers, then remembered. */
  hasNvidia: () => Promise<boolean>
  /** Where the GPU engine keeps its compiled kernels (see
   *  DICTATION_CUDA_CACHE_BYTES). Absent: the driver's shared cache. */
  cudaCacheDir?: () => string | null
  idleMs?: number
  startTimeoutMs?: number
  requestTimeoutMs?: number
  spawnImpl?: typeof spawn
  exeName?: string
  /** parakeet-cli's file name, beside whisper-server in both engine folders. */
  parakeetExeName?: string
  /** Which runner a model needs. The default reads the catalog. */
  engineFor?: (modelId: string) => 'whisper' | 'parakeet'
  /** Threads for a Parakeet pass on the CPU. */
  threads?: number
  /** What to actually launch for an engine exe and its argv. The default is
   *  the exe itself; the tests run a Node script through process.execPath. */
  command?: (exePath: string, args: string[]) => { file: string; args: string[] }
  now?: () => number
}

/** One launched server, from spawn to the moment its process is gone. */
interface Server {
  child: ChildProcess
  kind: EngineKind
  modelPath: string
  language: string
  port: number
  /** The tail of its stderr: what it said last is why it died. */
  stderr: string
  /** A pass has come back from it: the model is on the device and, on the
   *  GPU, the kernels are compiled. Until then a pass can take half a minute. */
  warm: boolean
  exitCode: number | null
  exited: boolean
  /** Called once, when it has exited and its stderr has been read out. */
  onExit: Set<() => void>
}

interface Job {
  req: TranscribeRequest
  resolve: (r: TranscribeResult) => void
  /** The silent pass that warms a server; nobody reads its text. */
  warmup?: boolean
}

type Launch = { ok: true; server: Server } | { ok: false; detail: string }
type Answer = { ok: true; text: string } | { ok: false; detail: string; died: boolean }

const STOPPED: TranscribeResult = { ok: false, reason: 'engine-failed', detail: 'dictation was stopped' }
/** How long a server that would not start is not started again for a partial. */
export const LAUNCH_FAIL_MS = 30_000
const launchKey = (kind: EngineKind, modelPath: string, language: string): string => `${kind}\n${modelPath}\n${language}`

/** A port nobody is using: listen on 0, read what Windows handed out, let go. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

/** Is anybody answering GET / on that port. Any answer short of a 5xx counts:
 *  the question is whether the server is up, not what its front page says. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // agent: false, here and for the pass: a kept-alive socket to a server
    // that is about to be killed is a reset waiting for the next request.
    const req = request({ host: '127.0.0.1', port, path: '/', method: 'GET', agent: false, timeout: 1000 }, (res) => {
      res.resume()
      resolve((res.statusCode ?? 500) < 500)
    })
    req.once('timeout', () => req.destroy(new Error('timeout')))
    req.once('error', () => resolve(false))
    req.end()
  })
}

/** The upload, built by hand: two parts and a boundary no wav will contain by
 *  accident (24 random hex digits), so nothing needs FormData or a Blob copy. */
function multipart(wav: Uint8Array): { body: Buffer; contentType: string } {
  const boundary = `----PrismDictation${randomBytes(12).toString('hex')}`
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n' +
        'Content-Type: audio/wav\r\n\r\n'
    ),
    Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength),
    Buffer.from(
      `\r\n--${boundary}\r\n` +
        'Content-Disposition: form-data; name="response_format"\r\n\r\n' +
        `json\r\n--${boundary}--\r\n`
    )
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

function whyItDied(s: Server): string {
  const said = s.stderr.trim()
  if (said) return said
  return s.exitCode === null ? 'the server exited' : `the server exited with code ${s.exitCode}`
}

/**
 * The engine. Nothing runs until the first `transcribe`; after that ONE
 * whisper-server is kept, replaced when the model, the language or the engine
 * kind it was started for is no longer what is being asked for, and killed
 * after `idleMs` with no request or by `stop()`.
 *
 * ENGINE CHOICE has no switch to get wrong (owner decision): the GPU pack when
 * it is installed AND an NVIDIA adapter is present, else the bundled CPU
 * engine. A GPU server that exits or never becomes ready at start is passed
 * over FOR THE LIFE OF THIS OBJECT (`gpuFellBack`), the CPU one is started in
 * its place and answers the same request: one attempt each, never a loop.
 *
 * PASSES ARE SERIALISED to one in flight, because the server is one model on
 * one device and two passes at once each take twice as long. A FINAL is what
 * gets pasted, so it is never dropped and goes ahead of any partial. A PARTIAL
 * is only the pill's live text, so at most one waits: a newer one takes its
 * place and the older answers 'superseded' without ever being sent. A partial
 * waiting when a final ARRIVES is dropped the same way: it was asked before
 * the final, so it is for a clip the final covers whole, and sending it would
 * only hold up the next recording's first live text.
 */
export function createDictationEngine(deps: DictationEngineDeps): DictationEngine {
  const idleMs = deps.idleMs ?? DICTATION_IDLE_MS
  const startTimeoutMs = deps.startTimeoutMs ?? DICTATION_START_TIMEOUT_MS
  const requestTimeoutMs = deps.requestTimeoutMs ?? DICTATION_REQUEST_TIMEOUT_MS
  const spawnImpl = deps.spawnImpl ?? spawn
  const exeName = deps.exeName ?? 'whisper-server.exe'
  const parakeetExe = deps.parakeetExeName ?? 'parakeet-cli.exe'
  const runnerFor = deps.engineFor ?? catalogEngineFor
  const threads = deps.threads ?? PARAKEET_THREADS
  const command = deps.command ?? ((exePath: string, args: string[]) => ({ file: exePath, args }))
  const now = deps.now ?? (() => Date.now())

  let current: Server | null = null
  /** The Parakeet pass in flight, so stop() can end it. */
  let pass: ChildProcess | null = null
  /** The model a Parakeet pass last answered for: there is no resident
   *  process to be warm, but the first GPU pass compiles kernels (16 s,
   *  MEASURED) and a partial must not queue behind that. */
  let parakeetWarm: string | null = null
  let lastKind: EngineKind | null = null
  let gpuFellBack = false
  let nvidia: boolean | null = null
  /** Bumped by stop(). Everything that awaits compares it before and after:
   *  a server that went away because it was TOLD to is not a failed engine,
   *  and must neither start a CPU fallback nor mark the GPU as broken. */
  let epoch = 0

  let running: Job | null = null
  const finals: Job[] = []
  let partial: Job | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let lastUsed = 0
  /** A warm-up pass is queued or running. */
  let warming = false
  /** The last warm-up failed. Partials then go the ordinary way, so the
   *  failure is reported, instead of each one starting another warm-up. */
  let warmFailed = false
  /**
   * A server that would not start, and for what (perf review 2026-10-16).
   * After a failed warm-up every partial went the ordinary way, and with no
   * server up each one launched another: a held key on a broken engine (an
   * antivirus-quarantined DLL, a damaged model) spawned a server, and read
   * the model, every 0.6 to 1 s. A PARTIAL for the same engine, model and
   * language is answered with the failure for `LAUNCH_FAIL_MS` instead; a
   * final still tries, and stop() or another model clears it.
   */
  let launchFailed: { key: string; until: number; detail: string | undefined } | null = null

  /** Queue the silent pass that warms a server for this model and language,
   *  unless one is already on its way or the server up now is warm for it. It
   *  goes in the FINALS queue, so a real final asked for after it runs on the
   *  server it warmed rather than racing it for the device. */
  function warmFor(req: { modelId: string; language: string }): Promise<TranscribeResult> {
    const modelPath = deps.store.modelPath(req.modelId)
    const language = req.language || 'auto'
    if (runnerFor(req.modelId) === 'parakeet') {
      if (modelPath && parakeetWarm === modelPath) return Promise.resolve({ ok: true, text: '', engine: lastKind ?? 'cpu' })
    } else if (current && current.warm && !current.exited && current.modelPath === modelPath && current.language === language)
      return Promise.resolve({ ok: true, text: '', engine: current.kind })
    if (warming) return Promise.resolve({ ok: false, reason: 'warming' })
    warming = true
    return new Promise<TranscribeResult>((resolve) => {
      finals.push({ req: { wav: silentWav(), modelId: req.modelId, language: req.language, final: true }, resolve, warmup: true })
      pump()
    })
  }

  function kill(s: Server): void {
    if (current === s) current = null
    // TerminateProcess on Windows: no signal to ignore and no children to
    // orphan, since whisper-server spawns nothing of its own.
    if (!s.exited) s.child.kill()
  }

  function markExited(s: Server): void {
    if (s.exited) return
    s.exited = true
    if (current === s) current = null
    for (const f of [...s.onExit]) f()
    s.onExit.clear()
  }

  /** Wait `ms`, or less if the server goes first. */
  function pause(s: Server, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        s.onExit.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      s.onExit.add(done)
      if (s.exited) done()
    })
  }

  async function hasNvidia(): Promise<boolean> {
    if (nvidia !== null) return nvidia
    try {
      // Adapters do not come and go in a session, so one answer is kept. A
      // question that THREW is not an answer: it reads as no, and is asked again.
      nvidia = await deps.hasNvidia()
      return nvidia
    } catch {
      return false
    }
  }

  async function pick(): Promise<{ kind: EngineKind; dir: string } | null> {
    const gpuDir = gpuFellBack ? null : deps.store.gpuEngineDir()
    if (gpuDir && (await hasNvidia())) return { kind: 'gpu', dir: gpuDir }
    const cpuDir = deps.cpuDir()
    return cpuDir ? { kind: 'cpu', dir: cpuDir } : null
  }

  /**
   * THE C++ RUNTIME IS BESIDE THE CPU ENGINE (fetch-whisper.mjs copies it
   * app-local, since a fresh Windows has no VCOMP140.dll). The GPU pack is the
   * official zip and carries none, so the CPU engine's folder goes on the front
   * of the child's PATH: Windows looks beside the exe first, then along PATH,
   * and the GPU engine finds the same four DLLs there. The GPU engine also gets
   * its own kernel cache (DICTATION_CUDA_CACHE_BYTES).
   */
  function childEnv(kind: EngineKind, dir: string): NodeJS.ProcessEnv {
    const runtimeDir = deps.cpuDir()
    const env: NodeJS.ProcessEnv =
      runtimeDir && runtimeDir !== dir ? { ...process.env, PATH: `${runtimeDir};${process.env.PATH ?? ''}` } : { ...process.env }
    const cache = kind === 'gpu' ? deps.cudaCacheDir?.() : null
    if (cache) {
      env.CUDA_CACHE_PATH = cache
      env.CUDA_CACHE_MAXSIZE = String(DICTATION_CUDA_CACHE_BYTES)
    }
    return env
  }

  /** One Parakeet pass: a fresh parakeet-cli, the WAV on its stdin, the text
   *  off its stdout. Never rejects. */
  function parakeetOnce(kind: EngineKind, dir: string, modelPath: string, wav: Uint8Array): Promise<Answer> {
    return new Promise((resolve) => {
      const args = ['-m', modelPath, '-f', '-', '-np', '-t', String(threads), ...(kind === 'cpu' ? ['-ng'] : [])]
      const cmd = command(join(dir, parakeetExe), args)
      let child: ChildProcess
      try {
        child = spawnImpl(cmd.file, cmd.args, { cwd: dir, env: childEnv(kind, dir), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (e) {
        resolve({ ok: false, detail: (e as Error).message, died: true })
        return
      }
      pass = child
      const out: Buffer[] = []
      let stderr = ''
      let settled = false
      const settle = (a: Answer): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (pass === child) pass = null
        resolve(a)
      }
      const timeout = setTimeout(() => {
        settle({ ok: false, detail: `no answer after ${requestTimeoutMs} ms`, died: false })
        child.kill()
      }, requestTimeoutMs)
      child.stdout?.on('data', (c: Buffer) => out.push(c))
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_KEEP)
      })
      child.once('error', (e) => settle({ ok: false, detail: e.message, died: true }))
      // `close`, not `exit`: by then stdout and stderr have both been read out.
      child.once('close', (code) => {
        const said = stderr.trim()
        if (code !== 0) return settle({ ok: false, detail: said || `parakeet-cli exited with code ${code}`, died: true })
        // MEASURED: audio it cannot read is reported on stderr as "error: ..."
        // with exit code 0, so the code alone is not the verdict.
        const failed = /^error:.*$/m.exec(stderr)
        if (failed) return settle({ ok: false, detail: failed[0], died: false })
        // Its own UTF-8 bytes, untouched by any code page: the languages it
        // knows are full of letters outside ASCII. CRLF and the edges trimmed.
        settle({ ok: true, text: Buffer.concat(out).toString('utf8').trim() })
      })
      // A child that died before reading all of it closes the pipe under the
      // write; the exit above is the answer, not this.
      child.stdin?.on('error', () => {})
      child.stdin?.end(Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength))
    })
  }

  /** A pass for a Parakeet model: the same choice of engine and the same
   *  once-and-for-good fall back to the CPU as a Whisper server gets. */
  async function runParakeet(req: TranscribeRequest, modelPath: string, stopped: () => boolean): Promise<TranscribeResult> {
    // A resident Whisper server holds another model in memory nobody uses now.
    if (current) kill(current)
    const want = await pick()
    if (stopped()) return STOPPED
    if (!want) return { ok: false, reason: 'no-engine' }
    let kind = want.kind
    let answer = await parakeetOnce(kind, want.dir, modelPath, req.wav)
    if (stopped()) return STOPPED
    // Only a GPU engine that DIED falls back, Whisper's own rule: an "error:"
    // about the audio or a timeout is not the card's fault, and the switch
    // holds for the session and for Whisper too.
    if (!answer.ok && !answer.died && kind === 'gpu') {
      lastKind = kind
      return { ok: false, reason: 'engine-failed', detail: answer.detail }
    }
    if (!answer.ok && kind === 'gpu') {
      gpuFellBack = true
      const cpuDir = deps.cpuDir()
      if (!cpuDir) return { ok: false, reason: 'engine-failed', detail: answer.detail }
      kind = 'cpu'
      answer = await parakeetOnce(kind, cpuDir, modelPath, req.wav)
      if (stopped()) return STOPPED
    }
    lastKind = kind
    if (!answer.ok) return { ok: false, reason: 'engine-failed', detail: answer.detail }
    parakeetWarm = modelPath
    return { ok: true, text: answer.text, engine: kind }
  }

  async function launch(
    kind: EngineKind,
    dir: string,
    modelPath: string,
    language: string,
    stopped: () => boolean
  ): Promise<Launch> {
    let port: number
    try {
      port = await freePort()
    } catch (e) {
      return { ok: false, detail: `no free port: ${(e as Error).message}` }
    }
    if (stopped()) return { ok: false, detail: 'stopped' }

    const cmd = command(join(dir, exeName), ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '-l', language])
    let child: ChildProcess
    try {
      // An argv array, never a shell string: both folders sit under a user's
      // profile and may hold spaces. cwd is the engine's own folder because its
      // DLLs (ggml, and cuBLAS for the GPU pack) are beside the exe. stdout is
      // dropped rather than piped: a pipe nobody drains fills, and the server
      // then blocks on its own logging.
      child = spawnImpl(cmd.file, cmd.args, { cwd: dir, env: childEnv(kind, dir), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      return { ok: false, detail: (e as Error).message }
    }
    const s: Server = { child, kind, modelPath, language, port, stderr: '', warm: false, exitCode: null, exited: false, onExit: new Set() }
    // Current from the moment it exists, so a stop() during the start kills it.
    current = s
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      s.stderr = (s.stderr + chunk).slice(-STDERR_KEEP)
    })
    // An exe that could not be launched at all (missing, blocked) says so here
    // and may never say anything else.
    child.once('error', (e) => {
      s.stderr = (s.stderr + e.message).slice(-STDERR_KEEP)
      markExited(s)
    })
    // Decided on `close`, not `exit`: the reason is read from stderr, and
    // `exit` can arrive before stderr has drained (Prism's phone transcoder
    // learned this: a fast refusal read as an empty reason). The timer is for
    // a pipe something else still holds open, which would leave `close` unsent.
    child.once('exit', (code) => {
      s.exitCode = code
      setTimeout(() => markExited(s), 250).unref()
    })
    child.once('close', () => markExited(s))

    const deadline = now() + startTimeoutMs
    for (;;) {
      if (s.exited) return { ok: false, detail: whyItDied(s) }
      if (await answers(port)) {
        // Something answered; make sure it was not the last thing it did.
        if (s.exited) return { ok: false, detail: whyItDied(s) }
        return { ok: true, server: s }
      }
      if (stopped()) return { ok: false, detail: 'stopped' }
      if (now() >= deadline) {
        kill(s)
        const said = s.stderr.trim()
        return { ok: false, detail: `the server was not ready after ${startTimeoutMs} ms${said ? `: ${said}` : ''}` }
      }
      await pause(s, READY_POLL_MS)
    }
  }

  function post(s: Server, wav: Uint8Array): Promise<Answer> {
    return new Promise((resolve) => {
      const { body, contentType } = multipart(wav)
      let settled = false
      let grace: ReturnType<typeof setTimeout> | null = null
      const settle = (a: Answer): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (grace) clearTimeout(grace)
        s.onExit.delete(died)
        req.destroy()
        resolve(a)
      }
      const died = (): void => settle({ ok: false, detail: whyItDied(s), died: true })

      const req = request(
        {
          host: '127.0.0.1',
          port: s.port,
          path: '/inference',
          method: 'POST',
          agent: false,
          headers: { 'Content-Type': contentType, 'Content-Length': body.length }
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            if (res.statusCode !== 200) {
              settle({ ok: false, detail: `HTTP ${res.statusCode}: ${raw.slice(0, 300)}`, died: false })
              return
            }
            try {
              const text = (JSON.parse(raw) as { text?: unknown }).text
              if (typeof text === 'string') settle({ ok: true, text })
              else settle({ ok: false, detail: `no text in the answer: ${raw.slice(0, 300)}`, died: false })
            } catch {
              settle({ ok: false, detail: `not JSON: ${raw.slice(0, 300)}`, died: false })
            }
          })
        }
      )
      // A dying server is seen TWICE: the socket resets at once, and the
      // process is reported gone a moment later with its stderr read out. The
      // second is the one worth telling the user, so a socket error waits a
      // second for it. A socket error from a server that stays up means it
      // cannot be trusted with the next pass either, so it is replaced.
      req.once('error', (e) => {
        if (settled || grace) return
        grace = setTimeout(() => {
          settle({ ok: false, detail: e.message, died: false })
          kill(s)
        }, 1000)
      })
      const timeout = setTimeout(() => {
        settle({ ok: false, detail: `no answer after ${requestTimeoutMs} ms`, died: false })
        kill(s)
      }, requestTimeoutMs)
      s.onExit.add(died)
      if (s.exited) died()
      else req.end(body)
    })
  }

  async function run(req: TranscribeRequest): Promise<TranscribeResult> {
    const mine = epoch
    const stopped = (): boolean => epoch !== mine

    const modelPath = deps.store.modelPath(req.modelId)
    if (!modelPath) return { ok: false, reason: 'no-model' }
    if (runnerFor(req.modelId) === 'parakeet') return runParakeet(req, modelPath, stopped)
    const language = req.language || 'auto'

    const want = await pick()
    if (stopped()) return STOPPED
    if (!want) return { ok: false, reason: 'no-engine' }

    let s = current
    if (s && (s.exited || s.kind !== want.kind || s.modelPath !== modelPath || s.language !== language)) {
      // The server holds ONE model and ONE language for its whole life: both
      // are argv. The port is new each time, so the old one need not be waited for.
      kill(s)
      s = null
    }
    if (!s) {
      const failed = launchFailed
      if (!req.final && failed && failed.key === launchKey(want.kind, modelPath, language) && now() < failed.until)
        return { ok: false, reason: 'engine-failed', detail: failed.detail }
      let started = await launch(want.kind, want.dir, modelPath, language, stopped)
      if (stopped()) return STOPPED
      if (!started.ok && want.kind === 'gpu') {
        // Once, and for good: a pack that will not start on this machine now
        // will not start on the next press either, and each try can cost the
        // whole start timeout.
        gpuFellBack = true
        const cpuDir = deps.cpuDir()
        if (!cpuDir) return { ok: false, reason: 'engine-failed', detail: started.detail }
        started = await launch('cpu', cpuDir, modelPath, language, stopped)
        if (stopped()) return STOPPED
      }
      if (!started.ok) {
        // Keyed by what the NEXT pick will ask for: after a GPU fallback that is the CPU.
        const kind = want.kind === 'gpu' && gpuFellBack ? 'cpu' : want.kind
        launchFailed = { key: launchKey(kind, modelPath, language), until: now() + LAUNCH_FAIL_MS, detail: started.detail }
        return { ok: false, reason: 'engine-failed', detail: started.detail }
      }
      launchFailed = null
      s = started.server
    }
    lastKind = s.kind

    const answer = await post(s, req.wav)
    if (stopped()) return STOPPED
    if (answer.ok) {
      s.warm = true
      return { ok: true, text: answer.text, engine: s.kind }
    }
    // A GPU server that started and then died UNDER A PASS (a model too big for
    // the card's memory does exactly this) would die under the next one too.
    // This request is lost either way; the next goes to the CPU engine.
    if (answer.died && s.kind === 'gpu') gpuFellBack = true
    return { ok: false, reason: 'engine-failed', detail: answer.detail }
  }

  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer)
    // unref: a timer five minutes out must not be what keeps a quitting app alive.
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (running || !current) return
      const left = lastUsed + idleMs - now()
      if (left > 0) armIdle()
      else kill(current)
    }, Math.max(1, lastUsed + idleMs - now()))
    idleTimer.unref()
  }

  function pump(): void {
    if (running) return
    let job = finals.shift() ?? null
    if (!job) {
      job = partial
      partial = null
    }
    if (!job) {
      lastUsed = now()
      if (current) armIdle()
      return
    }
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    running = job
    const mine = job
    run(mine.req)
      .catch((e: unknown): TranscribeResult => ({ ok: false, reason: 'engine-failed', detail: String(e) }))
      .then((result) => {
        if (running === mine) running = null
        if (mine.warmup) {
          warming = false
          warmFailed = !result.ok
        }
        mine.resolve(result)
        pump()
      })
  }

  return {
    transcribe(req) {
      // A PARTIAL IS NOT QUEUED BEHIND A COLD START (2026-09-28): it is only
      // the pill's live text, and one waiting behind a half-minute kernel
      // compile showed nothing and then held up the final. It is answered
      // 'warming' at once and the warm-up is started, so the pill can say so.
      const warm =
        runnerFor(req.modelId) === 'parakeet'
          ? parakeetWarm !== null && parakeetWarm === deps.store.modelPath(req.modelId)
          : !!(current && current.warm && !current.exited)
      if (!req.final && !warmFailed && !warm) {
        void warmFor(req)
        return Promise.resolve({ ok: false, reason: 'warming' })
      }
      return new Promise<TranscribeResult>((resolve) => {
        const job: Job = { req, resolve }
        if (partial) {
          // Whatever arrives, the partial already waiting is now out of date.
          partial.resolve({ ok: false, reason: 'superseded' })
          partial = null
        }
        if (req.final) finals.push(job)
        else partial = job
        pump()
      })
    },

    warm(req) {
      return warmFor(req)
    },

    stop() {
      epoch += 1
      warming = false
      warmFailed = false
      launchFailed = null
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      for (const job of finals.splice(0)) job.resolve(STOPPED)
      if (partial) partial.resolve(STOPPED)
      partial = null
      // The pass in flight answers for itself: its server going away wakes it,
      // and it sees the epoch has moved.
      if (current) kill(current)
      // Off means off for Parakeet too: a pass running now is ended, not left
      // to finish, and the next arm warms again.
      if (pass) {
        pass.kill()
        pass = null
      }
      parakeetWarm = null
    },

    info() {
      // `engine` is the kind of the server that is up, or of the last one that
      // was, so Settings can still say which engine answered after a stand-down.
      return { running: current !== null || pass !== null, engine: current ? current.kind : lastKind, gpuFellBack }
    }
  }
}
