import { useEffect, type JSX, type ReactNode } from 'react'
import { logSaid } from '../lib/sayCore'

/** A line over the whole stage when the media cannot show (an error, a score
 *  being synthesised). Centred, padded; the caller's `className` sets the
 *  layer, the ground and the ink, which differ on purpose per viewer.
 *  `text` is what it says, in words, for the diagnostics log (#517: every
 *  note the user is shown is logged, owner 2026-11-06), with `op` for the
 *  operation; a notice that is only progress ("Synthesising") leaves it out. */
export function StageNotice({
  className,
  children,
  text,
  op
}: {
  className?: string
  children: ReactNode
  text?: string
  op?: string
}): JSX.Element {
  useEffect(() => {
    if (text) logSaid(text, { op: op ?? 'stage', level: 'warn' })
  }, [text, op])
  return (
    <div className={`absolute inset-0 grid place-items-center p-8 text-center${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}