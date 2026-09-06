import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import type { RemoteCmd, RemoteState } from '@shared/remote'
import { formatTime } from '../lib/format'
import { connect, noticeFor, send, shownClock } from './remoteClient'

/** How long a refused command's one line stays on screen. */
const NOTICE_MS = 2000
/** The scrubber is redrawn this often while the PC plays, between reports. */
const TICK_MS = 250
/** A finger on the volume slider sends at most this often; the last value always goes. */
const VOL_THROTTLE_MS = 120
const STEP_S = 10

/**
 * The phone as a remote (2026-09-07, #107). This screen is the PC's state
 * drawn on the phone and nothing else: the file the active tab is playing,
 * its clock, its volume, and the verbs that move them. There is no player
 * here at all (the Browser unmounts its viewer in this mode), so there is
 * ONE clock on screen, the PC's, carried forward between its reports by
 * `shownClock` and corrected by the next one.
 *
 * Every control is 48px tall, a thumb's target rather than a pointer's.
 * A seek is sent ONCE, on release: the scrubber follows the finger while it
 * is down (`drag`) and the PC's clock the rest of the time, since a seek per
 * input event is a hundred POSTs down a slider. The volume goes live but
 * throttled, because volume is something you set by ear and wants to be
 * heard moving. A refused command shows its one line for two seconds and
 * goes; a stream that has dropped says so until it is back.
 */
export function Remote(): JSX.Element {
  // The state and when it arrived, together: the clock is drawn from both.
  const [got, setGot] = useState<{ s: RemoteState; at: number } | null>(null)
  const [down, setDown] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  // Volume follows the finger while it is on the slider, so the thumb does
  // not snap back to the PC's last report a moment before the next one.
  const [volDrag, setVolDrag] = useState<number | null>(null)
  // The wall clock the render draws against: set when a report lands and
  // on every tick while the PC plays, never read during the render itself.
  const [now, setNow] = useState(() => Date.now())
  const noticeTimer = useRef<number | null>(null)

  useEffect(
    () =>
      connect((s) => {
        const at = Date.now()
        setGot({ s, at })
        setNow(at)
      }, setDown),
    []
  )

  const s = got?.s ?? null
  const playing = !!s && !s.empty && s.playing
  useEffect(() => {
    if (!playing) return
    const h = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(h)
  }, [playing])

  const say = useCallback((text: string | null): void => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = null
    setNotice(text)
    if (text)
      noticeTimer.current = window.setTimeout(() => {
        noticeTimer.current = null
        setNotice(null)
      }, NOTICE_MS)
  }, [])
  useEffect(
    () => () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    },
    []
  )

  const command = useCallback(
    (cmd: RemoteCmd): void => {
      void send(cmd).then((status) => say(noticeFor(status)))
    },
    [say]
  )

  // The volume throttle: the first change goes at once, the rest wait for
  // the window, and the value at the window's end goes if it moved. The
  // window is not re-armed after that send, so a finger that keeps moving
  // costs at most two POSTs per window rather than one per input event.
  const volTimer = useRef<number | null>(null)
  const volPending = useRef<number | null>(null)
  const sendVol = useCallback(
    (to: number): void => {
      if (volTimer.current !== null) {
        volPending.current = to
        return
      }
      command({ op: 'volume', to })
      volTimer.current = window.setTimeout(() => {
        volTimer.current = null
        const p = volPending.current
        volPending.current = null
        if (p !== null) command({ op: 'volume', to: p })
      }, VOL_THROTTLE_MS)
    },
    [command]
  )
  useEffect(
    () => () => {
      if (volTimer.current !== null) window.clearTimeout(volTimer.current)
    },
    []
  )

  const empty = !s || s.empty
  const dur = s?.dur ?? 0
  const cur = drag ?? (s ? shownClock(s, got?.at ?? 0, now) : 0)
  const vol = volDrag ?? (s?.muted ? 0 : (s?.vol ?? 1))
  const name = !s ? 'Connecting...' : s.empty ? 'Nothing is playing on the PC' : s.name

  return (
    <div
      className="flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]"
      data-phone-remote
      data-remote-playing={playing ? 'true' : 'false'}
      data-remote-empty={empty ? 'true' : 'false'}
      data-remote-can-next={s?.canNext ? 'true' : 'false'}
      data-remote-can-prev={s?.canPrev ? 'true' : 'false'}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold break-words [overflow-wrap:anywhere]" data-remote-name>
          {name}
        </p>
        <p className="text-xs uppercase tracking-wide opacity-50">
          {down ? 'Reconnecting to the PC...' : s && !s.empty ? `${s.kind} on the PC` : 'On the PC'}
        </p>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-4">
        {/* The one line for a refused command. Always in the layout, so the
            controls under it do not jump when it appears. */}
        <p className="h-5 text-center text-sm text-red-400" role="status" data-remote-notice>
          {notice ?? ''}
        </p>

        <input
          type="range"
          min={0}
          max={dur > 0 ? dur : 1}
          step={0.1}
          value={Math.min(cur, dur > 0 ? dur : 1)}
          disabled={empty || dur <= 0}
          aria-label="Position"
          className="h-12 w-full disabled:opacity-30"
          style={{ accentColor: 'var(--p-accent)' }}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={() => {
            if (drag === null) return
            command({ op: 'seek', to: drag })
            setDrag(null)
          }}
          onKeyUp={() => {
            if (drag === null) return
            command({ op: 'seek', to: drag })
            setDrag(null)
          }}
        />
        <div className="flex justify-between text-xs tabular-nums opacity-70">
          <span data-remote-cur>{formatTime(cur)}</span>
          <span>{formatTime(dur)}</span>
        </div>

        <div className="flex items-center justify-between">
          <Verb
            label="Previous"
            disabled={empty || !s?.canPrev}
            onClick={() => command({ op: 'prev' })}
          >
            <path d="M6 6v12" />
            <path fill="currentColor" d="M18 6l-9 6 9 6z" />
          </Verb>
          <Verb
            label={`Back ${STEP_S} seconds`}
            disabled={empty}
            onClick={() => command({ op: 'step', by: -STEP_S })}
          >
            <path d="M11 4 7 8l4 4" />
            <path d="M7 8h7a5 5 0 1 1 0 10h-3" />
          </Verb>
          <Verb
            label={playing ? 'Pause' : 'Play'}
            disabled={empty}
            big
            onClick={() => command({ op: 'toggle' })}
          >
            {playing ? (
              <>
                <path d="M8 5v14" />
                <path d="M16 5v14" />
              </>
            ) : (
              <path fill="currentColor" d="M7 5l12 7-12 7z" />
            )}
          </Verb>
          <Verb
            label={`Forward ${STEP_S} seconds`}
            disabled={empty}
            onClick={() => command({ op: 'step', by: STEP_S })}
          >
            <path d="m13 4 4 4-4 4" />
            <path d="M17 8h-7a5 5 0 1 0 0 10h3" />
          </Verb>
          <Verb
            label="Next"
            disabled={empty || !s?.canNext}
            onClick={() => command({ op: 'next' })}
          >
            <path d="M18 6v12" />
            <path fill="currentColor" d="M6 6l9 6-9 6z" />
          </Verb>
        </div>

        <div className="flex items-center gap-2">
          <Verb
            label={s?.muted ? 'Unmute' : 'Mute'}
            disabled={empty}
            onClick={() => command({ op: 'mute' })}
          >
            <path fill="currentColor" d="M4 10v4h4l5 4V6L8 10z" />
            {s?.muted ? (
              <path d="m16 9 5 6M21 9l-5 6" />
            ) : (
              <>
                <path d="M16 9a4 4 0 0 1 0 6" />
                <path d="M18.5 6.5a8 8 0 0 1 0 11" />
              </>
            )}
          </Verb>
          {/* 0..200, the PC's own ceiling: two ways to the same place there,
              one here. */}
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={vol}
            disabled={empty}
            aria-label="Volume"
            className="h-12 min-w-0 flex-1 disabled:opacity-30"
            style={{ accentColor: 'var(--p-accent)' }}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolDrag(v)
              sendVol(v)
            }}
            onPointerUp={() => setVolDrag(null)}
            onKeyUp={() => setVolDrag(null)}
          />
          <span
            className="w-12 shrink-0 text-right text-xs tabular-nums opacity-70"
            data-remote-vol
          >
            {Math.round(vol * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}

/** One transport verb: a 48px target with a stroked glyph in it. */
function Verb({
  label,
  disabled,
  big,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  big?: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      className={`grid shrink-0 place-items-center rounded-full active:bg-[var(--p-hover)] disabled:opacity-30 ${
        big ? 'h-16 w-16 bg-[var(--p-accent)] text-white' : 'h-12 w-12'
      }`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        width={big ? 28 : 22}
        height={big ? 28 : 22}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  )
}
