import type { JSX } from 'react'
import type { TransportStyle } from '../../lib/transport'

/** A small schematic of each transport style, so the picker previews the shape
 *  without spinning up a real player. */
export function TransportMini({ id }: { id: TransportStyle }): JSX.Element {
  const acc = 'var(--p-accent-hi)'
  const box =
    'relative h-11 w-full overflow-hidden rounded-md border border-[color:var(--p-divider)] bg-[var(--p-preview)]'
  const dot = <span className="h-2 w-2 rounded-full bg-[var(--p-track)]" />
  const bars = (n: number, h: number, gap: string, bold = false): JSX.Element => (
    <div className={`flex w-full items-center ${gap}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${(bold ? h : h * 0.85) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.19)))}px`,
            background: i / n < 0.42 ? acc : 'var(--p-track)'
          }}
        />
      ))}
    </div>
  )
  const line = (h: number, glow = false): JSX.Element => (
    <div className="relative w-full rounded-full bg-[var(--p-track)]" style={{ height: h }}>
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: '42%', background: acc, boxShadow: glow ? `0 0 6px ${acc}` : undefined }}
      />
    </div>
  )

  switch (id) {
    case 'edge':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 text-[var(--p-dim)]">
            {dot}
            <span className="text-[9px] text-[var(--p-dim)]">controls</span>
          </div>
          <div className="absolute inset-x-0 bottom-0">{line(2, true)}</div>
        </div>
      )
    case 'pill':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          {line(7)}
          <div className="flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
    case 'inline':
      return (
        <div className={`${box} flex items-center gap-1.5 px-2`}>
          {dot}
          <div className="flex-1">{line(3)}</div>
          {dot}
        </div>
      )
    case 'island':
      return (
        <div className={`${box} grid place-items-center`}>
          <div className="flex items-center gap-1.5 rounded-full border border-[color:var(--p-track)] bg-[var(--p-hover)] px-2 py-1">
            {dot}
            <div className="w-14">{line(3)}</div>
          </div>
        </div>
      )
    case 'wave':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-4">{bars(52, 16, 'gap-[1.5px]')}</div>
          <div className="flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
    case 'outline':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-2">{line(2, true)}</div>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--p-track)]" />
            <span className="h-2.5 w-2.5 rounded-full border border-[color:var(--p-track)]" />
          </div>
        </div>
      )
    case 'bold':
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(4)}</div>
          <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-[var(--p-accent-hi)]" />
            <span className="text-[10px] font-semibold text-[var(--p-text-soft)]">0:41</span>
          </div>
        </div>
      )
    case 'segments':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          <div className="flex gap-[3px]">
            {Array.from({ length: 16 }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 flex-1 rounded-[2px]"
                style={{ background: i < 7 ? acc : 'var(--p-track)' }}
              />
            ))}
          </div>
          <div className="flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
    case 'wavebold':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-5">{bars(40, 20, 'gap-[2px]', true)}</div>
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-[var(--p-accent-hi)]" />
            <span className="text-[10px] font-semibold text-[var(--p-text-soft)]">0:41</span>
          </div>
        </div>
      )
    case 'slim':
    default:
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(3)}</div>
          <div className="absolute inset-x-2 bottom-2 flex gap-1.5">
            {dot}
            {dot}
          </div>
        </div>
      )
  }
}
