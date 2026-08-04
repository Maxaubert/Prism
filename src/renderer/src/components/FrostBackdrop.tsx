import type { JSX } from 'react'

/**
 * What the desktop might look like through the glass, for the little style
 * previews: a translucent style paints its surfaces over this instead of
 * pretending to be solid. Blurred past recognition on purpose - it stands for
 * "your wallpaper", not a scene. The parent needs `relative overflow-hidden`,
 * and the surfaces above it need `relative` so they stack on top.
 */
export function FrostBackdrop(): JSX.Element {
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background: 'linear-gradient(130deg, #3f7fd9 0%, #7c5cd6 48%, #2ea3a0 100%)',
        filter: 'blur(6px) saturate(1.15)',
        transform: 'scale(1.35)'
      }}
    />
  )
}
