import { describe, expect, it } from 'vitest'
import { droppedKind } from './droppedKind'

describe('droppedKind (audit #23)', () => {
  const none = async (): Promise<null> => null
  it('trusts a stat the grants allow', async () => {
    expect(await droppedKind('C:\\a', { stat: async () => ({ isFolder: true }), probe: none })).toBe('folder')
    expect(await droppedKind('C:\\a.txt', { stat: async () => ({ isFolder: false }), probe: none })).toBe('file')
  })
  it('asks a read when the path is outside the grants', async () => {
    expect(await droppedKind('C:\\Desktop\\d', { stat: none, probe: async () => ({}) })).toBe('folder')
    expect(await droppedKind('C:\\Desktop\\f.png', { stat: none, probe: none })).toBe('file')
  })
  it('never throws', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('x')
    }
    expect(await droppedKind('C:\\x', { stat: boom, probe: boom })).toBe('file')
  })
})