import { closeSync, openSync, readdirSync, readSync, statSync } from 'fs'
import { open, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

// What a tab that hosted an agent comes back to. Lifted out of Prism's index.ts
// so the rules can be tested without a window: main resolves the resume HERE,
// from claude's own store, and the renderer only ever carries the answer back.

/** The marker that means "codex, continue this folder's newest session". Not
 *  an id: codex finds it itself. */
export const CODEX_RESUME = 'codex:last'

/**
 * ONLY A CONVERSATION SOMEBODY HAD IN A TERMINAL IS RESUMED (2026-09-28; owner:
 * "it continued the wrong session ... a message I hadn't sent, about a review
 * it wanted the agent to conduct"). Claude's store for a folder also holds
 * every session a TOOL started there through the Agent SDK: MEASURED, 25 of
 * the 26 newest in the owner's repo folder were a commit hook's "Review this
 * change for security vulnerabilities" runs, and 149 of the 150 newest in his
 * home folder were SDK runs too. The newest file was one of those, so a tab
 * came back to a conversation its user never had.
 *
 * What tells them apart is in the first few kilobytes, MEASURED on all of
 * them: an SDK session opens with a `queue-operation` line and records an
 * `entrypoint` of `sdk-py`, `sdk-cli` and the like; an interactive one records
 * `cli`. A file that says neither (an older claude) is kept, as before.
 */
export function isInteractiveHead(head: string): boolean {
  const cut = head.indexOf('\n')
  const first = cut >= 0 ? head.slice(0, cut) : head
  if (/"type"\s*:\s*"queue-operation"/.test(first)) return false
  const ep = /"entrypoint"\s*:\s*"([^"]+)"/.exec(head)
  return !ep || ep[1] === 'cli'
}

/** How much of a transcript is read to tell an interactive one: the marks
 *  sit in its first lines. */
const HEAD_BYTES = 4096

/** How many interactive sessions a lookup answers with: one per tab in the
 *  folder is what is used, and nobody restores this many into one folder. */
const WANT = 32

function headSync(file: string): string {
  let fd = -1
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.alloc(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd >= 0) closeSync(fd)
  }
}

async function headAsync(file: string): Promise<string> {
  try {
    const fh = await open(file, 'r')
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0)
      return buf.subarray(0, bytesRead).toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
}

/**
 * The Claude sessions recorded for `cwd`, newest first, from claude's own
 * store: ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl. The encoding is
 * claude's (every non-alphanumeric character becomes a dash). Empty when the
 * folder has no sessions - then nothing is resumed.
 *
 * THE FOLDER THE SHELL WAS IN (2026-09-09): claude records its conversation
 * under the cwd it was launched in, so the lookup is by the tab's own folder
 * and never by anything wider. Looking it up by a parent handed a subfolder's
 * tab the PARENT's newest conversation - a resume of the wrong session, which
 * is worse than none.
 *
 * `home` is an argument only so the test can point it at a folder of its own.
 */
export function claudeSessions(cwd: string, home: string = homedir()): string[] {
  const enc = cwd.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(home, '.claude', 'projects', enc)
  try {
    const newest = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ id: f.slice(0, -'.jsonl'.length), m: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)
    const out: string[] = []
    for (const s of newest) {
      if (out.length >= WANT) break
      if (isInteractiveHead(headSync(join(dir, `${s.id}.jsonl`)))) out.push(s.id)
    }
    return out
  } catch {
    return []
  }
}

/**
 * `claudeSessions` OFF MAIN'S THREAD (2026-09-22, owner: the app "soft locks
 * for a second on first launch"). A folder claude has worked in for months
 * holds thousands of transcripts - 1847 in the owner's home folder - and the
 * synchronous walk stats every one on main's only thread while the tabs
 * restore, on a disk that is cold after boot, which is every window of the app
 * standing still. Same answer, same order; the stats go sixteen at a time, the
 * bound the directory listing uses, so they do not flood the pool a playing
 * film is read through.
 */
export async function claudeSessionsAsync(cwd: string, home: string = homedir()): Promise<string[]> {
  const enc = cwd.replace(/[^A-Za-z0-9]/g, '-')
  const dir = join(home, '.claude', 'projects', enc)
  let names: string[]
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return []
  }
  const found: Array<{ id: string; m: number }> = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < names.length) {
      const f = names[next++]
      try {
        found.push({ id: f.slice(0, -'.jsonl'.length), m: (await stat(join(dir, f))).mtimeMs })
      } catch {
        /* removed while we looked: not a session to resume */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(16, names.length) }, worker))
  // Newest first, and only the interactive ones: heads are read from the
  // newest down, a batch at a time, until enough are found. A folder whose
  // newest files are all a tool's still costs a few kilobytes per file.
  const newest = found.sort((a, b) => b.m - a.m)
  const out: string[] = []
  for (let i = 0; i < newest.length && out.length < WANT; i += 16) {
    const batch = newest.slice(i, i + 16)
    const heads = await Promise.all(batch.map((s) => headAsync(join(dir, `${s.id}.jsonl`))))
    batch.forEach((s, k) => {
      if (out.length < WANT && isInteractiveHead(heads[k])) out.push(s.id)
    })
  }
  return out
}

/**
 * The resume id came from main's own scan of ~/.claude/projects, but it
 * crossed the renderer on the way back - shape-check it again before it goes
 * anywhere near a command line. Anything that is not a session id or the codex
 * marker is no resume at all.
 */
export function validResume(r: string | undefined): string | undefined {
  return r === CODEX_RESUME || (r && /^[0-9a-f][0-9a-f-]{6,62}[0-9a-f]$/i.test(r)) ? r : undefined
}
