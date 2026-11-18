import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { DriveDetails, FolderBreakdown } from '@shared/props'
import {
  donutBytes,
  donutSlices,
  folderRing,
  sharePercent,
  usedFraction,
  type DonutSlice
} from '../../lib/donut'
import { OverlayScrollbar } from '../browse/OverlayScrollbar'
import '../browse/browse.css'
import './donut.css'
import { hiddenTitle } from 'prism-term-core/renderer/lib/hiddenTitle'

/** The ring (spec: 150px, 20px ring) and the gap between two slices. */
const SIZE = 150
const STROKE = 20
const HOT_STROKE = STROKE + 6
const GAP = 2
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

/** Where the pointer is hovering, and which side of the pair it came from. */
type Hot = { index: number; from: 'slice' | 'row' }
type Tip = { index: number; x: number; y: number }
/** A folder walked into from the drive's ring. */
type Step = { path: string; name: string }
/** A folder's answer: still reading, the index's breakdown, or none. */
type Answer = FolderBreakdown | null | 'reading'

/** Typing in a field is never a way back. */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

/**
 * THE DRIVE'S DONUT AND ITS LEGEND (owner, 2026-10-12, round 2 layout 1:
 * "the legend scrolls beside the donut"). The ring is the drive's top-level
 * folders from the search index, free space the empty track, and the centre
 * says used of total. The legend beside it lists every folder (no Free row,
 * the centre says it) and scrolls in a box as tall as the donut, under
 * Prism's own overlay bar.
 *
 * Slice and row are one thing: hovering either lights both. Hovering a slice
 * also shows a tooltip off the pointer's bottom right (its colour dot, name,
 * size, share) and scrolls its row into view. With no index answer the ring
 * is used against free and the legend says why it is missing.
 *
 * A CLICK GOES IN (owner, 2026-11-17, mockup layout A: "let me click for
 * example users and it then opens a new diagram which shows within that folder
 * what takes up space, then let me redo this over and over, it should also be
 * possible to go back"). A slice or a row shows that folder's own ring: its
 * folders, then its loose files in one grey row, as shares of the folder. The
 * place row above the ring holds Back (also Backspace and Alt+Left), the trail
 * (a crumb jumps there), and Open, which opens the folder on show in the
 * Explorer. At the drive Back is dimmed and there is no Open. The row is there
 * from the start and the legend keeps its height, so the window never jumps.
 */
export function DriveDonut(props: {
  details: DriveDetails
  /** The drive's root, `C:\`. */
  root: string
  onOpenFolder: (path: string) => void
}): JSX.Element {
  const { details, root, onOpenFolder } = props
  const { total, free } = details
  const [trail, setTrail] = useState<Step[]>([])
  const step = trail.at(-1)
  // Each folder is asked for once per window: Back and a crumb are instant.
  const asked = useRef(new Set<string>())
  const [answers, setAnswers] = useState<Record<string, FolderBreakdown | null>>({})
  const answer: Answer | undefined = step
    ? step.path in answers
      ? answers[step.path]
      : 'reading'
    : undefined
  const ready = answer && answer !== 'reading' ? answer : null
  useEffect(() => {
    if (!step || asked.current.has(step.path)) return
    const path = step.path
    asked.current.add(path)
    const ask = window.prism?.folderBreakdown
    void (ask ? ask(path) : Promise.resolve(null))
      .catch(() => null)
      .then((b) => setAnswers((a) => ({ ...a, [path]: b })))
  }, [step])

  const slices: DonutSlice[] | null = step
    ? ready
      ? folderRing(ready, step.name)
      : null
    : details.folders
      ? donutSlices(details.folders, total)
      : null
  /** What the shares are of: the drive, or the folder on show. */
  const whole = step ? ready?.bytes : total
  const [hot, setHot] = useState<Hot | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])
  const backRef = useRef<HTMLButtonElement>(null)

  const used = total !== undefined && free !== undefined ? Math.max(0, total - free) : undefined
  const driveLabel = root.replace(/\\+$/, '')

  // THE LAST ROW FADES rather than being cut (owner, 2026-10-12: "make the
  // last list item fade out instead of being cut"), while rows remain below;
  // scrolled to the end, nothing fades. A DOM flag, not state: a scroll must
  // not re-render the donut.
  const markMore = (): void => {
    const el = legendRef.current
    if (!el) return
    el.toggleAttribute('data-more', el.scrollTop + el.clientHeight < el.scrollHeight - 1)
  }
  useEffect(markMore, [slices?.length, step?.path])

  const go = useCallback((next: Step[]) => {
    setHot(null)
    setTip(null)
    setTrail(next)
    legendRef.current?.scrollTo({ top: 0 })
  }, [])
  const goIn = (s: DonutSlice): void => {
    if (s.files) return
    go([...trail, { path: s.path, name: s.name }])
    // The row clicked is gone with its ring: the keys carry on from Back.
    requestAnimationFrame(() => backRef.current?.focus({ preventScroll: true }))
  }
  const goBack = useCallback(() => {
    if (trail.length) go(trail.slice(0, -1))
  }, [trail, go])

  // Backspace and Alt+Left go up while a folder is on show, before the
  // Explorer behind the window can take them.
  useEffect(() => {
    if (!trail.length) return
    const onKey = (e: KeyboardEvent): void => {
      if (typing(e.target)) return
      if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) {
        e.preventDefault()
        e.stopPropagation()
        goBack()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [trail.length, goBack])

  const enterSlice = (index: number, x: number, y: number): void => {
    setHot({ index, from: 'slice' })
    setTip({ index, x, y })
    rowRefs.current[index]?.scrollIntoView({ block: 'nearest' })
  }
  const leaveSlice = (): void => {
    setHot(null)
    setTip(null)
  }

  const tipSlice = tip && slices ? slices[tip.index] : undefined
  const reading = !!step && answer === 'reading'

  return (
    <>
      <div className="donut-place">
        <button
          type="button"
          ref={backRef}
          className="donut-back"
          data-donut-back
          disabled={!trail.length}
          aria-label="Back"
          {...hiddenTitle('Back')}
          onClick={goBack}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 3.5 5.5 8l4.5 4.5" />
          </svg>
        </button>
        <nav className="donut-crumbs" aria-label="Folder">
          {[{ path: root, name: driveLabel }, ...trail].map((c, i, all) => {
            const last = i === all.length - 1
            return (
              <span key={c.path} className="donut-crumb-wrap">
                {i > 0 && <span className="donut-sep" aria-hidden>›</span>}
                <button
                  type="button"
                  className="donut-crumb"
                  data-donut-crumb
                  aria-current={last ? 'location' : undefined}
                  disabled={last}
                  onClick={() => go(trail.slice(0, i))}
                  {...hiddenTitle(c.name)}
                >
                  {c.name}
                </button>
              </span>
            )
          })}
        </nav>
        {step && (
          <button type="button" className="donut-open" data-donut-open onClick={() => onOpenFolder(step.path)}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
              <path d="M1.75 4.25v8.5h12.5v-7H8L6.5 4.25z" />
            </svg>
            Open
          </button>
        )}
      </div>
      <div className="donut-pair" data-donut-path={step?.path ?? root}>
        <div className="donut-ring" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
            <circle className="donut-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} />
            {slices
              ? slices.map((s, i) =>
                  s.drawn ? (
                    <circle
                      key={s.path || 'files'}
                      className="donut-slice"
                      data-files={s.files || undefined}
                      data-hot={hot?.index === i || undefined}
                      cx={SIZE / 2}
                      cy={SIZE / 2}
                      r={R}
                      stroke={s.color}
                      strokeWidth={hot?.index === i ? HOT_STROKE : STROKE}
                      strokeDasharray={`${Math.max(0, s.fraction * C - GAP)} ${C}`}
                      strokeDashoffset={-s.offset * C}
                      onPointerEnter={(e) => enterSlice(i, e.clientX, e.clientY)}
                      onPointerMove={(e) => setTip({ index: i, x: e.clientX, y: e.clientY })}
                      onPointerLeave={leaveSlice}
                      onClick={() => goIn(s)}
                    />
                  ) : null
                )
              : !step &&
                usedFraction(total, free) > 0 && (
                  <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={R}
                    fill="none"
                    stroke="var(--p-accent)"
                    strokeWidth={STROKE}
                    strokeDasharray={`${usedFraction(total, free) * C} ${C}`}
                  />
                )}
          </svg>
          {step ? (
            <div className="donut-centre">
              {reading ? (
                <span className="donut-reading">Reading…</span>
              ) : ready ? (
                <>
                  <b>{donutBytes(ready.bytes)}</b>
                  <span {...hiddenTitle(`in ${step.name}`)} className="donut-in">
                    in {step.name}
                  </span>
                </>
              ) : (
                <span>No sizes</span>
              )}
            </div>
          ) : (
            used !== undefined &&
            total !== undefined && (
              <div className="donut-centre">
                <b>{donutBytes(used)}</b>
                <span>of {donutBytes(total)}</span>
              </div>
            )
          )}
        </div>
        {slices ? (
          <div className="donut-legend-wrap">
            <div className="donut-legend p-scroll" data-own-scrollbar ref={legendRef} style={{ height: SIZE }} onScroll={markMore}>
              <ul>
                {slices.map((s, i) => (
                  <li key={s.path || 'files'}>
                    {s.files ? (
                      <div
                        className="donut-row"
                        data-files
                        data-hot={hot?.index === i || undefined}
                        onPointerEnter={() => setHot({ index: i, from: 'row' })}
                        onPointerLeave={() => setHot((h) => (h?.from === 'row' ? null : h))}
                      >
                        <span className="donut-name" {...hiddenTitle(s.name)}>
                          <i className="donut-dot" style={{ background: s.color }} />
                          {s.name}
                        </span>
                        <span className="donut-num">{donutBytes(s.bytes)}</span>
                        <span className="donut-num donut-share">{sharePercent(s.bytes, whole)}</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        ref={(el) => {
                          rowRefs.current[i] = el
                        }}
                        className="donut-row"
                        data-hot={hot?.index === i || undefined}
                        onPointerEnter={() => setHot({ index: i, from: 'row' })}
                        onPointerLeave={() => setHot((h) => (h?.from === 'row' ? null : h))}
                        onClick={() => goIn(s)}
                      >
                        <span className="donut-name" {...hiddenTitle(s.name)}>
                          <i className="donut-dot" style={{ background: s.color }} />
                          {s.name}
                          <svg className="donut-chev" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3.5 2 6.5 5l-3 3" />
                          </svg>
                        </span>
                        <span className="donut-num">{donutBytes(s.bytes)}</span>
                        <span className="donut-num donut-share">{sharePercent(s.bytes, whole)}</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {step && slices.every((s) => s.files) && <p className="donut-empty">No folders inside</p>}
            </div>
            <OverlayScrollbar target={legendRef} />
          </div>
        ) : step ? (
          <div style={{ height: SIZE }} aria-hidden={reading}>
            {!reading && <p className="donut-none">The search index has no sizes for this folder</p>}
          </div>
        ) : (
          <p className="donut-none">Folder sizes need the search index</p>
        )}
        {tip &&
          tipSlice &&
          createPortal(<DonutTip slice={tipSlice} tip={tip} total={whole} />, document.body)}
      </div>
    </>
  )
}

/** Fixed at the pointer's bottom right, never in the pointer's way. */
function DonutTip(props: { slice: DonutSlice; tip: Tip; total: number | undefined }): JSX.Element {
  const { slice, tip, total } = props
  return (
    <div className="donut-tip" style={{ left: tip.x + 12, top: tip.y + 18 }} role="tooltip">
      <i className="donut-dot" style={{ background: slice.color }} />
      <b>{slice.name}</b>
      <span>{donutBytes(slice.bytes)}</span>
      <span>{sharePercent(slice.bytes, total)}</span>
    </div>
  )
}
