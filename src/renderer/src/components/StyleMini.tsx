import { useMemo, type JSX } from 'react'
import { paletteOf, rgba, type Style } from '../lib/theme'
import { miniLook } from '../lib/themes/miniLook'

/**
 * A theme's card preview: a small Explorer, the list most of the time is
 * spent in (owner, 2026-10-06, of five mockups: "E. Explorer this is the
 * style to go with"; research/prism/2026-10-05-settings-no-subtext/
 * style-cards). A breadcrumb on the theme's panel, folders in its folder
 * colour, files in their kind tints, one row marked in its own selection
 * tint, and a progress line in the accent, all on its ground.
 *
 * Every colour is the one the window itself paints (`derive`, `folderIconOf`,
 * `sideGround`), so an edited theme's live card follows the edit. It draws
 * no frame and no desktop of its own: the card round it (`ThemeCard`) owns
 * the edge, the corners, the name band and, for a see-through theme, the
 * frost both the preview and the band are painted over. Sizes are whole
 * pixels and the strokes 2px: finer detail turned to texture at this size,
 * at 100% and at 225% alike.
 */

// The rows: kind, name length, size column (none on a folder). The second
// row is the marked one.
const ROWS: Array<[string, string, string]> = [
  ['folder', '58%', ''],
  ['folder', '70%', ''],
  ['folder', '46%', ''],
  ['image', '64%', '22%'],
  ['video', '52%', '28%'],
  ['audio', '60%', '18%']
]
const MARKED = 1

/** Corners follow the theme, scaled to the card: square Void, round Glacier. */
const ROW_RADIUS: Record<Style['corners'], number> = { '2': 1, '8': 3, '14': 5 }

const FolderIcon = ({ c, w }: { c: string; w: number }): JSX.Element => (
  <svg width={w} height={Math.round(w * 0.78)} viewBox="0 0 10 7.8" preserveAspectRatio="none" aria-hidden>
    <path
      fill={c}
      d="M0 1.4A1.4 1.4 0 0 1 1.4 0h2.4l1.2 1.2h3.6A1.4 1.4 0 0 1 10 2.6v3.8a1.4 1.4 0 0 1-1.4 1.4H1.4A1.4 1.4 0 0 1 0 6.4z"
    />
  </svg>
)

const FileIcon = ({ c }: { c: string }): JSX.Element => (
  <svg width={6} height={8} viewBox="0 0 8 10" preserveAspectRatio="none" aria-hidden>
    <path fill={c} d="M1.2 0h3.6L8 3.2v5.6A1.2 1.2 0 0 1 6.8 10H1.2A1.2 1.2 0 0 1 0 8.8V1.2A1.2 1.2 0 0 1 1.2 0z" />
  </svg>
)

const Bar = ({ w, c }: { w: string; c: string }): JSX.Element => (
  <span className="block h-[2px] min-w-0 rounded-[1px]" style={{ width: w, background: c }} />
)

export function StyleMini({ st, height = 104 }: { st: Style; height?: number }): JSX.Element {
  const look = useMemo(() => miniLook(st), [st])
  const palette = paletteOf(st.accent)
  const radius = ROW_RADIUS[st.corners] ?? 3
  // A shorter preview (onboarding's, 72px) drops the rows that no longer fit
  // rather than squashing them.
  const rows = height >= 100 ? ROWS : ROWS.slice(0, 3)
  return (
    <div className="relative overflow-hidden" style={{ height, background: look.ground }}>
      {/* The breadcrumb, on the theme's panel: the folder, a step back, the
          one you are in. */}
      <div
        className="relative flex h-[15px] items-center gap-1 px-[7px]"
        style={{ background: look.panel, borderBottom: `1px solid ${look.edge}` }}
      >
        <FolderIcon c={look.folder} w={7} />
        <Bar w="22%" c={rgba(look.text, 0.6)} />
        <svg width={4} height={6} viewBox="0 0 4 6" className="shrink-0" aria-hidden>
          <path d="M1 1l2 2-2 2" stroke={look.dim2} fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Bar w="18%" c={look.text} />
      </div>
      <div className="relative flex flex-col gap-px px-[3px] pt-[5px]">
        {rows.map(([k, w, size], i) => {
          const marked = i === MARKED
          return (
            <div
              key={i}
              className="flex h-[11px] items-center gap-1 px-1"
              style={{
                borderRadius: radius,
                ...(marked ? { background: look.tint, boxShadow: `inset 0 0 0 1px ${look.tintLine}` } : {})
              }}
            >
              <span className="grid w-2 shrink-0 place-items-center">
                {k === 'folder' ? <FolderIcon c={look.folder} w={8} /> : <FileIcon c={look.kind(k)} />}
              </span>
              <Bar w={w} c={marked ? look.text : rgba(look.text, 0.55)} />
              <span className="flex-1" />
              {size && <Bar w={size} c={rgba(look.dim, 0.7)} />}
            </div>
          )
        })}
      </div>
      {/* A thin progress line in the accent, on the theme's own track. */}
      <div className="absolute inset-x-[7px] bottom-[6px] h-[2px] rounded-[1px]" style={{ background: look.track }}>
        <span
          className="block h-full w-[30%] rounded-[1px]"
          style={{ background: palette.length > 1 ? `linear-gradient(90deg, ${palette.join(', ')})` : look.accent }}
        />
      </div>
    </div>
  )
}
