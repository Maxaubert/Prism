/**
 * Which of a PDF's annotations Prism will let you click (2026-08-31).
 *
 * This module is the whole security surface of the feature, which is why it
 * is pure and tested with object literals rather than buried in a component.
 *
 * The trap is that pdf.js has ALREADY thrown away the action's name by the
 * time the display side sees an annotation. A `/URI`, a `/Launch` at an
 * executable, a `/GoToR` at a remote file and even a `/JavaScript` action
 * whose script it recognises as a `window.open` all arrive as the same
 * `data.url` string. So "allow Link and URI only" cannot be enforced by
 * name - it has to be enforced by SHAPE: the annotation must be a Link, it
 * must carry none of the fields that mean something other than "go here",
 * and what is left must be an http(s) URL or an in-document destination.
 *
 * `unsafeUrl` is the raw, unvalidated string straight out of the file, and
 * pdf.js sets it whenever anything url-shaped was parsed. Nothing here reads
 * it - not as a fallback, not for a tooltip, not ever.
 *
 * The other half of the boundary lives in the component: these become
 * `<button>` elements, never `<a href>`. An anchor is what routes into main's
 * window-open handler, and a PDF is a file from anywhere.
 */

/** A narrow view of what `getAnnotations` returns, which is typed `any`. */
export interface RawAnnot {
  id?: string
  annotationType?: number
  subtype?: string
  rect?: number[]
  url?: string
  unsafeUrl?: string
  dest?: string | unknown[]
  action?: string
  attachment?: unknown
  attachmentId?: string
  setOCGState?: unknown
  resetForm?: unknown
  actions?: unknown
  newWindow?: boolean
}

/** pdf.js's AnnotationType.LINK. */
const LINK = 2

export type LinkTarget = { kind: 'url'; url: string } | { kind: 'dest'; dest: string | unknown[] }

export interface PdfLink {
  key: string
  /** Percentages of the page box, so the layer is scale-free and the
   *  annotations never have to be re-fetched on a zoom step. */
  left: number
  top: number
  width: number
  height: number
  target: LinkTarget
  /** What the box says on hover: a host, or "Page 12". */
  label: string
}

/**
 * What this annotation is allowed to do, or null for "nothing".
 *
 * Reads as a positive allowlist followed by refusals BY NAME, so that a field
 * nobody thought about defaults to refused rather than to allowed.
 */
export function classifyAnnotation(a: RawAnnot): LinkTarget | null {
  if (a.annotationType !== LINK) return null
  if (a.subtype !== 'Link') return null
  // Named actions (NextPage, PrintDialog...), GoToE embedded files, optional
  // content toggles, ResetForm, and per-annotation JavaScript. A Link with
  // any of these is not the plain "go here" this feature offers.
  if (a.action || a.attachment || a.attachmentId || a.setOCGState || a.resetForm || a.actions) {
    return null
  }
  if (typeof a.url === 'string') {
    // http(s) only. pdf.js's own filter also passes ftp:, mailto: and tel:,
    // and Prism's openExternal drops those silently - a clickable box that
    // does nothing is worse than no box at all.
    return /^https?:\/\//i.test(a.url) ? { kind: 'url', url: a.url } : null
  }
  if (typeof a.dest === 'string' || Array.isArray(a.dest)) return { kind: 'dest', dest: a.dest }
  return null
}

/** The host of an external link, for the hover label. Falls back to the whole
 *  string rather than throwing on something URL() will not parse. */
export function linkLabel(target: LinkTarget): string {
  if (target.kind !== 'url') return 'In this document'
  try {
    return new URL(target.url).host || target.url
  } catch {
    return target.url
  }
}

/**
 * A PDF rect as percentages of the page box.
 *
 * Takes the two corners ALREADY converted to viewport coordinates, so the
 * geometry is testable without a viewport. A rect may be written either way
 * round - the spec only says the two corners are opposite - so both axes are
 * normalised rather than assumed.
 */
export function rectToPercent(
  a: readonly number[],
  b: readonly number[],
  width: number,
  height: number
): { left: number; top: number; width: number; height: number } | null {
  if (!(width > 0) || !(height > 0)) return null
  const [x1, y1] = a
  const [x2, y2] = b
  if (![x1, y1, x2, y2].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const w = Math.abs(x2 - x1)
  const h = Math.abs(y2 - y1)
  // A zero-area rect is a link nobody can hit; a box of 0% would still take
  // the hover, so it is dropped instead.
  if (w <= 0 || h <= 0) return null
  return {
    left: (left / width) * 100,
    top: (top / height) * 100,
    width: (w / width) * 100,
    height: (h / height) * 100
  }
}
