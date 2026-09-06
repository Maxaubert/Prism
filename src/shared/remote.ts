/**
 * The phone as a remote (PR4, #107): the wire shapes, pure, shared by main
 * (which validates what a phone POSTs before anything reaches the renderer,
 * and fans the state out over SSE), the renderer (which builds the state from
 * the foreground player and obeys the commands) and the phone page (which
 * draws the state and sends the commands).
 */

/** What the PC's active tab is playing, as the phone sees it. */
export interface RemoteState {
  /** Nothing playable is open in the active tab. */
  empty: boolean
  name: string
  kind: 'video' | 'audio' | ''
  playing: boolean
  cur: number
  dur: number
  /** 0..2: the player goes to 200%. */
  vol: number
  muted: boolean
  rate: number
  canNext: boolean
  canPrev: boolean
}

export type RemoteCmd =
  | { op: 'play' }
  | { op: 'pause' }
  | { op: 'toggle' }
  | { op: 'seek'; to: number }
  | { op: 'step'; by: number }
  | { op: 'next' }
  | { op: 'prev' }
  | { op: 'volume'; to: number }
  | { op: 'mute' }

/** A step further than ten minutes either way is a seek, not a step. */
const STEP_MAX = 600
const VOL_MAX = 2
/** The clock moving less than this between two reports is not worth a send. */
const CUR_EPSILON = 0.9

export function emptyState(): RemoteState {
  return {
    empty: true,
    name: '',
    kind: '',
    playing: false,
    cur: 0,
    dur: 0,
    vol: 1,
    muted: false,
    rate: 1,
    canNext: false,
    canPrev: false,
  }
}

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null

/**
 * A command out of a request body, or null for anything that is not one.
 * Only the fields it validated come out, so an extra key in the body never
 * reaches the renderer. Ranges: a seek is not negative, a step is at most
 * ten minutes either way, a volume is 0..2.
 */
export function parseCmd(raw: unknown): RemoteCmd | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  switch (r.op) {
    case 'play':
    case 'pause':
    case 'toggle':
    case 'next':
    case 'prev':
    case 'mute':
      return { op: r.op }
    case 'seek': {
      const to = num(r.to, 0, Number.MAX_VALUE)
      return to === null ? null : { op: 'seek', to }
    }
    case 'step': {
      const by = num(r.by, -STEP_MAX, STEP_MAX)
      return by === null ? null : { op: 'step', by }
    }
    case 'volume': {
      const to = num(r.to, 0, VOL_MAX)
      return to === null ? null : { op: 'volume', to }
    }
    default:
      return null
  }
}

/**
 * Whether `b` is worth sending after `a`: any field but the clock, and the
 * clock only once it has moved more than 0.9s. Playing, the renderer reports
 * once a second anyway; paused, the clock moves only on a seek, which is a
 * change by any measure.
 */
export function stateChanged(a: RemoteState, b: RemoteState): boolean {
  if (a === b) return false
  return (
    a.empty !== b.empty ||
    a.name !== b.name ||
    a.kind !== b.kind ||
    a.playing !== b.playing ||
    a.dur !== b.dur ||
    a.vol !== b.vol ||
    a.muted !== b.muted ||
    a.rate !== b.rate ||
    a.canNext !== b.canNext ||
    a.canPrev !== b.canPrev ||
    Math.abs(a.cur - b.cur) > CUR_EPSILON
  )
}
