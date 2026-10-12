import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DCH } from 'prism-term-core/shared/channels'
import { CALL } from '@shared/channels'
import { LONG_WAIT_CHANNELS } from './diagChannels'

// A renamed channel must not leave a stale long-wait entry behind (#322): the
// new name would be timed again and the old one would excuse nothing.
describe('the long-wait channels', () => {
  // Every main source, not only index.ts: since the structure cleanup
  // (2026-10-12) the handlers live in ipc/, windowChrome.ts, phone/ and others.
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(join(dir, e.name))
        : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
          ? [join(dir, e.name)]
          : []
    )
  const main = sources(__dirname)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')
  // Main registers each through the shared table (`CALL.x`, 2026-10-12); the
  // core registers dictation's channels itself (`registerDictationIpc`).
  const registered = new Set<string>([
    ...[...main.matchAll(/ipcMain\.(?:handle|on)\(\s*CALL\.(\w+)/g)].map(
      (m) => CALL[m[1] as keyof typeof CALL]
    ),
    ...Object.values(DCH)
  ])

  it('are each registered in main', () => {
    expect(registered.size).toBeGreaterThan(50)
    expect(LONG_WAIT_CHANNELS.filter((ch) => !registered.has(ch))).toEqual([])
  })

  it('leave the in-process work timed', () => {
    for (const ch of [
      'archive:delete',
      'archive:add',
      'archive:move-members',
      'doc:html',
      'folder:sizes-cached',
      'archive:list',
      'archive:extract',
      'archive:member'
    ])
      expect(LONG_WAIT_CHANNELS, ch).not.toContain(ch)
  })

  it('are listed once', () => {
    expect(new Set(LONG_WAIT_CHANNELS).size).toBe(LONG_WAIT_CHANNELS.length)
  })
})
