import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { postQuestionShown, sonaraHome } from './sonaraLink'

/** A stand-in Sonara: records each request and answers 200. */
async function fakeSonara(): Promise<{ port: number; got: Array<{ req: IncomingMessage; body: string }>; close: () => void }> {
  const got: Array<{ req: IncomingMessage; body: string }> = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      got.push({ req, body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true,"moved":true}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  return { port, got, close: () => server.close() }
}

let close: (() => void) | undefined
afterEach(() => close?.())

describe('sonaraHome', () => {
  it('is SONARA_HOME, else LOCALAPPDATA\\Sonara, else none', () => {
    expect(sonaraHome({ SONARA_HOME: 'C:\\s', LOCALAPPDATA: 'C:\\l' })).toBe('C:\\s')
    expect(sonaraHome({ LOCALAPPDATA: 'C:\\l' })).toBe(join('C:\\l', 'Sonara'))
    expect(sonaraHome({})).toBeNull()
  })
})

describe('postQuestionShown', () => {
  it('posts the tab and the question to the Sonara in runtime.json', async () => {
    const s = await fakeSonara()
    close = s.close
    const home = mkdtempSync(join(tmpdir(), 'pt-sonara-'))
    writeFileSync(join(home, 'runtime.json'), JSON.stringify({ http_port: s.port, token: 'secret', port: 1 }))
    expect(await postQuestionShown('tab-1', { text: 'Pick a size?' }, { SONARA_HOME: home })).toBe(true)
    expect(await postQuestionShown('tab-1', { review: true }, { SONARA_HOME: home })).toBe(true)
    expect(s.got.map((g) => g.req.url)).toEqual(['/v1/question_shown', '/v1/question_shown'])
    expect(s.got[0].req.headers.authorization).toBe('Bearer secret')
    expect(JSON.parse(s.got[0].body)).toEqual({ host_tab: 'tab-1', text: 'Pick a size?' })
    expect(JSON.parse(s.got[1].body)).toEqual({ host_tab: 'tab-1', review: true })
  })

  it('does nothing without Sonara, and fails quietly when it is gone', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-sonara-'))
    expect(await postQuestionShown('tab-1', { text: 'Q?' }, { SONARA_HOME: home })).toBe(false)
    writeFileSync(join(home, 'runtime.json'), '{not json')
    expect(await postQuestionShown('tab-1', { text: 'Q?' }, { SONARA_HOME: home })).toBe(false)
    // A port nobody listens on.
    const s = await fakeSonara()
    s.close()
    writeFileSync(join(home, 'runtime.json'), JSON.stringify({ http_port: s.port, token: 't' }))
    expect(await postQuestionShown('tab-1', { text: 'Q?' }, { SONARA_HOME: home })).toBe(false)
    expect(await postQuestionShown('', { text: 'Q?' }, { SONARA_HOME: home })).toBe(false)
  })
})
