/**
 * THE PAGE'S CLIPBOARD IS MAIN'S FAKE UNDER --e2e (#356). Every Copy path,
 * Copy name and copied link in the app writes through `navigator.clipboard`,
 * which is the owner's real Windows clipboard; the e2e runs while they work.
 * The preload hands over `e2eClipboard` only under --e2e, and then this
 * replaces `navigator.clipboard` with one that reads and writes main's
 * in-memory clipboard (`main/e2eClipboard.ts`), the same one the harness
 * reads. Imported by `renderApp.tsx` before anything can copy.
 */
const bridge = (
  window as unknown as {
    prism?: { e2eClipboard?: { readText(): Promise<string>; writeText(t: string): Promise<void> } }
  }
).prism?.e2eClipboard

if (bridge) {
  const fake = {
    readText: () => bridge.readText(),
    writeText: (text: string) => bridge.writeText(String(text)),
    read: () => Promise.reject(new Error('the e2e clipboard holds text only')),
    write: () => Promise.reject(new Error('the e2e clipboard holds text only')),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  }
  Object.defineProperty(navigator, 'clipboard', { value: fake, configurable: true })
}

export {}
