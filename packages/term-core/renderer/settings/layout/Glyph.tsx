import type { JSX } from 'react'
import { isSettingIcon, SETTING_ICONS } from './icons'

/** A settings icon: a name from `icons.ts` (or a raw path) as a stroked svg. */
export function Glyph({ name, size = 16, stroke = 1.7 }: { name: string; size?: number; stroke?: number }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d={isSettingIcon(name) ? SETTING_ICONS[name] : name} />
    </svg>
  )
}
