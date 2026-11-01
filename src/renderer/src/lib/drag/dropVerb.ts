/**
 * THE ONE DROP RULE (#70; owner approved the spec "as recommended",
 * 2026-11-01: docs/superpowers/specs/2026-11-01-drag-move-spec.md).
 *
 * Windows' rule, everywhere in the Explorer: a plain drag MOVES on the same
 * drive and COPIES to another (D2, D3: a zip's drive is its outer file's);
 * Ctrl copies, Shift moves (D1). Ctrl and Shift together are Windows'
 * shortcut, which Prism does not make, so the plain rule holds. Onto a zip
 * or a place inside one, rows are ADDED (a move bins the originals, as
 * decided 2026-08-22; a copy leaves them). Zip members onto a real folder are
 * extracted, onto another folder of their own zip moved inside it (Ctrl is
 * ignored there, D10), onto another zip copied into it (D9). Anything that
 * would be refused is 'none' on hover (G6); main still has the final say.
 *
 * Every target asks this on hover, for the word under the carried row, and
 * the drop asks it again with the same keys, so the word shown and the thing
 * done can never differ.
 */
import { containerCandidates, innerOf, within } from '@shared/archivePlace'
import type { ArchiveMeta } from '@shared/types'
import { extOf, isInside, parentDir, samePath, volumeOf } from '@shared/path'
import type { DragPayload } from './dragDrop'

export type DropVerb =
  | 'move'
  | 'copy'
  | 'add-move'
  | 'add-copy'
  | 'extract'
  | 'move-inside'
  | 'zip-to-zip'
  | 'none'

export interface DropKeys {
  ctrl: boolean
  shift: boolean
}

/** A drop target inside an archive, or the archive itself. */
export interface DropArchive {
  /** The innermost container's real file, when known (a listing's meta, or
   *  a zip on disk); null for a nested one guessed from its path. */
  container: string | null
  /** The innermost container's root as the Explorer spells it. */
  base: string
  /** The outermost container on disk: its drive is the zip's (D3). */
  outer: string
  /** Where the target is inside the container, '' at its root. */
  inner: string
  /** No writes: a 7-Zip format, a nested zip, or one over adm-zip's cap. */
  readOnly: boolean
}

export interface DropTarget {
  /** The folder (or zip, or place inside one) the drop lands in. */
  dir: string
  archive?: DropArchive | null
}

/**
 * The archive a target is in, if any. A listing knows its own (`meta`) and is
 * believed for a place inside it; anything else is read from the path: a
 * `.zip` is writable, a 7z, rar or any zip inside a zip is not (D6). Main
 * decides at the drop by its own listing; this only has to make the hover
 * honest.
 */
export function archiveTarget(
  dir: string,
  meta?: Pick<ArchiveMeta, 'container' | 'base' | 'outer' | 'readOnly'> | null
): DropArchive | null {
  const found = containerCandidates(dir)
  if (meta && within(meta.base, dir) && !found.some((c) => isInside(meta.base, c))) {
    return {
      container: meta.container,
      base: meta.base,
      outer: meta.outer,
      inner: innerOf(meta.base, dir) ?? '',
      readOnly: meta.readOnly
    }
  }
  const base = found[found.length - 1]
  if (!base) return null
  const nested = found.length > 1
  return {
    container: nested ? null : base,
    base,
    outer: found[0],
    inner: innerOf(base, dir) ?? '',
    readOnly: nested || extOf(base) !== '.zip'
  }
}

const cleanInner = (p: string): string => p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
const innerParent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** Ctrl copies, Shift moves, otherwise the drive decides. An unknown volume
 *  counts as the same one. */
function copies(source: string, dest: string, keys: DropKeys): boolean {
  if (keys.ctrl !== keys.shift) return keys.ctrl
  const from = volumeOf(source)
  const to = volumeOf(dest)
  return !!from && !!to && from !== to
}

/** Members of the zip this target is in. */
function ownZip(payload: Extract<DragPayload, { kind: 'members' }>, arc: DropArchive): boolean {
  if (arc.container && samePath(arc.container, payload.archive)) return true
  const place = payload.places?.[0]
  const entry = payload.entries[0]
  return !!place && entry !== undefined && innerOf(arc.base, place) === cleanInner(entry)
}

export function dropVerb({
  payload,
  target,
  keys
}: {
  payload: DragPayload | null
  target: DropTarget
  keys: DropKeys
}): DropVerb {
  if (!payload) return 'none'
  const arc = target.archive ?? null
  if (payload.kind === 'members') {
    if (!payload.entries.length) return 'none'
    if (!arc) return 'extract'
    if (arc.readOnly) return 'none'
    if (!ownZip(payload, arc)) return 'zip-to-zip'
    const dest = cleanInner(arc.inner)
    const entries = payload.entries.map(cleanInner)
    // A folder onto itself or below it, or members already where they are.
    if (entries.some((e) => dest === e || dest.startsWith(e + '/'))) return 'none'
    if (entries.every((e) => innerParent(e) === dest)) return 'none'
    return 'move-inside'
  }
  // From Windows: never Prism's to remove, only copied in (#103 D3).
  if (payload.external) return arc ? (arc.readOnly ? 'none' : 'add-copy') : 'copy'
  const paths = payload.paths
  if (!paths.length) return 'none'
  if (arc) {
    if (arc.readOnly) return 'none'
    // A zip cannot take itself, or a folder that holds it.
    if (paths.some((p) => isInside(p, arc.outer, { orEqual: true }))) return 'none'
    return copies(paths[0], arc.outer, keys) ? 'add-copy' : 'add-move'
  }
  if (paths.some((p) => isInside(p, target.dir, { orEqual: true }))) return 'none'
  const copy = copies(paths[0], target.dir, keys)
  // A move into the folder it is in does nothing; a copy there makes
  // "name (2)", Windows' duplicate (G10).
  if (!copy && paths.every((p) => samePath(parentDir(p), target.dir))) return 'none'
  return copy ? 'copy' : 'move'
}

/**
 * The effect a target shows for a verb: the word under the carried row. A
 * drag Windows carries always shows 'copy' (Electron's OS drag offers copy
 * and link, never move, and a 'move' effect would be refused, #103), whatever
 * the drop then does.
 */
export function effectOf(verb: DropVerb, windowsCarried: boolean): 'move' | 'copy' | 'none' {
  if (verb === 'none') return 'none'
  if (windowsCarried) return 'copy'
  return verb === 'move' || verb === 'add-move' || verb === 'move-inside' ? 'move' : 'copy'
}
