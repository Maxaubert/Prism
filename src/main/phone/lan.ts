/**
 * The addresses a phone could reach this machine on (2026-09-06, #104),
 * private ranges first: a Wi-Fi 192.168.x beats a WSL or Hyper-V 172.x, which
 * beats a VPN 100.x. Pure over the shape `os.networkInterfaces()` returns, so
 * the choice is testable without a network; Node 18 reported the family as a
 * number, later Nodes as a string, and both are accepted.
 */
export function lanAddresses(
  ifaces: Record<string, Array<{ family: string | number; internal: boolean; address: string }> | undefined>
): string[] {
  const out: string[] = []
  for (const list of Object.values(ifaces)) {
    for (const a of list ?? []) {
      if (a.internal) continue
      if (a.family !== 'IPv4' && a.family !== 4) continue
      out.push(a.address)
    }
  }
  const rank = (ip: string): number =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  return out.sort((a, b) => rank(a) - rank(b))
}

/**
 * WHO MAY ASK AT ALL (review, 2026-10-14): the server binds every interface,
 * so a port forwarded on the router, or a public IPv6 address, would put the
 * pairing page and the pairing guesses on the internet. Plain HTTP was decided
 * on BECAUSE the bytes never leave the user's own network, so the server
 * answers that network and nothing else: loopback, the private IPv4 ranges,
 * link-local, the 100.64/10 range a VPN like Tailscale hands out, and IPv6
 * unique-local and link-local. An IPv4 address arriving as IPv6 (::ffff:) is
 * read as the IPv4 it is.
 */
export function localNetwork(address: string | undefined): boolean {
  if (!address) return false
  const a = address.toLowerCase().replace(/^::ffff:/, '')
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a)
  if (v4) {
    const [p, q] = [Number(v4[1]), Number(v4[2])]
    return (
      p === 127 ||
      p === 10 ||
      (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) ||
      (p === 169 && q === 254) ||
      (p === 100 && q >= 64 && q <= 127)
    )
  }
  return a === '::1' || /^f[cd][0-9a-f]{0,2}:/.test(a) || /^fe[89ab][0-9a-f]?:/.test(a)
}
