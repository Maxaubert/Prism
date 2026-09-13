/**
 * Where you had got to in a film, kept ONCE, on the PC (2026-09-13, #118).
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
 * Modelled on tabs.json: a small file under userData, written on a debounce,
 * a suggestion rather than a record. Capped, newest kept, because a viewer
 * that has opened ten thousand films does not need ten thousand places. The
 * rules about WHICH files are remembered (over ten minutes, cleared in the
 * last minute) are the players' own and stay there; this stores what it is
 * given. Paths compare case-insensitively, as Windows does.
 */
import { promises as fsp } from 'fs'
import { dirname } from 'path'

export interface Mark {
  /** Seconds into the file. */
  t: number
  /** When it was written, so the cap keeps the newest. */
  at: number
}

export const POSITIONS_CAP = 500
const SAVE_DELAY_MS = 400

export function positionKey(path: string): string {
  return path.toLowerCase()
}

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
    const m = v as { t?: unknown; at?: unknown }
    if (typeof k !== 'string' || !k) continue
    if (typeof m?.t !== 'number' || !Number.isFinite(m.t) || m.t < 0) continue
    out.set(k, { t: m.t, at: typeof m.at === 'number' && Number.isFinite(m.at) ? m.at : 0 })
  }
  return out
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

  /** Seconds into the file, or null when nothing is remembered. */
  async get(path: string): Promise<number | null> {
    await this.loaded
    return this.marks.get(positionKey(path))?.t ?? null
  }

  /** Remember a place, or forget one (`null`). Saved on a debounce. */
  set(path: string, t: number | null): void {
    const key = positionKey(path)
    if (t === null || !Number.isFinite(t) || t < 0) {
      this.marks.delete(key)
      this.tombstones.add(key)
    } else {
      this.marks.set(key, { t, at: this.now() })
      this.tombstones.delete(key)
    }
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
