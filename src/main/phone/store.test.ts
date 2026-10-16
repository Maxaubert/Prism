import { describe, expect, it } from 'vitest'
import { parseAddress, parseStore, serializeStore } from './store'

describe('phone store', () => {
  it('round-trips and defaults', () => {
    const s = parseStore(
      '{"on":true,"port":47321,"phones":[{"token":"t","name":"n","root":"C:\\\\a","paired":1,"seen":2}]}'
    )
    expect(s.on).toBe(true)
    expect(s.port).toBe(47321)
    expect(s.pairing.phones).toHaveLength(1)
    expect(parseStore('soup')).toEqual({ on: false, port: null, address: null, pairing: { codes: [], phones: [] } })
    expect(parseStore('')).toEqual({ on: false, port: null, address: null, pairing: { codes: [], phones: [] } })
    expect(JSON.parse(serializeStore(s))).toMatchObject({ on: true, port: 47321 })
  })

  it('refuses a port outside the range and a switch that is not a boolean', () => {
    expect(parseStore('{"on":"yes","port":70000}')).toMatchObject({ on: false, port: null })
    expect(parseStore('{"on":true,"port":0}')).toMatchObject({ on: true, port: null })
  })

  it('never writes the codes', () => {
    const s = parseStore('{"on":false,"port":null,"phones":[]}')
    s.pairing.codes.push({ code: 'ABCDEF', start: 'C:\\a', expires: 1 })
    expect(serializeStore(s)).not.toContain('ABCDEF')
    expect(JSON.parse(serializeStore(s))).toEqual({ on: false, port: null, phones: [] })
  })

  it('keeps the address phones use (#406), as an origin only', () => {
    const s = parseStore('{"on":true,"port":47321,"address":"https://prism.example.com/","phones":[]}')
    expect(s.address).toBe('https://prism.example.com')
    expect(JSON.parse(serializeStore(s)).address).toBe('https://prism.example.com')
    expect(JSON.parse(serializeStore({ ...s, address: null }))).not.toHaveProperty('address')
  })

  it('takes http or https with a host and a port, nothing else', () => {
    expect(parseAddress('http://prism.home')).toBe('http://prism.home')
    expect(parseAddress(' https://Prism.Example.com:8443 ')).toBe('https://prism.example.com:8443')
    for (const bad of ['', 'prism.home', 'ftp://x', 'javascript:alert(1)', 'https://u:p@x.com', 'https://x.com/path', 'https://x.com/?q=1', 'https://x.com/#h', 42, null])
      expect(parseAddress(bad)).toBeNull()
  })
})
