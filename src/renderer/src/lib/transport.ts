// The player's transport (scrub bar + controls) can take one of these shapes,
// chosen in Settings. The look changes; the controls (scrub · play · volume ·
// time · speed, plus fullscreen on video) stay the same. See Transport.tsx.

// Grouped so similar shapes sit together in the picker. `group` drives the
// sub-headings; order within a group is the display order.
export const TRANSPORT_STYLES = [
  { id: 'slim', name: 'Slim', group: 'Line', blurb: 'A thin line as the top edge.' },
  { id: 'pill', name: 'Soft pill', group: 'Line', blurb: 'A thick rounded track.' },
  { id: 'bold', name: 'Bold', group: 'Line', blurb: 'Square button, thicker bar.' },
  { id: 'edge', name: 'Edge', group: 'Line', blurb: 'A hairline pinned to the very bottom.' },
  { id: 'outline', name: 'Outline', group: 'Line', blurb: 'Line-weight icons, glow rail.' },
  { id: 'inline', name: 'Inline', group: 'Compact', blurb: 'Everything on one row.' },
  { id: 'island', name: 'Floating island', group: 'Compact', blurb: 'A rounded glass capsule.' },
  { id: 'wave', name: 'Waveform', group: 'Waveform', blurb: 'The track drawn as a waveform.' },
  { id: 'wavebold', name: 'Waveform bold', group: 'Waveform', blurb: 'Heavier waveform, bold controls.' },
  { id: 'segments', name: 'Segments', group: 'Segmented', blurb: 'Progress as lit ticks.' }
] as const

export const TRANSPORT_GROUPS = ['Line', 'Compact', 'Waveform', 'Segmented'] as const

export type TransportStyle = (typeof TRANSPORT_STYLES)[number]['id']

// Inline is the default (2026-08-20): one row, everything visible, no style
// depends on hover to find the controls. A saved choice always wins.
export const DEFAULT_TRANSPORT_STYLE: TransportStyle = 'inline'
export const TRANSPORT_KEY = 'prism.transport.style'

export function loadTransportStyle(): TransportStyle {
  const v = localStorage.getItem(TRANSPORT_KEY)
  return TRANSPORT_STYLES.some((s) => s.id === v) ? (v as TransportStyle) : DEFAULT_TRANSPORT_STYLE
}
