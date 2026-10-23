// A stand-in for whisper-server.exe, for dictationEngine.test.ts. It speaks the
// two routes the engine uses (GET / and POST /inference, measured against the
// real b5130 server on 2026-09-19) and answers with a description of what it
// RECEIVED, so a test can read the argv, the multipart parts and the order of
// the passes back out of `text` instead of trusting the engine's word for them.
//
// Started the way the real one is: -m <model> --host 127.0.0.1 --port <n> -l <lang>.
// Switches, as argv or as the environment variable beside each:
//   --fake-exit             FAKE_WHISPER_EXIT=1         say why on stderr and exit 3 at once
//                                                        (a GPU engine that cannot start)
//   --fake-never-ready      FAKE_WHISPER_NEVER_READY=1  stay alive and never listen
//   --fake-delay <ms>       FAKE_WHISPER_DELAY=<ms>     hold every /inference answer this long
//   --fake-die-on-inference FAKE_WHISPER_DIE=1          read the upload, say why on stderr, exit 4
//
// The globals are imported by name because the repo's eslint config gives Node
// globals to tools/ only, and this file may not change that config.
import { Buffer } from 'node:buffer'
import http from 'node:http'
import process from 'node:process'
import { setInterval, setTimeout } from 'node:timers'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

const model = value('-m')
const language = value('-l')
const host = value('--host') ?? '127.0.0.1'
const port = Number(value('--port') ?? 0)
const delay = Number(value('--fake-delay') ?? process.env.FAKE_WHISPER_DELAY ?? 0)
const exitNow = flag('--fake-exit') || process.env.FAKE_WHISPER_EXIT === '1'
const neverReady = flag('--fake-never-ready') || process.env.FAKE_WHISPER_NEVER_READY === '1'
const dieOnInference = flag('--fake-die-on-inference') || process.env.FAKE_WHISPER_DIE === '1'

/** The parts of a multipart/form-data body: name, filename, type and the bytes. */
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '')
  if (!m) return []
  const mark = Buffer.from(`--${m[1] ?? m[2]}`)
  const parts = []
  let at = body.indexOf(mark)
  while (at >= 0) {
    const next = body.indexOf(mark, at + mark.length)
    if (next < 0) break
    // Between two marks: CRLF, the headers, a blank line, the bytes, CRLF.
    const chunk = body.subarray(at + mark.length + 2, next - 2)
    const split = chunk.indexOf('\r\n\r\n')
    if (split >= 0) {
      const head = chunk.subarray(0, split).toString('utf8')
      parts.push({
        name: /name="([^"]*)"/i.exec(head)?.[1] ?? null,
        filename: /filename="([^"]*)"/i.exec(head)?.[1] ?? null,
        type: /content-type:\s*(.+)/i.exec(head)?.[1]?.trim() ?? null,
        data: chunk.subarray(split + 4)
      })
    }
    at = next
  }
  return parts
}

if (exitNow) {
  process.stderr.write('fake: CUDA error: no kernel image is available for execution on the device\n')
  process.exit(3)
} else if (neverReady) {
  // Alive, and deaf: what a server stuck loading its model looks like from outside.
  setInterval(() => {}, 1000)
} else {
  let count = 0
  let active = 0
  let maxActive = 0
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>fake whisper server</html>')
      return
    }
    if (req.method !== 'POST' || req.url !== '/inference') {
      res.writeHead(404)
      res.end()
      return
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      if (dieOnInference) {
        // The whole message goes out before the exit, so the engine's stderr tail has it.
        process.stderr.write('fake: ggml_cuda: out of memory\n', () => process.exit(4))
        return
      }
      active += 1
      maxActive = Math.max(maxActive, active)
      count += 1
      const n = count
      const parts = parseMultipart(Buffer.concat(chunks), req.headers['content-type'])
      const file = parts.find((p) => p.name === 'file')
      const format = parts.find((p) => p.name === 'response_format')
      setTimeout(() => {
        const seen = {
          n,
          maxActive,
          bytes: file ? file.data.length : -1,
          filename: file?.filename ?? null,
          type: file?.type ?? null,
          format: format ? format.data.toString('utf8') : null,
          model,
          language,
          host,
          port,
          pid: process.pid,
          cwd: process.cwd(),
          cudaCache: process.env.CUDA_CACHE_PATH ?? null,
          cudaMax: process.env.CUDA_CACHE_MAXSIZE ?? null
        }
        active -= 1
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ text: JSON.stringify(seen) }))
      }, delay)
    })
  })
  server.listen(port, host)
}
