import type { JSX, ReactNode } from 'react'

/** A line over the whole stage when the media cannot show (an error, a score
 *  being synthesised). Centred, padded; the caller's `className` sets the
 *  layer, the ground and the ink, which differ on purpose per viewer. */
export function StageNotice({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return (
    <div className={`absolute inset-0 grid place-items-center p-8 text-center${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
