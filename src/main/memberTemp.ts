import { createHash } from 'crypto'
import { existsSync, readdirSync, rmSync } from 'fs'
import { mkdir, rm, stat, statfs } from 'fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'path'

/**
 * THE MEMBER TEMP FOLDER (#300). A file inside a zip is a place in the
 * Explorer now, and opening or previewing one unpacks JUST that member here
 * first, so every viewer Prism has shows it unchanged.
 *
 * One folder per Prism run, `%TEMP%\prism-members\<pid>-<launch>`, and under
 * it one folder per member, named by a hash of the container's path, size and
 * modified time and the member's name, holding the file under its own name (so
 * the viewer's kind detection reads the real name, and two members called
 * `index.ts` never collide). The same member of an unchanged container is
 * unpacked once a run.
 *
 * The run folder is granted to the READS as a DIRECTORY (the comics rule):
 * `extractedPaths` was one entry per member in a Set that never shrinks. No
 * write handler accepts it: a member is read-only, and what an app saved into
 * a temp copy would be lost the moment it is cleaned.
 *
 * Cleanup: this run's folder at quit (best effort; a file a player still holds
 * is left), every dead run's folder at the next start (never on the startup
 * path, #189), and while running a cap on the folder's size, evicting the
 * least recently viewed and never one the caller says is held.
 */

/** Bytes the run's folder may hold before the least recently viewed go. */
export const RUN_CAP_BYTES = 2 * 1024 * 1024 * 1024

/** A click, the arrows or the preview pane unpack up to this much; past it a
 *  member waits for an explicit Open. */
export const AUTO_PREVIEW_BYTES = 256 * 1024 * 1024

/** What an unpack answered: the file, or why not. */
export type Unpacked<R extends string> = { ok: true; path: string } | { ok: false; reason: R }

export interface MemberSlot {
  /** The member's own folder in the run (made on demand). */
  dir: string
  /** Where the file will be (or is), named as the member is. */
  file: string
}

interface Held {
  file: string
  bytes: number
  used: number
}

export class MemberTemp {
  readonly root: string
  readonly dir: string
  private readonly made = new Map<string, Held>()
  private readonly inflight = new Map<string, Promise<Unpacked<string>>>()
  private clock = 0

  constructor(root: string, pid = process.pid, launch = Date.now()) {
    this.root = resolve(root)
    this.dir = join(this.root, `${pid}-${launch}`)
  }

  /** Is `p` a file this run unpacked (the reads' grant). */
  owns(p: unknown): boolean {
    if (typeof p !== 'string' || !isAbsolute(p)) return false
    const rel = relative(this.dir.toLowerCase(), resolve(p).toLowerCase())
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /** The slot of one member of one state of one container. */
  slot(container: string, size: number, mtimeMs: number, member: string): MemberSlot {
    const hash = createHash('sha1')
      .update(`${resolve(container).toLowerCase()}\0${size}\0${Math.round(mtimeMs)}\0${member}`)
      .digest('hex')
      .slice(0, 20)
    const dir = join(this.dir, hash)
    const name = basename(member.replace(/\\/g, '/').replace(/\/+$/, '')) || 'member'
    return { dir, file: join(dir, name) }
  }

  /**
   * The member's file, unpacking it with `write` the first time. `write` is
   * handed the member's own empty folder and answers the file it wrote (an
   * extractor may name it itself) or why it could not. Concurrent asks for one
   * member share one unpack.
   */
  async ensure<R extends string>(
    container: string,
    member: string,
    write: (dir: string) => Promise<Unpacked<R>>
  ): Promise<Unpacked<R | 'failed'>> {
    let info: { size: number; mtimeMs: number }
    try {
      info = await stat(container)
    } catch {
      return { ok: false, reason: 'failed' }
    }
    const { dir } = this.slot(container, info.size, info.mtimeMs, member)
    const known = this.made.get(dir)
    if (known && existsSync(known.file)) {
      known.used = ++this.clock
      return { ok: true, path: known.file }
    }
    const running = this.inflight.get(dir) as Promise<Unpacked<R | 'failed'>> | undefined
    if (running) return running
    const job = (async (): Promise<Unpacked<R | 'failed'>> => {
      try {
        await rm(dir, { recursive: true, force: true })
        await mkdir(dir, { recursive: true })
        const out = await write(dir)
        if (!out.ok || !this.owns(out.path) || !existsSync(out.path)) {
          await rm(dir, { recursive: true, force: true }).catch(() => {})
          return out.ok ? { ok: false, reason: 'failed' } : out
        }
        const bytes = await stat(out.path).then(
          (s) => s.size,
          () => 0
        )
        this.made.set(dir, { file: out.path, bytes, used: ++this.clock })
        return out
      } catch {
        await rm(dir, { recursive: true, force: true }).catch(() => {})
        return { ok: false, reason: 'failed' }
      } finally {
        this.inflight.delete(dir)
      }
    })()
    this.inflight.set(dir, job as Promise<Unpacked<string>>)
    return job
  }

  /** Mark a file as just viewed, so the cap evicts it last. */
  touch(p: string): void {
    for (const held of this.made.values())
      if (held.file.toLowerCase() === resolve(p).toLowerCase()) held.used = ++this.clock
  }

  /** Bytes the run's folder holds. */
  bytes(): number {
    let n = 0
    for (const h of this.made.values()) n += h.bytes
    return n
  }

  /**
   * Bring the folder under `cap`, least recently viewed first, never a file
   * `held` names (the one on screen, one a player has open). Returns the files
   * removed.
   */
  async evict(held: (file: string) => boolean, cap = RUN_CAP_BYTES): Promise<string[]> {
    let total = this.bytes()
    if (total <= cap) return []
    const order = [...this.made.entries()].sort(([, a], [, b]) => a.used - b.used)
    const gone: string[] = []
    for (const [dir, h] of order) {
      if (total <= cap) break
      if (held(h.file)) continue
      try {
        await rm(dir, { recursive: true, force: true })
        this.made.delete(dir)
        total -= h.bytes
        gone.push(h.file)
      } catch {
        /* still open somewhere: it goes at quit or at the next start */
      }
    }
    return gone
  }

  /** Is there room for `bytes` more on the temp drive. */
  async room(bytes: number): Promise<boolean> {
    try {
      await mkdir(this.dir, { recursive: true })
      const s = await statfs(this.dir)
      return Number(s.bavail) * Number(s.bsize) > bytes + 64 * 1024 * 1024
    } catch {
      return true // no answer is not a refusal: the write itself will say
    }
  }

  /** At quit: this run's folder, best effort and synchronous (the process is
   *  going). A file a player still holds stays for the next start. */
  removeRun(): void {
    try {
      rmSync(this.dir, { recursive: true, force: true })
    } catch {
      /* held open: the next start removes it */
    }
  }
}

/**
 * At startup, after the first window: every run folder whose process is gone.
 * `alive` is asked per pid; this run's own folder is never touched.
 */
export async function cleanDeadRuns(
  root: string,
  alive: (pid: number) => boolean,
  own?: string
): Promise<string[]> {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names) {
    const m = /^(\d+)-\d+$/.exec(name)
    const dir = join(root, name)
    if (!m || (own && resolve(dir).toLowerCase() === resolve(own).toLowerCase())) continue
    if (alive(Number(m[1]))) continue
    try {
      await rm(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch {
      /* in use after all */
    }
  }
  return removed
}

/** Does a process with this id exist. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
