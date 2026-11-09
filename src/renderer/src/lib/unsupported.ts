// The line the 'other' kind puts on screen. It is here rather than in the
// component because the interesting part is a string decision, not a render:
// naming the extension is friendlier ("Prism can't show ZIP files") but only
// when there is an extension worth naming.

import type { FileKind } from '@shared/types'

/** Longest extension we will shout back at the user. Past this it stops being
 *  an extension and starts being the tail of a filename with a dot in it. */
const MAX_EXT = 8

/**
 * "Prism can't show ZIP files", or a generic line when the extension can't
 * carry the sentence.
 *
 * `extname` hands us whatever follows the last dot, which for `notes.final
 * version` is `.final version` and for a bare `data` is `''`. Neither belongs
 * in that sentence, so anything that isn't a short run of alphanumerics falls
 * back. Accepts the extension with or without its leading dot.
 */
export function unsupportedMessage(ext: string): string {
  const body = ext.startsWith('.') ? ext.slice(1) : ext
  const nameable = body.length > 0 && body.length <= MAX_EXT && /^[a-z0-9]+$/i.test(body)
  return nameable
    ? `Prism can't show ${body.toUpperCase()} files`
    : "Prism can't show this kind of file"
}

/**
 * A DELIBERATE OPEN OF THIS GOES TO WINDOWS (#494; owner, 2026-11-09: "files
 * that cant be opened in prism like exes shoudl be opned like they normally
 * woudl"). Only the kind Prism has no viewer for, and never a member of a zip:
 * that is no file on disk, and the copy of it is Prism's own temp file.
 */
export function goesToWindows(file: { kind: FileKind; member?: true }): boolean {
  return file.kind === 'other' && !file.member
}
