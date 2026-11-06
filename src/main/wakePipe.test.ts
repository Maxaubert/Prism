import { connect } from 'net'
import { randomUUID } from 'crypto'
import { describe, expect, it } from 'vitest'
import { startWakePipe, wakeArgv, wakePipeName } from './wakePipe'

const id = 'a1234567-1234-4567-89ab-123456789abc'

describe('the hotkey pipe (owner, 2026-11-06)', () => {
  it("is named for the profile, as the helper names it (shared vector with PrismShortcut.cs's self-test)", () => {
    expect(wakePipeName('C:\\Users\\Test\\AppData\\Roaming\\Prism\\')).toBe('\\\\.\\pipe\\PrismWake.97cd806fc2bb27c3ec809b7c')
    expect(wakePipeName('c:\\users\\test\\appdata\\roaming\\prism')).toBe(wakePipeName('C:\\Users\\Test\\AppData\\Roaming\\Prism'))
  })

  it('takes only what a second launch could carry', () => {
    expect(wakeArgv(JSON.stringify({ winE: id }), 'P.exe')).toEqual(['P.exe', `--win-e=${id}`])
    expect(wakeArgv(JSON.stringify({ winE: id, browse: 'C:\\a b' }), 'P.exe')).toEqual(['P.exe', `--win-e=${id}`, '--browse=C:\\a b'])
    expect(wakeArgv(JSON.stringify({ winE: '\\\\evil\\pipe' }), 'P.exe')).toBeNull()
    expect(wakeArgv(JSON.stringify({ winE: id, browse: 'relative' }), 'P.exe')).toBeNull()
    expect(wakeArgv('not json', 'P.exe')).toBeNull()
    expect(wakeArgv('null', 'P.exe')).toBeNull()
  })

  it('answers ok for a request it took and no for one it refused', async () => {
    const name = `\\\\.\\pipe\\PrismWakeTest.${randomUUID()}`
    const got: string[][] = []
    const server = startWakePipe({ name, exe: 'P.exe', onRequest: (argv) => (got.push(argv), true) })
    const ask = (line: string): Promise<string> =>
      new Promise((resolve) => {
        const s = connect(name, () => s.write(line))
        let text = ''
        s.on('data', (c) => (text += c.toString()))
        s.on('close', () => resolve(text))
        s.on('error', () => resolve('error'))
      })
    await new Promise((r) => setTimeout(r, 50))
    expect(await ask(JSON.stringify({ winE: id }) + '\n')).toBe('ok\n')
    expect(await ask('{"winE":"x"}\n')).toBe('no\n')
    expect(got).toEqual([['P.exe', `--win-e=${id}`]])
    server.close()
  })
})
