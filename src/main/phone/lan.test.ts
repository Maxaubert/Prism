import { describe, expect, it } from 'vitest'
import { lanAddresses } from './lan'

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
