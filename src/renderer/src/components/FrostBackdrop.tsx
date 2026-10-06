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
        // A dusk wallpaper, the approved theme mockup's (#298): warm at the
        // foot, where a card's name band sits, so a see-through band shows it.
        background: 'linear-gradient(170deg, #2b3d86 0%, #6a56b0 34%, #d27c8c 62%, #f3a877 84%, #f8d49a 100%)',
        filter: 'blur(5px) saturate(1.15)',
        transform: 'scale(1.3)'
      }}
    />
  )
}
