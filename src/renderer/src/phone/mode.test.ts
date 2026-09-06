import { describe, expect, it } from 'vitest'
import { MODE_KEY, readMode, writeMode } from './mode'

const memory = (): Storage & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return {
    data,
    length: 0,
    clear: () => data.clear(),
    key: () => null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k)
  }
}

describe('the phone mode', () => {
  it('starts in Watch', () => {
    expect(readMode(memory())).toBe('watch')
  })
  it('remembers Remote, and comes back to Watch', () => {
    const s = memory()
    writeMode(s, 'remote')
    expect(s.data.get(MODE_KEY)).toBe('remote')
    expect(readMode(s)).toBe('remote')
    writeMode(s, 'watch')
    expect(readMode(s)).toBe('watch')
  })
  it('reads anything it does not know as Watch', () => {
    const s = memory()
    s.setItem(MODE_KEY, 'sideways')
    expect(readMode(s)).toBe('watch')
  })
  it('survives a storage that throws', () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error('no storage')
      },
      setItem: (): void => {
        throw new Error('no storage')
      }
    }
    expect(readMode(broken)).toBe('watch')
    expect(() => writeMode(broken, 'remote')).not.toThrow()
  })
})
