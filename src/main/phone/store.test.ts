import { describe, expect, it } from 'vitest'
import { parseStore, serializeStore } from './store'

describe('phone store', () => {
  it('round-trips and defaults', () => {
    const s = parseStore(
      '{"on":true,"port":47321,"phones":[{"token":"t","name":"n","root":"C:\\\\a","paired":1,"seen":2}]}'
    )
    expect(s.on).toBe(true)
    expect(s.port).toBe(47321)
    expect(s.pairing.phones).toHaveLength(1)
    expect(parseStore('soup')).toEqual({ on: false, port: null, pairing: { codes: [], phones: [] } })
    expect(parseStore('')).toEqual({ on: false, port: null, pairing: { codes: [], phones: [] } })
    expect(JSON.parse(serializeStore(s))).toMatchObject({ on: true, port: 47321 })
  })

  it('refuses a port outside the range and a switch that is not a boolean', () => {
    expect(parseStore('{"on":"yes","port":70000}')).toMatchObject({ on: false, port: null })
    expect(parseStore('{"on":true,"port":0}')).toMatchObject({ on: true, port: null })
  })

  it('never writes the codes', () => {
    const s = parseStore('{"on":false,"port":null,"phones":[]}')
    s.pairing.codes.push({ code: 'ABCDEF', root: 'C:\\a', expires: 1 })
    expect(serializeStore(s)).not.toContain('ABCDEF')
    expect(JSON.parse(serializeStore(s))).toEqual({ on: false, port: null, phones: [] })
  })
})
