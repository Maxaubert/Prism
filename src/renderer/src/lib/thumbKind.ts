// WHICH ROWS WEAR A PICTURE (zoom grid, Stage 3, 2026-11-09). Photos, camera
// raws, HEIC and films are made by main (the bundled ffmpeg, thumbs.ts). A
// small SVG is drawn by the page from the file itself, since Chromium draws it
// and main never rasterises one. Everything else (PDF, office, ebooks, comics,
// audio, archives, code, text, folders, zip members) keeps its kind icon.
// Main applies the same rule again (`thumbKindOf`), so a row that disagrees
// only gets a null answer.

/** A bigger SVG keeps its icon: the page would parse all of it for a postage stamp. */
export const SVG_MAX_BYTES = 2 * 1024 * 1024

export type ThumbSource = 'main' | 'svg'

interface Candidate {
  isFolder: boolean
  file?: { ext: string; kind: string; size?: number; mtimeMs?: number; member?: true }
}

/**
 * What the mounted rows ask main for, nearest the middle of the window first
 * (the picture the eye is on comes before the overscan at either end). Only
 * `main` pictures are asked; a `skip`ped path (a file still being copied in)
 * is not. `rows` are the mounted rows from `first`.
 */
export function visibleWants(
  rows: ReadonlyArray<{ path: string; isFolder: boolean; file?: Candidate['file'] } | null | undefined>,
  tier: 320 | 640,
  skip?: (path: string) => boolean
): Array<{ path: string; tier: 320 | 640; stamp?: string }> {
  const mid = (rows.length - 1) / 2
  const out: Array<{ path: string; tier: 320 | 640; at: number; stamp?: string }> = []
  rows.forEach((row, i) => {
    if (!row || skip?.(row.path) || thumbSource(row) !== 'main') return
    // Size and date, once they are known: a file that changes gets a new picture.
    const f = row.file
    const stamp = f && f.size !== undefined ? `${f.size}|${f.mtimeMs ?? 0}` : undefined
    out.push({ path: row.path, tier, at: Math.abs(i - mid), stamp })
  })
  out.sort((a, b) => a.at - b.at)
  return out.map(({ path, tier: t, stamp }) => (stamp === undefined ? { path, tier: t } : { path, tier: t, stamp }))
}

export function thumbSource(entry: Candidate): ThumbSource | null {
  const file = entry.file
  if (entry.isFolder || !file || file.member) return null
  const ext = file.ext
  if (ext === '.svgz') return null
  if (ext === '.svg') return file.size !== undefined && file.size <= SVG_MAX_BYTES ? 'svg' : null
  return file.kind === 'image' || file.kind === 'video' ? 'main' : null
}
