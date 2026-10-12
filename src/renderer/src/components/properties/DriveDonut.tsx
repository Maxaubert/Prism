import { useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { DriveDetails } from '@shared/props'
import {
  donutBytes,
  donutSlices,
  sharePercent,
  usedFraction,
  type DonutSlice
} from '../../lib/donut'
import { OverlayScrollbar } from '../browse/OverlayScrollbar'
import '../browse/browse.css'
import './donut.css'

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

/**
 * THE DRIVE'S DONUT AND ITS LEGEND (owner, 2026-10-12, round 2 layout 1:
 * "the legend scrolls beside the donut"). The ring is the drive's top-level
 * folders from the search index, free space the empty track, and the centre
 * says used of total. The legend beside it lists every folder (no Free row,
 * the centre says it) and scrolls in a box as tall as the donut, under
 * Prism's own overlay bar.
 *
 * Slice and row are one thing: hovering either lights both, and a click on
 * either opens that folder. Hovering a slice also shows a tooltip off the
 * pointer's bottom right (its colour dot, name, size, share) and scrolls its
 * row into view. With no index answer the ring is used against free and the
 * legend says why it is missing.
 */
export function DriveDonut(props: {
  details: DriveDetails
  onOpenFolder: (path: string) => void
}): JSX.Element {
  const { details, onOpenFolder } = props
  const { total, free } = details
  const slices = details.folders ? donutSlices(details.folders, total) : null
  const [hot, setHot] = useState<Hot | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([])

  const used = total !== undefined && free !== undefined ? Math.max(0, total - free) : undefined

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

  return (
    <div className="donut-pair">
      <div className="donut-ring" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          <circle className="donut-track" cx={SIZE / 2} cy={SIZE / 2} r={R} strokeWidth={STROKE} />
          {slices
            ? slices.map((s, i) =>
                s.drawn ? (
                  <circle
                    key={s.path}
                    className="donut-slice"
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
                    onClick={() => onOpenFolder(s.path)}
                  />
                ) : null
              )
            : usedFraction(total, free) > 0 && (
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
        {used !== undefined && total !== undefined && (
          <div className="donut-centre">
            <b>{donutBytes(used)}</b>
            <span>of {donutBytes(total)}</span>
          </div>
        )}
      </div>
      {slices ? (
        <div className="donut-legend-wrap">
          <div className="donut-legend p-scroll" ref={legendRef} style={{ height: SIZE }}>
            <ul>
              {slices.map((s, i) => (
                <li key={s.path}>
                  <button
                    type="button"
                    ref={(el) => {
                      rowRefs.current[i] = el
                    }}
                    className="donut-row"
                    data-hot={hot?.index === i || undefined}
                    onPointerEnter={() => setHot({ index: i, from: 'row' })}
                    onPointerLeave={() => setHot((h) => (h?.from === 'row' ? null : h))}
                    onClick={() => onOpenFolder(s.path)}
                  >
                    <span className="donut-name" title={s.name}>
                      <i className="donut-dot" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className="donut-num">{donutBytes(s.bytes)}</span>
                    <span className="donut-num donut-share">{sharePercent(s.bytes, total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <OverlayScrollbar target={legendRef} />
        </div>
      ) : (
        <p className="donut-none">Folder sizes need the search index</p>
      )}
      {tip &&
        tipSlice &&
        createPortal(<DonutTip slice={tipSlice} tip={tip} total={total} />, document.body)}
    </div>
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
