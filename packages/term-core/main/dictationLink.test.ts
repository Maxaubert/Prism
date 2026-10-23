import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { describe, expect, it } from 'vitest'
import { copyName, linkKey, linkPipe, parseToClient, parseToService, startLinkClient, startLinkService } from './dictationLink'
import type { SendTab } from './orchestratorSend'

/**
 * One dictation for every copy of the app (owner, 2026-10-17): the service
 * asks the other copies for their tabs, and sends or pastes into them. Both
 * ends prove they hold the user's link key first (security review 2026-10-17).
 */

const tab = (over: Partial<SendTab> = {}): SendTab => ({
  id: 'p1',
  tab: 't1',
  label: 'Wind',
  cwd: 'C:\\src\\wind',
  agent: 'claude',
  state: null,
  orchestrator: false,
  session: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  ...over
})
const N = 'a'.repeat(32)
const MAC = 'b'.repeat(64)

describe('the messages', () => {
  it('reads what a client may say, and nothing else', () => {
    expect(parseToService(JSON.stringify({ t: 'hello', pid: 42, name: 'Stable', n: N, mac: MAC }))).toEqual({ t: 'hello', pid: 42, name: 'Stable', n: N, mac: MAC })
    expect(parseToService('{"t":"hello","pid":42,"name":"Stable"}')).toBeNull()
    expect(parseToService(JSON.stringify({ t: 'tabs', rid: 3, tabs: [tab(), { id: 5 }] }))).toEqual({ t: 'tabs', rid: 3, tabs: [tab()] })
    expect(parseToService(JSON.stringify({ t: 'sent', rid: 4, res: { ok: false, reason: 'asking' } }))).toEqual({ t: 'sent', rid: 4, res: { ok: false, reason: 'asking' } })
    expect(parseToService('{"t":"paste","text":"x"}')).toBeNull()
    expect(parseToService('not json')).toBeNull()
  })
  it('reads what the service may say, and caps the text', () => {
    expect(parseToClient(JSON.stringify({ t: 'nonce', n: N }))).toEqual({ t: 'nonce', n: N })
    expect(parseToClient(JSON.stringify({ t: 'proof', mac: MAC }))).toEqual({ t: 'proof', mac: MAC })
    expect(parseToClient('{"t":"tabs?","rid":1}')).toEqual({ t: 'tabs?', rid: 1 })
    expect(parseToClient('{"t":"paste","text":"hi"}')).toEqual({ t: 'paste', text: 'hi' })
    expect(parseToClient(JSON.stringify({ t: 'send', rid: 2, id: 'p1', text: 'x'.repeat(9000) }))).toBeNull()
  })
  it('names a copy by its exe', () => {
    expect(copyName('C:\\Users\\a\\AppData\\Local\\PrismTerminalStable\\PrismTerminalStable.exe')).toBe('Prism Terminal (Stable)')
    expect(copyName('C:\\x\\PrismTerminal.exe')).toBe('Prism Terminal')
    expect(copyName('C:\\x\\node_modules\\electron\\dist\\electron.exe')).toBe('Prism Terminal (Dev)')
  })
})

describe('the link key', () => {
  it('is made once and read back the same, and the pipe is named by its hash, never by it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pt-link-')), 'sub', 'link.key')
    const a = linkKey(file)
    expect(a?.length).toBe(32)
    expect(linkKey(file)?.equals(a!)).toBe(true)
    expect(readFileSync(file, 'utf8')).toMatch(/^[0-9a-f]{64}$/)
    expect(linkPipe(a!)).toMatch(/^\\\\\.\\pipe\\prism-terminal-dictation-[0-9a-f]{24}$/)
    expect(linkPipe(a!)).not.toContain(a!.toString('hex').slice(0, 24))
  })
})

const until = async (f: () => boolean): Promise<void> => {
  for (let i = 0; i < 150 && !f(); i++) await new Promise((r) => setTimeout(r, 20))
}
const pipeName = (): string => `\\\\.\\pipe\\pt-dict-test-${process.pid}-${randomBytes(4).toString('hex')}`
const handlers = (pasted: string[], sent: string[]): Parameters<typeof startLinkClient>[3] => ({
  tabs: async () => [tab({ id: 'r1', label: 'Sonara' })],
  send: async (id, text) => {
    sent.push(`${id}:${text}`)
    return { ok: true, target: tab({ id, label: 'Sonara' }) }
  },
  paste: (t) => pasted.push(t)
})

describe('the pipe', () => {
  it('asks a connected copy for its tabs, sends into one, and forgets it when it closes', async () => {
    const pipe = pipeName()
    const key = randomBytes(32)
    const svc = startLinkService(pipe, key)
    const pasted: string[] = []
    const sent: string[] = []
    let trusted = false
    const client = startLinkClient(pipe, key, { pid: 777, name: 'Stable' }, handlers(pasted, sent), 50, (on) => (trusted = on))
    await until(() => svc.copies().length === 1 && trusted)
    expect(trusted).toBe(true)
    expect(svc.copies()).toEqual([{ pid: 777, name: 'Stable' }])
    expect(await svc.tabs()).toEqual([{ copy: { pid: 777, name: 'Stable' }, tabs: [tab({ id: 'r1', label: 'Sonara' })] }])
    expect(await svc.send(777, 'r1', 'hello')).toEqual({ ok: true, target: tab({ id: 'r1', label: 'Sonara' }) })
    expect(sent).toEqual(['r1:hello'])
    expect(svc.paste(777, 'typed')).toBe(true)
    await until(() => pasted.length === 1)
    expect(pasted).toEqual(['typed'])
    client.close()
    await until(() => svc.copies().length === 0)
    expect(await svc.send(777, 'r1', 'x')).toEqual({ ok: false, reason: 'that copy of the app has closed' })
    svc.close()
  })

  it('drops a client that does not hold the key: it is never listed', async () => {
    const pipe = pipeName()
    const svc = startLinkService(pipe, randomBytes(32))
    const client = startLinkClient(pipe, randomBytes(32), { pid: 9, name: 'Impostor' }, handlers([], []), 50)
    await new Promise((r) => setTimeout(r, 400))
    expect(svc.copies()).toEqual([])
    client.close()
    svc.close()
  })

  it('never answers, types or pastes for a service that does not hold the key', async () => {
    const pipe = pipeName()
    // The impostor: it took the pipe's name, and asks without the key.
    const fake = startLinkService(pipe, randomBytes(32))
    const pasted: string[] = []
    const sent: string[] = []
    let trusted = false
    const client = startLinkClient(pipe, randomBytes(32), { pid: 5, name: 'Stable' }, handlers(pasted, sent), 50, (on) => (trusted = on))
    await new Promise((r) => setTimeout(r, 400))
    expect(trusted).toBe(false)
    // Its client list holds nobody, so it cannot even ask; and a client that
    // got a request before the proof hangs up on it (dictationLink).
    expect(fake.copies()).toEqual([])
    expect(sent).toEqual([])
    expect(pasted).toEqual([])
    client.close()
    fake.close()
  })
})
