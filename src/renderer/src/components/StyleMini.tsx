import { useMemo, type JSX } from 'react'
import { FrostBackdrop } from './FrostBackdrop'
import { derive, folderIconOf, paintedAlpha, paletteOf, rgba, type Style } from '../lib/theme'

/**
 * A style's card preview: a small Explorer, the list most of the time is
 * spent in (owner, 2026-10-06, of five mockups: "E. Explorer this is the
 * style to go with"; research/prism/2026-10-05-settings-no-subtext/
 * style-cards). A breadcrumb, folders in the style's folder colour, files in
 * their kind tints, one row marked in the style's own selection tint, and a
 * progress line in the accent, all on the style's ground. It replaced a
 * window outline round the same red-to-blue square on every card, where only
 * the accent bars changed and Aurora, Void and Onyx read alike.
 *
 * Every colour is the one the window itself paints (`derive`, `folderIconOf`),
 * so an edited style's live card follows the edit. Sizes are whole pixels and
 * the strokes 2px: finer detail turned to texture at this size, at 100% and
 * at 225% alike.
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

/** Corners follow the style, scaled to the card: square Void, round Ruby. */
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

export function StyleMini({ st }: { st: Style }): JSX.Element {
  const look = useMemo(() => {
    const v = derive(st)
    const palette = paletteOf(st.accent)
    const light = st.mode === 'light'
    // Frost, for real: a see-through style paints its ground over the
    // desktop, so the card does too, at the alpha the window uses.
    const glassA = paintedAlpha(st)
    return {
      palette,
      light,
      frosted: glassA < 1,
      ground: glassA < 1 ? rgba(v['--p-bg'], glassA) : v['--p-bg'],
      text: v['--p-text'],
      dim: v['--p-dim'],
      dim2: v['--p-dim2'],
      tint: v['--p-sel-tint'],
      tintLine: v['--p-sel-line'],
      track: v['--p-track'],
      folder: folderIconOf(st),
      kind: (k: string): string => v['--p-kind-' + k],
      edge: rgba(st.text, light ? 0.1 : 0.075),
      paint: palette.length > 1 ? `linear-gradient(90deg, ${palette.join(', ')})` : palette[0],
      radius: ROW_RADIUS[st.corners] ?? 3
    }
  }, [st])
  const washA = look.light ? 0.28 : 0.22
  return (
    <div
      className="relative h-[104px] overflow-hidden rounded-md"
      style={{ border: '1px solid var(--p-divider)', isolation: 'isolate' }}
    >
      {look.frosted && <FrostBackdrop />}
      <div className="absolute inset-0" style={{ background: look.ground }} />
      {st.wash && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              `radial-gradient(58% 56% at 20% 22%, ${rgba(look.palette[0], washA)}, transparent 72%),` +
              ` radial-gradient(54% 52% at 80% 78%, ${rgba(look.palette[1] ?? look.palette[0], washA * 0.9)}, transparent 72%)`
          }}
        />
      )}
      {/* The breadcrumb: the folder, a step back, the one you are in. */}
      <div
        className="relative flex h-[14px] items-center gap-1 px-[7px]"
        style={{ borderBottom: `1px solid ${look.edge}` }}
      >
        <FolderIcon c={look.folder} w={7} />
        <Bar w="22%" c={rgba(look.text, 0.6)} />
        <svg width={4} height={6} viewBox="0 0 4 6" className="shrink-0" aria-hidden>
          <path d="M1 1l2 2-2 2" stroke={look.dim2} fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <Bar w="18%" c={look.text} />
      </div>
      <div className="relative flex flex-col px-[3px] pt-[5px]">
        {ROWS.map(([k, w, size], i) => {
          const marked = i === MARKED
          return (
            <div
              key={i}
              className="flex h-[12px] items-center gap-1 px-1"
              style={{
                borderRadius: look.radius,
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
      {/* A thin progress line in the accent, on the style's own track. */}
      <div className="absolute inset-x-[7px] bottom-[6px] h-[2px] rounded-[1px]" style={{ background: look.track }}>
        <span className="block h-full w-[30%] rounded-[1px]" style={{ background: look.paint }} />
      </div>
    </div>
  )
}
