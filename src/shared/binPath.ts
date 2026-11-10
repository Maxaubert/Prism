/**
 * A PATH THROUGH A WINDOWS RECYCLE BIN FOLDER (Recycle Bin feature, D12 and
 * the owner's phone answer, 2026-11-10). `<drive>\$Recycle.Bin\<SID>\...` holds
 * what people deleted. Prism shows it only through its own bin view, which
 * reads the folder itself and grants the exact `$R` entries it listed; the
 * folder is never a place to grant, browse as a plain path, or hand to the
 * phone. The test is the whole segment, so `my$Recycle.Bin notes` is an
 * ordinary folder. Pure string work, no disk, so every wall can ask it.
 */
export function inBinFolder(p: unknown): boolean {
  return typeof p === 'string' && p.split(/[\\/]+/).some((seg) => seg.toLowerCase() === '$recycle.bin')
}
