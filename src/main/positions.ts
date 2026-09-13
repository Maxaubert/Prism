/**
 * What you did with a film, kept ONCE, on the PC (2026-09-13, #118, #124).
 *
 * The position used to live in each renderer's own localStorage, keyed by
 * the media URL - an `fsmedia://` path on the PC, `/hls/<job>/index.m3u8?t=`
 * on the phone, which changes with every job and every token. So the phone
 * never saw the PC's place, and could not even find its own from one evening
 * to the next: the owner was some way into a film on the PC, opened it on the
 * iPad, and it began at the beginning. Keyed by the FILE PATH now, in one
 * store both hosts read and write, over IPC from the window and over
 * `/api/pos` from the phone.
 *
 * AND THE CHOICES BESIDE THE PLACE (#124, owner: "if I set the audio track
 * to English and later come back to it in a new tab, it should still be in
 * English"): the audio track, the subtitle track and the aspect ratio picked
 * for that file. Each is set on its own (`set` MERGES a patch) and each can
 * be cleared to null; `t` is the place and null forgets it. A record with
 * nothing left in it goes.
 *
 * Modelled on tabs.json: a small file under userData, written on a debounce,
 * a suggestion rather than a record. Capped, newest kept, because a viewer
 * that has opened ten thousand films does not need ten thousand places. The
 * rules about WHICH files are remembered (over ten minutes, cleared in the
 * last minute) are the players' own and stay there; this stores what it is
 * given. Paths compare case-insensitively, as Windows does, and a record
 * FOLLOWS Prism's own renames and moves (`rename`), so a film tidied into a
 * folder keeps its place and its choices.
 */
import { promises as fsp } from 'fs'
import { dirname } from 'path'

export interface Memory {
  /** Seconds into the file. */
  t?: number
  /** The audio track picked (a stream index); null is the file's default. */
  audio?: number | null
  /** The subtitle track picked (its path); null is off, by choice. */
  subs?: string | null
  /** The aspect ratio picked (`VideoFit`). */
  fit?: string
}

export interface Mark extends Memory {
  /** When it was last written, so the cap keeps the newest. */
  at: number
}

/** What `set` takes: every field optional, null clearing it. */
export type MemoryPatch = { t?: number | null; audio?: number | null; subs?: string | null; fit?: string | null }

export const POSITIONS_CAP = 500
const SAVE_DELAY_MS = 400

export function positionKey(path: string): string {
  return path.toLowerCase()
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Read the store out of JSON, keeping only sane entries. Pure. */
export function parsePositions(raw: string): Map<string, Mark> {
  const out = new Map<string, Mark>()
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return out
  }
  if (!doc || typeof doc !== 'object') return out
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k || !v || typeof v !== 'object') continue
    const m = v as Record<string, unknown>
    const mark: Mark = { at: finite(m.at) ? m.at : 0 }
    if (finite(m.t) && m.t >= 0) mark.t = m.t
    if (finite(m.audio) || m.audio === null) mark.audio = m.audio as number | null
    if (typeof m.subs === 'string' || m.subs === null) mark.subs = m.subs as string | null
    if (typeof m.fit === 'string' && m.fit) mark.fit = m.fit
    if (hasMemory(mark)) out.set(k, mark)
  }
  return out
}

/** Is anything remembered here, beyond the stamp? */
export function hasMemory(m: Mark): boolean {
  return m.t !== undefined || m.audio !== undefined || m.subs !== undefined || m.fit !== undefined
}

/** One record with a patch laid over it: a null clears the field, a value
 *  sets it, an absent field is left alone. Pure. */
export function applyPatch(mark: Mark | undefined, patch: MemoryPatch, at: number): Mark {
  const next: Mark = { ...(mark ?? { at }), at }
  if ('t' in patch) {
    if (patch.t === null || patch.t === undefined || !finite(patch.t) || patch.t < 0) delete next.t
    else next.t = patch.t
  }
  if ('audio' in patch) {
    if (patch.audio === undefined) delete next.audio
    else next.audio = finite(patch.audio) ? patch.audio : null
  }
  if ('subs' in patch) {
    if (patch.subs === undefined) delete next.subs
    else next.subs = typeof patch.subs === 'string' ? patch.subs : null
  }
  if ('fit' in patch) {
    if (typeof patch.fit === 'string' && patch.fit) next.fit = patch.fit
    else delete next.fit
  }
  return next
}

/** Drop the oldest entries past the cap. Pure: returns the map to keep. */
export function prunePositions(marks: Map<string, Mark>, cap = POSITIONS_CAP): Map<string, Mark> {
  if (marks.size <= cap) return marks
  const kept = [...marks.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, cap)
  return new Map(kept)
}

export class Positions {
  private marks = new Map<string, Mark>()
  /** Forgotten before the file was read: the file must not bring them back. */
  private tombstones = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> = Promise.resolve()
  private loaded: Promise<void>

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now
  ) {
    this.loaded = fsp
      .readFile(file, 'utf8')
      .then((raw) => {
        // What was set before the file was read wins over the file.
        const fromDisk = parsePositions(raw)
        for (const k of this.tombstones) fromDisk.delete(k)
        for (const [k, v] of this.marks) fromDisk.set(k, v)
        this.marks = prunePositions(fromDisk)
        this.tombstones.clear()
      })
      .catch(() => undefined)
  }

  /** Everything remembered about the file, or null when nothing is. */
  async get(path: string): Promise<Memory | null> {
    await this.loaded
    const m = this.marks.get(positionKey(path))
    if (!m) return null
    const { at: _at, ...memory } = m
    void _at
    return memory
  }

  /** Lay a patch over the file's record. Saved on a debounce. */
  set(path: string, patch: MemoryPatch): void {
    const key = positionKey(path)
    const next = applyPatch(this.marks.get(key), patch, this.now())
    if (hasMemory(next)) {
      this.marks.set(key, next)
      this.tombstones.delete(key)
    } else {
      this.marks.delete(key)
      this.tombstones.add(key)
    }
    this.schedule()
  }

  /** The record follows a file Prism renamed or moved: a film tidied into a
   *  folder keeps its place and its choices. A record already at `to` is
   *  replaced; nothing at `from` is nothing to carry. */
  async rename(from: string, to: string): Promise<void> {
    await this.loaded
    const a = positionKey(from)
    const b = positionKey(to)
    if (a === b) return
    const m = this.marks.get(a)
    if (!m) return
    this.marks.delete(a)
    this.tombstones.add(a)
    this.marks.set(b, m)
    this.tombstones.delete(b)
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.save(), SAVE_DELAY_MS)
    this.timer.unref?.()
  }

  /** Write now: shutdown, and the tests. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.save()
  }

  private save(): Promise<void> {
    this.writing = this.writing
      .then(async () => {
        await this.loaded
        this.marks = prunePositions(this.marks)
        await fsp.mkdir(dirname(this.file), { recursive: true }).catch(() => undefined)
        await fsp.writeFile(this.file, JSON.stringify(Object.fromEntries(this.marks)))
      })
      .catch(() => undefined)
    return this.writing
  }
}
