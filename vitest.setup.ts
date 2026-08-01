// The renderer's small stores read localStorage the moment they're imported, so
// a test that touches one needs it to exist. This is the whole of it: an
// in-memory Storage, thrown away between runs.

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number {
    return this.data.size
  }
  clear(): void {
    this.data.clear()
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage() })
}

// theme.ts paints onto :root at import time; give it somewhere to paint.
if (typeof globalThis.document === 'undefined') {
  const style = { setProperty: (): void => {} }
  Object.defineProperty(globalThis, 'document', {
    value: { documentElement: { style, dataset: {} } }
  })
}
