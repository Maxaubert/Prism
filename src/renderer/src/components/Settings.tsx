import { useEffect, type JSX } from 'react'
import { TRANSPORT_STYLES, type TransportStyle } from '../lib/transport'

// The app-wide Settings window: a pop-up overlay opened from the title-bar gear.
// It's built as a stack of sections so more style settings (visualizer style,
// colour scheme, progress-bar colour, …) drop in over time. For now it houses the
// progress-bar (transport) style picker.

/** A small schematic of each transport style, so the picker previews the shape
 *  without spinning up a real player. */
function Mini({ id }: { id: TransportStyle }): JSX.Element {
  const acc = 'var(--color-accent-hi)'
  const box = 'relative h-11 w-full overflow-hidden rounded-md bg-[#0e1016]'
  const dot = <span className="h-2 w-2 rounded-full bg-white/70" />
  // Full-width waveform, like the real transport (bars flex to fill the card).
  const bars = (n: number, h: number, gap: string, bold = false): JSX.Element => (
    <div className={`flex w-full items-center ${gap}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${(bold ? h : h * 0.85) * (0.35 + 0.65 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.19)))}px`,
            background: i / n < 0.42 ? acc : 'rgba(255,255,255,.22)'
          }}
        />
      ))}
    </div>
  )
  const line = (h: number, glow = false): JSX.Element => (
    <div className="relative w-full rounded-full bg-white/20" style={{ height: h }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: '42%', background: acc, boxShadow: glow ? `0 0 6px ${acc}` : undefined }} />
    </div>
  )

  switch (id) {
    case 'edge':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 text-white/70">{dot}<span className="text-[9px]">controls</span></div>
          <div className="absolute inset-x-0 bottom-0">{line(2, true)}</div>
        </div>
      )
    case 'pill':
      return <div className={`${box} flex flex-col justify-center gap-2 px-2`}>{line(7)}<div className="flex gap-1.5">{dot}{dot}</div></div>
    case 'inline':
      return <div className={`${box} flex items-center gap-1.5 px-2`}>{dot}<div className="flex-1">{line(3)}</div>{dot}</div>
    case 'island':
      return (
        <div className={`${box} grid place-items-center`}>
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.06] px-2 py-1">{dot}<div className="w-14">{line(3)}</div></div>
        </div>
      )
    case 'wave':
      return <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}><div className="h-4">{bars(52, 16, 'gap-[1.5px]')}</div><div className="flex gap-1.5">{dot}{dot}</div></div>
    case 'outline':
      return (
        <div className={box}>
          <div className="absolute inset-x-2 top-2">{line(2, true)}</div>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border border-white/70" /><span className="h-2.5 w-2.5 rounded-full border border-white/70" />
          </div>
        </div>
      )
    case 'bold':
      return (
        <div className={box}>
          <div className="absolute inset-x-0 top-0">{line(4)}</div>
          <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2"><span className="h-4 w-4 rounded bg-[var(--color-accent-hi)]" /><span className="text-[10px] font-semibold text-white/80">0:41</span></div>
        </div>
      )
    case 'segments':
      return (
        <div className={`${box} flex flex-col justify-center gap-2 px-2`}>
          <div className="flex gap-[3px]">{Array.from({ length: 16 }).map((_, i) => <span key={i} className="h-1.5 flex-1 rounded-[2px]" style={{ background: i < 7 ? acc : 'rgba(255,255,255,.14)' }} />)}</div>
          <div className="flex gap-1.5">{dot}{dot}</div>
        </div>
      )
    case 'wavebold':
      return (
        <div className={`${box} flex flex-col justify-center gap-1.5 px-2`}>
          <div className="h-5">{bars(40, 20, 'gap-[2px]', true)}</div>
          <div className="flex items-center gap-2"><span className="h-4 w-4 rounded bg-[var(--color-accent-hi)]" /><span className="text-[10px] font-semibold text-white/80">0:41</span></div>
        </div>
      )
    case 'slim':
    default:
      return <div className={box}><div className="absolute inset-x-0 top-0">{line(3)}</div><div className="absolute inset-x-2 bottom-2 flex gap-1.5">{dot}{dot}</div></div>
  }
}

export function Settings({
  open,
  onClose,
  transportStyle,
  onPickTransport
}: {
  open: boolean
  onClose: () => void
  transportStyle: TransportStyle
  onPickTransport: (s: TransportStyle) => void
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" onMouseDown={onClose}>
      <div
        className="flex max-h-[82vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#171a23] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[.07] px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-white">Settings</h2>
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-dim)] hover:bg-white/10 hover:text-white"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <section>
            <div className="mb-0.5 text-[13px] font-semibold text-white">Progress bar</div>
            <p className="mb-3 text-[12px] text-[var(--color-dim)]">The look of the player's transport. Colour is a separate setting (coming soon).</p>
            <div className="grid grid-cols-2 gap-2.5">
              {TRANSPORT_STYLES.map((s) => {
                const active = s.id === transportStyle
                return (
                  <button
                    key={s.id}
                    onClick={() => onPickTransport(s.id)}
                    className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition ${
                      active
                        ? 'border-[var(--color-accent-hi)] bg-[var(--color-accent)]/12'
                        : 'border-white/10 bg-white/[.02] hover:border-white/20 hover:bg-white/[.05]'
                    }`}
                  >
                    <Mini id={s.id} />
                    <div className="flex items-baseline justify-between">
                      <span className={`text-[12.5px] font-semibold ${active ? 'text-white' : 'text-[#d7dae1]'}`}>{s.name}</span>
                      {active && <span className="text-[10px] font-semibold text-[var(--color-accent-hi)]">Selected</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
