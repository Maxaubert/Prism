// A stand-in for core/dictation-host/parakeetHost.ps1: the same protocol on
// stdin and stdout, run by Node. argv: <engine folder> <model> <gpu 1|0>
// <threads> [<cache>]. FAKE_HOST=never: it never says "ready".
// Each answer's text is JSON of what it saw: the pass number, the bytes, its pid.
// The globals by name, as fakeParakeetCli.mjs does (the eslint config).
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { setInterval } from 'node:timers'
const [dir, model, gpu] = process.argv.slice(2)
if (process.env.FAKE_HOST === 'never') {
  setInterval(() => {}, 1000)
} else {
  process.stdout.write('ready\n')
  let buf = Buffer.alloc(0)
  let need = -1
  let n = 0
  process.stdin.on('data', (d) => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (need < 0) {
        const i = buf.indexOf(10)
        if (i < 0) return
        const head = buf.subarray(0, i).toString()
        buf = buf.subarray(i + 1)
        if (head === 'quit') process.exit(0)
        need = Number(head.slice(5))
      }
      if (buf.length < need) return
      const bytes = need
      buf = buf.subarray(need)
      need = -1
      n += 1
      const text = JSON.stringify({ n, bytes, pid: process.pid, gpu: gpu === '1', model, dir })
      process.stdout.write(`ok ${Buffer.from(text, 'utf8').toString('base64')}\n`)
    }
  })
}
