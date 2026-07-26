// The player's transport (scrub bar + controls) can take one of these shapes,
// chosen in Settings. The look changes; the controls (scrub · play · volume ·
// time · speed, plus fullscreen on video) stay the same. See Transport.tsx.

export const TRANSPORT_STYLES = [
  { id: 'slim', name: 'Slim', blurb: 'A thin line as the top edge.' },
  { id: 'edge', name: 'Edge', blurb: 'A hairline pinned to the very bottom.' },
  { id: 'pill', name: 'Soft pill', blurb: 'A thick rounded track.' },
  { id: 'inline', name: 'Inline', blurb: 'Everything on one row.' },
  { id: 'island', name: 'Floating island', blurb: 'A rounded glass capsule.' },
  { id: 'wave', name: 'Waveform', blurb: 'The track drawn as a waveform.' },
  { id: 'outline', name: 'Outline', blurb: 'Line-weight icons, glow rail.' },
  { id: 'bold', name: 'Bold', blurb: 'Square button, thicker bar.' },
  { id: 'segments', name: 'Segments', blurb: 'Progress as lit ticks.' },
  { id: 'wavebold', name: 'Waveform bold', blurb: 'Heavier waveform, bold controls.' }
] as const

export type TransportStyle = (typeof TRANSPORT_STYLES)[number]['id']

export const DEFAULT_TRANSPORT_STYLE: TransportStyle = 'slim'
export const TRANSPORT_KEY = 'prism.transport.style'

export function loadTransportStyle(): TransportStyle {
  const v = localStorage.getItem(TRANSPORT_KEY)
  return TRANSPORT_STYLES.some((s) => s.id === v) ? (v as TransportStyle) : DEFAULT_TRANSPORT_STYLE
}
