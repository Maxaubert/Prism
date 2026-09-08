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
