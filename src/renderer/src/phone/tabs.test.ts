import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhoneError } from './api'
import { listTabs, switchTab } from './tabs'

/** What the page sent, and what the server answered it with. */
let sent: Array<{ url: string; method: string; body: string | null }>
let reply: { status: number; body: unknown }

beforeEach(() => {
  localStorage.clear()
  sent = []
  reply = { status: 200, body: {} }
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null
    })
    return Promise.resolve(
      new Response(JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json' }
      })
    )
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('the phone tab list', () => {
  it('asks for the open tabs and unwraps them', async () => {
    reply = { status: 200, body: { tabs: [{ root: 'C:\\a', name: 'a', current: true }] } }
    expect(await listTabs()).toEqual([{ root: 'C:\\a', name: 'a', current: true }])
    expect(sent[0].method).toBe('GET')
    expect(sent[0].url).toBe('/api/tabs')
  })

  it('posts the folder to move to, and carries the token', async () => {
    localStorage.setItem('prism.phone.token', 'abc')
    reply = { status: 200, body: { root: 'C:\\b', name: 'b' } }
    expect(await switchTab('C:\\b')).toEqual({ root: 'C:\\b', name: 'b' })
    expect(sent[0].method).toBe('POST')
    expect(sent[0].url).toBe('/api/tab?t=abc')
    expect(sent[0].body).toBe('{"root":"C:\\\\b"}')
  })

  /** A refusal carries the PC's own reason, which is the whole point of the
   *  route: "that folder is not open in Prism any more" is what the phone
   *  shows instead of the dead end it used to. */
  it('turns a refusal into an error carrying the reason', async () => {
    reply = { status: 403, body: { error: 'that folder is not open in Prism any more' } }
    await expect(switchTab('C:\\gone')).rejects.toThrow(/not open in Prism/)
    await expect(switchTab('C:\\gone')).rejects.toBeInstanceOf(PhoneError)
  })
})
