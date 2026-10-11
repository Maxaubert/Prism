import { termApi } from '../host'
import { findLinks } from './termLinks'
import { findPaths, type PathCandidate } from './termPaths'

/**
 * WHICH PATHS ON SCREEN EXIST (#99). The painter and the click both ask
 * `known`; a path nobody has asked about yet is queued and asked about in one
 * batch, and when any turns out to exist, the `onPathsFound` listeners of the
 * tab that asked paint again (#167: that tab only). So a path lights up a moment after it is printed, and only if it is
 * real: nothing is painted that a click could not open.
 *
 * Per folder, since `docs/a.pdf` is a different file in every shell. A "no" is
 * forgotten after a while, so a file written after its name was printed
 * lights up the next time the screen is looked at; a "yes" stays.
 */
export interface PathHit {
  kind: 'file' | 'dir'
  abs: string
}

const NO_TTL_MS = 15_000
const MAX_ENTRIES = 5000
const BATCH_MS = 40

/**
 * WHO ASKED (#167). One module-wide listener set used to wake EVERY tab when
 * any batch found a path, and each woken painter rescanned its whole
 * scrollback in one task: MEASURED in Stable's diag log (2026-10-10 16:58Z),
 * page stacks of 2009 ms and 2046 ms in the painter's `scan` around a 2153 ms
 * term:path-kinds call, the window frozen 1.8 to 2.2 s. A tab that never
 * printed the path has nothing to repaint, so the answer goes only to the
 * owners (the session ids) that asked for that path.
 */
const NO_OWNER = ''

const cache = new Map<string, { hit: PathHit | null; at: number }>()
/** cwd -> path -> the owners that asked for it, waiting for the batch. */
const queued = new Map<string, Map<string, Set<string>>>()
/** key -> the owners waiting on a batch already asked; a later asker joins. */
const inFlight = new Map<string, Set<string>>()
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Map<string, Set<() => void>>()
/** Owners whose last `linkRanges` queued (or joined) a question. */
const asked = new Set<string>()

const key = (cwd: string, path: string): string => `${cwd}\n${path}`

/** A hit, null when it is known to name nothing, undefined when unknown. */
export function knownPath(cwd: string, path: string): PathHit | null | undefined {
  const e = cache.get(key(cwd, path))
  if (!e) return undefined
  if (!e.hit && Date.now() - e.at > NO_TTL_MS) return undefined
  return e.hit
}

/** `fn` runs when a path `owner` asked about turns out to exist. */
export function onPathsFound(owner: string, fn: () => void): () => void {
  let set = listeners.get(owner)
  if (!set) listeners.set(owner, (set = new Set()))
  set.add(fn)
  return () => {
    set.delete(fn)
    if (!set.size && listeners.get(owner) === set) listeners.delete(owner)
  }
}

/**
 * Whether the last `linkRanges` for `owner` left a question open (it queued a
 * path, or joined one already asked). Reading it clears it, so the painter
 * learns per line which lines wait for an answer.
 */
export function takeAsked(owner: string): boolean {
  return asked.delete(owner)
}

function flush(): void {
  timer = undefined
  const ask = termApi().termPathKinds
  const batches = [...queued]
  queued.clear()
  if (!ask) return
  for (const [cwd, byPath] of batches) {
    const list = [...byPath.keys()]
    list.forEach((p) => inFlight.set(key(cwd, p), byPath.get(p) ?? new Set()))
    void ask(cwd, list)
      .then((hits) => {
        if (cache.size > MAX_ENTRIES) cache.clear()
        const wake = new Set<string>()
        const at = Date.now()
        list.forEach((p, i) => {
          const hit = hits?.[i] ?? null
          cache.set(key(cwd, p), { hit, at })
          if (hit) inFlight.get(key(cwd, p))?.forEach((o) => wake.add(o))
        })
        wake.forEach((o) => listeners.get(o)?.forEach((fn) => fn()))
      })
      .catch(() => {})
      .finally(() => list.forEach((p) => inFlight.delete(key(cwd, p))))
  }
}

function request(cwd: string, paths: string[], owner: string): void {
  let byPath = queued.get(cwd)
  for (const p of paths) {
    const flying = inFlight.get(key(cwd, p))
    if (flying) {
      flying.add(owner)
      continue
    }
    if (!byPath) queued.set(cwd, (byPath = new Map()))
    let owners = byPath.get(p)
    if (!owners) byPath.set(p, (owners = new Set()))
    owners.add(owner)
  }
  if (byPath && byPath.size && timer === undefined) timer = setTimeout(flush, BATCH_MS)
}

/**
 * The path candidates in `text` that are not inside a web link, and not a
 * PROMPT: PowerShell's `PS C:\work>` and cmd's `C:\work>` name the folder the
 * shell is in, it always exists, and a link on every prompt line is noise
 * (MEASURED in the first screenshot of this). A path that runs straight into
 * `>` is left alone.
 */
export function pathCandidates(text: string, links = findLinks(text)): PathCandidate[] {
  return findPaths(text).filter(
    (c) => text[c.end] !== '>' && !links.some((l) => c.start < l.end && l.start < c.end)
  )
}

/**
 * Everything in `text` that wears the link colour: the web links, and the
 * paths known to exist from `cwd`. Unknown paths are asked about on the way.
 */
export function linkRanges(
  text: string,
  cwd: string | null,
  /** The session asking: only it hears when one of its paths exists (#167). */
  owner: string = NO_OWNER
): Array<{ start: number; end: number }> {
  asked.delete(owner)
  const links = findLinks(text)
  if (!cwd || !termApi().termPathKinds || !/[\\/.]/.test(text)) return links
  const out: Array<{ start: number; end: number }> = [...links]
  const ask: string[] = []
  for (const c of pathCandidates(text, links)) {
    const k = knownPath(cwd, c.path)
    if (k) out.push(c)
    else if (k === undefined) ask.push(c.path)
  }
  if (ask.length) {
    request(cwd, ask, owner)
    asked.add(owner)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** For tests: forget everything. */
export function resetPathCache(): void {
  cache.clear()
  queued.clear()
  inFlight.clear()
  listeners.clear()
  asked.clear()
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}
