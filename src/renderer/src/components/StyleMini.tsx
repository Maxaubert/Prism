import type { JSX } from 'react'
import { FrostBackdrop } from './FrostBackdrop'
import { mix, paintedAlpha, paletteOf, rgba, type Style } from '../lib/theme'

/** A miniature of the main window in a given style: the card IS the preview. */
export function StyleMini({ st }: { st: Style }): JSX.Element {
  const palette = paletteOf(st.accent)
  const accent = palette[0]
  const paint = palette.length > 1 ? `linear-gradient(90deg, ${palette.join(', ')})` : accent
  const tint = st.material === 'tinted'
  const grad = st.material === 'gradient'
  // Frost, for real: the window paints translucent surfaces over the desktop,
  // so the card does the same - a wallpaper-ish backdrop behind surfaces at the
  // exact alpha the window uses - rather than pretending the style is solid.
  const glassA = paintedAlpha(st)
  const frosted = glassA < 1
  // The same numbers variablesFor uses, so the card's glow matches the window's.
  const washA = st.mode === 'light' ? 0.28 : 0.22
  // The real gradient runs down the chrome from a lightened bg (variablesFor);
  // the viewer stays flat. It was drawn from `side`, and only on the panel.
  const gradBg = `linear-gradient(180deg, ${mix(st.bg, '#ffffff', 0.06)}, ${st.bg})`
  const side = tint
    ? mix(st.side, accent, 0.1)
    : grad
      ? gradBg
      : frosted
        ? rgba(st.side, glassA)
        : st.side
  const title = tint ? mix(st.title, accent, 0.12) : grad ? gradBg : frosted ? rgba(st.title, glassA) : st.title
  const bg = tint ? mix(st.bg, accent, 0.07) : frosted ? rgba(st.bg, glassA) : st.bg
  const dim = mix(st.text, st.side, 0.5)
  const line = (w: string, c: string): JSX.Element => (
    <span className="block h-[3px] rounded-[2px]" style={{ width: w, background: c }} />
  )
  return (
    <div
      className="relative flex h-[104px] flex-col overflow-hidden rounded-md"
      style={{ border: '1px solid var(--p-divider)' }}
    >
      {frosted && <FrostBackdrop />}
      {st.wash && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          style={{
            backgroundImage:
              `radial-gradient(58% 56% at 20% 22%, ${rgba(palette[0], washA)}, transparent 72%),` +
              ` radial-gradient(54% 52% at 80% 78%, ${rgba(palette[1] ?? palette[0], washA * 0.9)}, transparent 72%)`
          }}
        />
      )}
      <div
        className="relative flex h-[9px] shrink-0 items-center gap-[3px] px-1.5"
        style={{ background: title }}
      >
        <span className="h-[2.5px] w-[2.5px] rounded-[1px]" style={{ background: accent }} />
        {line('30%', rgba(st.text, 0.5))}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <div className="flex w-[36%] flex-col gap-[3px] p-1.5" style={{ background: side }}>
          {line('62%', rgba(dim, 0.6))}
          {line('80%', rgba(st.text, 0.5))}
          <span
            className="block h-[3px] rounded-[2px]"
            style={{ width: '72%', background: paint }}
          />
          {line('86%', rgba(st.text, 0.3))}
          {line('68%', rgba(st.text, 0.3))}
        </div>
        <div className="relative flex-1" style={{ background: bg }}>
          <div className="absolute left-1/2 top-1/2 h-[46%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-[linear-gradient(140deg,#7d1f2a,#b03a2e_45%,#2c3e63)]" />
          <div
            className="absolute inset-x-2 bottom-1.5 h-[2.5px] rounded-[2px]"
            style={{ background: rgba(st.text, 0.18) }}
          >
            <span className="block h-full w-[44%] rounded-[2px]" style={{ background: paint }} />
          </div>
        </div>
      </div>
    </div>
  )
}
