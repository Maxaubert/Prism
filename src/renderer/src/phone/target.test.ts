import { describe, expect, it } from 'vitest'
import { readTarget, TARGET_KEY, writeTarget } from './target'

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

describe('the phone target', () => {
  it('starts on the phone itself', () => {
    expect(readTarget(memory())).toBe('phone')
  })
  it('remembers the PC, and comes back to the phone', () => {
    const s = memory()
    writeTarget(s, 'pc')
    expect(s.data.get(TARGET_KEY)).toBe('pc')
    expect(readTarget(s)).toBe('pc')
    writeTarget(s, 'phone')
    expect(readTarget(s)).toBe('phone')
  })
  it('reads anything it does not know as the phone', () => {
    const s = memory()
    s.setItem(TARGET_KEY, 'the television')
    expect(readTarget(s)).toBe('phone')
  })
  it('does not read the old mode key as a target', () => {
    // The Watch / Remote switch this replaces wrote 'remote' under its own
    // key; a phone that was a remote comes back to its own player rather
    // than to a screen it never chose.
    const s = memory()
    s.setItem('prism.phone.mode', 'remote')
    expect(readTarget(s)).toBe('phone')
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
    expect(readTarget(broken)).toBe('phone')
    expect(() => writeTarget(broken, 'pc')).not.toThrow()
  })
})
