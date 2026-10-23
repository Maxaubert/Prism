// A stand-in for parakeet-cli.exe, for dictationEngine.test.ts (#121). Started
// the way the real one is (-m <model> -f - -np -t <n> [-ng], measured against
// the b5130 release on 2026-10-04), it reads the WAV off STDIN to the end and
// prints, as the "text", a description of what it RECEIVED: so a test reads the
// argv, the byte count and the environment back instead of trusting the engine.
//
// Switches (argv, appended by the test's `command`):
//   --fake-exit          say why on stderr and exit 3 (an engine that cannot run)
//   --fake-delay <ms>    hold the answer this long after stdin has ended
//   --fake-error-zero    say "error: ..." on stderr and exit 0, as the real one
//                        does for audio it cannot read (MEASURED)
//   --fake-unicode       answer with letters outside ASCII
//
// The globals are imported by name: the repo's eslint config gives Node
// globals to tools/ only.
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { setTimeout } from 'node:timers'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const value = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  if (flag('--fake-exit')) {
    process.stderr.write('fake: CUDA error: no kernel image is available for execution on the device\n', () => process.exit(3))
    return
  }
  if (flag('--fake-error-zero')) {
    process.stderr.write("error: failed to read audio file '-'\n", () => process.exit(0))
    return
  }
  setTimeout(() => {
    const text = flag('--fake-unicode')
      ? 'Grüß Gott, æøå, ¿qué tal?'
      : JSON.stringify({
          bytes: Buffer.concat(chunks).length,
          model: value('-m'),
          file: value('-f'),
          noPrints: flag('-np'),
          threads: value('-t'),
          noGpu: flag('-ng'),
          pid: process.pid,
          cwd: process.cwd(),
          cudaCache: process.env.CUDA_CACHE_PATH ?? null
        })
    // CRLF, as the real one prints on Windows.
    process.stdout.write(text + '\r\n')
  }, Number(value('--fake-delay') ?? 0))
})
