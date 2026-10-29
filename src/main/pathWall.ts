import { extname, isAbsolute, relative, resolve } from 'path'
import { fileKind } from '@shared/fileKind'

/**
 * THE ROOT WALL, in one place (stage 9a of the structure cleanup, 2026-10-12).
 *
 * Every IPC handler that touches a path asks one of these guards, and the
 * fsmedia:// and fsaudio:// protocols ask `mediaAllowed` / `readable`. They
 * used to be closures in the middle of index.ts, with the read check pasted
 * by hand ten times; the rules below are the same rules, word for word, and
 * `pathWall.test.ts` holds each one. A change here is a security decision
 * (CLAUDE.md "Security walls"): never make a guard looser in passing.
 *
 * The wall is built from what it consults, so a test can hand it fakes:
 * `insideDesktop` (a folder the Explorer granted) and `memberOwns` (this run's member
 * temp folder, memberTemp.ts). What it HOLDS is what main granted itself:
 * the extracted members, the files main built (a converted copy, a MIDI wav,
 * a markdown document's pictures), and the comics folder.
 */
export interface WallDeps {
  insideDesktop: (p: string) => boolean
  memberOwns: (p: unknown) => boolean
  /** Where the renderer's own files live (pdf.js fetches its cmaps, fonts,
   *  wasm and icc profiles through fsmedia://). */
  rendererDir: string
}

/** Is `p` strictly below `dir` (never `dir` itself), case-insensitive. A
 *  child literally named `..foo` is refused: that fails closed, and no real
 *  Prism path starts with `..` (audit 2026-10-12). */
export function underDir(dir: string, p: string): boolean {
  const rel = relative(dir.toLowerCase(), resolve(p).toLowerCase())
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

export interface PathWall {
  /** Grant one exact path main unpacked for viewing (archive:extract, a
   *  converted copy, a MIDI wav). Reads honour it; writes never do. */
  grantExtracted(p: string): void
  /** Grant a file main built or a document named, for the media wall only. */
  grantServable(p: string): void
  /** Where comic books are unpacked: granted to the media wall as a DIRECTORY. */
  setComicsDir(dir: string): void
  comicsDir(): string
  /** A path main unpacked itself for viewing: an extracted grant or a file
   *  under this run's member folder. Reads only. */
  extracted(p: unknown): boolean
  /** A READ: inside the wall, or something main extracted itself. */
  readable(p: unknown): p is string
  /** A WRITE in place (rename, bin, save): inside the wall. */
  editable(p: string): boolean
  /** A move or zip SOURCE: inside the wall or extracted (an
   *  extracted member dragged to a folder can be written there). */
  movable(p: unknown): p is string
  /** An archive WRITE verb: the zip sits inside the wall and is the archive
   *  kind. Gates add, move and member delete. */
  archiveOk(p: unknown): p is string
  /**
   * READING an archive, which a WRITE guard cannot answer (2026-09-01).
   *
   * A zip inside a zip is an ordinary thing - a game rip, a backup of a
   * backup - and opening the inner one dead-ended: `archiveOk` demands the
   * wall, and a member Prism has just extracted for viewing lives in temp
   * under an extracted grant instead. This is the same softening the media
   * wall makes and for the same reason: the path is one MAIN ITSELF created
   * and granted a moment ago. Deliberately NOT a widening of `archiveOk`,
   * which also gates add, move and member delete - writes stay inside a
   * root, and a nested archive is read-only by construction anyway.
   */
  archiveReadOk(p: unknown): p is string
  /**
   * A comic book has its OWN guard, not `archiveOk` widened (2026-08-31).
   * Widening that one would put Extract all, Add files and member Delete -
   * the one permanent delete in Prism - onto a comic. The whole reason
   * `.cbz` is not the archive kind is that its verbs are the wrong menu.
   */
  comicOk(p: unknown): p is string
  /** fsmedia:// (2026-08-28): a root, an extracted member, something main
   *  made itself, the app's own asset tree, or the comics folder. */
  mediaAllowed(p: string): boolean
}

export function createPathWall(deps: WallDeps): PathWall {
  const extractedPaths = new Set<string>()
  /**
   * Files main built itself and handed to the renderer as a media url: the
   * converted copy of a video, the wav a MIDI score was rendered to. They live
   * in userData, outside every root, so the media wall has to know about them.
   */
  const servable = new Set<string>()
  /** Granted as a DIRECTORY (2026-08-31): a 200-page book would otherwise put
   *  200 entries into `extractedPaths`, a Set that never shrinks and doubles
   *  as the wall's allowlist. One directory, one rule. */
  let comics = ''

  const extracted = (p: unknown): boolean =>
    typeof p === 'string' && (extractedPaths.has(p) || deps.memberOwns(p))
  const readable = (p: unknown): p is string =>
    typeof p === 'string' && (deps.insideDesktop(p) || extracted(p))

  return {
    grantExtracted: (p) => void extractedPaths.add(p),
    grantServable: (p) => void servable.add(p),
    setComicsDir: (dir) => {
      comics = dir
    },
    comicsDir: () => comics,
    extracted,
    readable,
    editable: (p) => deps.insideDesktop(p),
    movable: (p): p is string =>
      typeof p === 'string' && (deps.insideDesktop(p) || extracted(p)),
    archiveOk: (p): p is string =>
      typeof p === 'string' && deps.insideDesktop(p) && fileKind(extname(p)) === 'archive',
    archiveReadOk: (p): p is string =>
      typeof p === 'string' &&
      (deps.insideDesktop(p) || extracted(p)) &&
      fileKind(extname(p)) === 'archive',
    comicOk: (p): p is string =>
      typeof p === 'string' && deps.insideDesktop(p) && fileKind(extname(p)) === 'comic',
    mediaAllowed: (p) =>
      deps.insideDesktop(p) ||
      extracted(p) ||
      servable.has(p) ||
      underDir(deps.rendererDir, p) ||
      (!!comics && underDir(comics, p))
  }
}
