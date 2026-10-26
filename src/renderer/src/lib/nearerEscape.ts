/**
 * WHETHER SOMETHING NEARER OWNS ESCAPE (review of #330). The Explorer's list
 * takes a plain Escape to clear the marks, and something is nearly always
 * marked (the open file is), so it would take almost every Escape and stop it
 * there. What closes on Escape from a window listener would then stay open:
 * the PDF find bar (it carries `data-owns-escape`, App's own signal to stand
 * down), a menu, a dialog. While any of them is up the list leaves Escape
 * alone; Ctrl+Shift+A still clears.
 */
export function nearerEscape(doc: Pick<Document, 'querySelector'> = document): boolean {
  return !!doc.querySelector('[data-owns-escape]')
}
