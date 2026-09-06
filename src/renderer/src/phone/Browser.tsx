import type { JSX } from 'react'

/** Placeholder until Task 7: names the root the phone is paired to. */
export function Browser({ root }: { root: string }): JSX.Element {
  return (
    <div className="p-6" data-phone-browser>
      <p className="opacity-70">Paired to</p>
      <p className="break-all font-semibold">{root}</p>
    </div>
  )
}
