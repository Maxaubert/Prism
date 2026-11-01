import type { JSX } from 'react'
import type { PhotoInfo } from '@shared/ipcTypes'
import { NO_CAMERA, photoFacts, pixelsOf, type Pixels } from '../../lib/photoFacts'
import { useLoaded } from '../properties/useLoaded'

/**
 * THE I KEY'S PHOTO INFO CARD (#78; owner, 2026-11-01, the image pack spec
 * "approved as recommended"; spec `docs/superpowers/specs/2026-11-01-image-pack-spec.md`).
 *
 * A small card in the stage's top-right corner (D4), clear of the control bar
 * and the zoom readout. It READS ONLY: the same rows as the Properties window,
 * worded once in `lib/photoFacts.ts`. It does not fade with the control bar
 * (you turned it on to read it) and it shows in fullscreen (D6). Main reads
 * the photo from its path (`photoInfo.ts`); `useLoaded` is keyed by the path,
 * so arrowing on never shows the last photo's answer under the next one, and
 * a slow read never holds the picture up: the rows fill in when it arrives.
 * Theme tokens only (the menu's raised ground, divider and dim ink).
 */
export function PhotoInfoCard({ path, px }: { path: string; px: Pixels | null }): JSX.Element {
  const info = useLoaded<PhotoInfo>(path, () => window.prism.photoInfo(path), {})
  const stat = useLoaded(path, () => window.prism.statFile(path), null)
  const facts = photoFacts(info, pixelsOf(px, info), stat ? stat.size : null)
  return (
    <div
      data-photo-info={info === undefined ? 'reading' : 'ready'}
      // Its clicks and wheel are its own: the picture under it does not pan,
      // zoom or open its menu through it, and its text can be selected.
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute right-3 top-3 z-20 w-[min(280px,calc(100%-24px))] select-text rounded-[6px] border border-[color:var(--p-divider)] bg-[var(--p-raised)] px-3 py-2.5 text-[12px] leading-[1.45] text-[var(--p-text)] shadow-[0_10px_28px_rgba(0,0,0,.35)]"
    >
      {facts.line && (
        <div data-photo-info-line className="tabular-nums text-[var(--p-text)]">
          {facts.line}
        </div>
      )}
      {info !== undefined && facts.noCamera && (
        <div data-photo-info-none className={`text-[var(--p-dim)] ${facts.line ? 'mt-1' : ''}`}>
          {NO_CAMERA}
        </div>
      )}
      {info !== undefined && facts.rows.length > 0 && (
        <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 ${facts.line || facts.noCamera ? 'mt-1.5' : ''}`}>
          {facts.rows.map((r) => (
            <div key={r.label} data-photo-info-row={r.label} className="contents">
              <dt className="text-[var(--p-dim)]">{r.label}</dt>
              <dd className="min-w-0 break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
