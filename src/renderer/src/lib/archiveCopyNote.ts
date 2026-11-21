/** What a copy out of a zip says when some members would not come out (audit
 *  #32): the locked ones, then the rest with main's own reason, or null. */
export function archiveCopyNote(locked: number, failed: number, message?: string): string | null {
  const parts: string[] = []
  if (locked)
    parts.push(
      `${locked} of those ${locked === 1 ? 'is' : 'are'} password protected. Open one first to unlock the archive, then copy again.`
    )
  if (failed)
    parts.push(
      `${failed} of those couldn't be copied.${message ? ` ${message}` : ''}`
    )
  return parts.length ? parts.join(' ') : null
}