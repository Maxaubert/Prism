import { describe, expect, it } from 'vitest'
import { lanAddresses, localNetwork } from './lan'

describe('lanAddresses', () => {
  it('lists non-internal IPv4 addresses, private ranges first', () => {
    expect(
      lanAddresses({
        Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        'Wi-Fi': [
          { family: 'IPv6', internal: false, address: 'fe80::1' },
          { family: 'IPv4', internal: false, address: '192.168.1.5' }
        ],
        'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.29.0.1' }],
        Tailscale: [{ family: 'IPv4', internal: false, address: '100.101.102.103' }],
        Gone: undefined
      })
    ).toEqual(['192.168.1.5', '172.29.0.1', '100.101.102.103'])
  })
  it('accepts Node 18 numeric families', () => {
    expect(lanAddresses({ a: [{ family: 4, internal: false, address: '10.0.0.2' }] })).toEqual(['10.0.0.2'])
  })
})

describe('localNetwork (review, 2026-10-14)', () => {
  it('answers the user own network and loopback', () => {
    for (const a of ['127.0.0.1', '::1', '10.0.0.4', '172.16.0.1', '172.31.255.9', '192.168.1.20', '169.254.3.3', '100.101.102.103', '::ffff:192.168.1.20', 'fd12:3456::1', 'fe80::1'])
      expect(localNetwork(a), a).toBe(true)
  })
  it('refuses the internet, and nothing at all', () => {
    for (const a of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '::ffff:8.8.8.8', '2001:db8::1', '2a00:1450::1', '', undefined])
      expect(localNetwork(a), String(a)).toBe(false)
  })
})
