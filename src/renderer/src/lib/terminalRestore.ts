/** Restore creates the previously current shell first (with its cwd/resume),
 * then the other slots. Pin indices must use that same order when saved. */
export function terminalRestoreOrder(terms: readonly string[], current?: string): string[] {
  if (!current || !terms.includes(current)) return [...terms]
  return [current, ...terms.filter((id) => id !== current)]
}
