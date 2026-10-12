/** Select a name up to its extension, the way Explorer does, so typing
 *  replaces the name and keeps the extension. A dotfile is all stem. */
export function selectStem(el: HTMLInputElement, name: string): void {
  const dot = name.lastIndexOf('.')
  el.setSelectionRange(0, dot > 0 ? dot : name.length)
}
