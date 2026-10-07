import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LONG_WAIT_CHANNELS } from './diagChannels'

// A renamed channel must not leave a stale long-wait entry behind (#322): the
// new name would be timed again and the old one would excuse nothing.
describe('the long-wait channels', () => {
  const main = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const registered = new Set(
    [...main.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)].map((m) => m[1])
  )

  it('are each registered in main', () => {
    expect(registered.size).toBeGreaterThan(50)
    expect(LONG_WAIT_CHANNELS.filter((ch) => !registered.has(ch))).toEqual([])
  })

  it('leave the in-process work timed', () => {
    for (const ch of ['archive:delete', 'archive:add', 'archive:move-members', 'doc:html', 'folder:sizes-cached'])
      expect(LONG_WAIT_CHANNELS, ch).not.toContain(ch)
  })

  it('are listed once', () => {
    expect(new Set(LONG_WAIT_CHANNELS).size).toBe(LONG_WAIT_CHANNELS.length)
  })
})
