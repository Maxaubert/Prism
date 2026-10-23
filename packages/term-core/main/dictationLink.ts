import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { mkdirSync, openSync, readFileSync, writeSync, closeSync } from 'fs'
import { createServer, connect, type Server, type Socket } from 'net'
import { dirname } from 'path'
import type { SendDecision, SendTab } from './orchestratorSend'

/**
 * ONE DICTATION FOR EVERY COPY OF THE APP (owner, 2026-10-17: "when you have
 * two instances of pt open, there should be one dictation engine for both ...
 * it should show all sessions open in one ui from both instances"; spec:
 * docs/superpowers/specs/2026-10-17-one-dictation.md). The copy whose key
 * helper holds the lock runs the dictation (the SERVICE); every other copy is
 * a CLIENT on this pipe: it answers for its own tabs, and pastes or sends
 * into them through its own checked path when the service asks.
 *
 * A local named pipe, one per Windows user; nothing leaves the PC. JSON, one
 * message per line.
 *
 * BOTH ENDS PROVE THEY HOLD THE USER'S LINK KEY before anything else is said
 * (security review 2026-10-17: a process that took the pipe's name first could
 * otherwise pose as the service and have a copy type into its Claude). The key
 * is 32 random bytes in a file under %LOCALAPPDATA% (`linkKey`), which only
 * the user's own account can read; the pipe is named after its hash, never
 * the key. Each side sends a fresh nonce and answers the other's with an HMAC:
 *   service -> client  {t:'nonce', n}
 *   client -> service  {t:'hello', pid, name, n, mac}     mac = HMAC(key, 'client|' + service n + '|' + n)
 *   service -> client  {t:'proof', mac}                   mac = HMAC(key, 'service|' + client n + '|' + service n)
 * A peer that fails is dropped. Then the service asks; a client only answers:
 *   service -> client  {t:'tabs?', rid}            -> {t:'tabs', rid, tabs}
 *   service -> client  {t:'send', rid, id, text}   -> {t:'sent', rid, res}
 *   service -> client  {t:'paste', text}           (into its front tab, no Enter)
 */

export type ToClient =
  | { t: 'nonce'; n: string }
  | { t: 'proof'; mac: string }
  | { t: 'tabs?'; rid: number }
  | { t: 'send'; rid: number; id: string; text: string }
  | { t: 'paste'; text: string }
export type ToService =
  | { t: 'hello'; pid: number; name: string; n: string; mac: string }
  | { t: 'tabs'; rid: number; tabs: SendTab[] }
  | { t: 'sent'; rid: number; res: SendDecision }

const hex = (v: unknown, len: number): v is string => typeof v === 'string' && v.length === len && /^[0-9a-f]+$/.test(v)
const NONCE_HEX = 32
const MAC_HEX = 64
export const nonce = (): string => randomBytes(NONCE_HEX / 2).toString('hex')
export const macOf = (key: Buffer, what: string): string => createHmac('sha256', key).update(what).digest('hex')
function sameMac(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

/**
 * The user's link key: read, or made once (32 random bytes, hex) with the
 * file created exclusively, so two copies starting together agree on one.
 * Null when it can be neither read nor made: then there is no link.
 */
export function linkKey(file: string): Buffer | null {
  const read = (): Buffer | null => {
    try {
      const t = readFileSync(file, 'utf8').trim() // sync-ok: read once as the link starts, a 64-byte file; Prism never starts the link
      return /^[0-9a-f]{64}$/.test(t) ? Buffer.from(t, 'hex') : null
    } catch {
      return null
    }
  }
  const have = read()
  if (have) return have
  try {
    mkdirSync(dirname(file), { recursive: true }) // sync-ok: read once as the link starts, a 64-byte file; Prism never starts the link
    const fd = openSync(file, 'wx') // sync-ok: read once as the link starts, a 64-byte file; Prism never starts the link
    writeSync(fd, randomBytes(32).toString('hex')) // sync-ok: read once as the link starts, a 64-byte file; Prism never starts the link
    closeSync(fd) // sync-ok: read once as the link starts, a 64-byte file; Prism never starts the link
  } catch {
    /* another copy made it first, or it cannot be made */
  }
  return read()
}

/** The pipe's name: the key's hash, never the key. */
export function linkPipe(key: Buffer): string {
  return `\\\\.\\pipe\\prism-terminal-dictation-${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
}

const MAX_LINE = 64 * 1024
const MAX_TEXT = 8000
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const int = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0

function tabOf(v: unknown): SendTab | null {
  const t = v as Partial<SendTab> | null
  if (!t || !str(t.id, 128) || !str(t.tab, 128) || !str(t.label, 256) || !str(t.cwd, 1024)) return null
  const opt = (x: unknown): string | null => (str(x, 256) ? x : null)
  return { id: t.id, tab: t.tab, label: t.label, cwd: t.cwd, agent: opt(t.agent), state: opt(t.state), orchestrator: t.orchestrator === true, session: opt(t.session) }
}

/** A line from a client, checked field by field; anything else is null. */
export function parseToService(line: string): ToService | null {
  if (line.length > MAX_LINE) return null
  let m: Record<string, unknown>
  try {
    m = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  if (m.t === 'hello' && int(m.pid) && str(m.name, 64) && hex(m.n, NONCE_HEX) && hex(m.mac, MAC_HEX)) return { t: 'hello', pid: m.pid, name: m.name, n: m.n, mac: m.mac }
  if (m.t === 'tabs' && int(m.rid) && Array.isArray(m.tabs)) return { t: 'tabs', rid: m.rid, tabs: m.tabs.slice(0, 64).map(tabOf).filter((x): x is SendTab => !!x) }
  if (m.t === 'sent' && int(m.rid) && m.res && typeof m.res === 'object') {
    const r = m.res as Record<string, unknown>
    if (r.ok === true) {
      const target = tabOf(r.target)
      if (target) return { t: 'sent', rid: m.rid, res: { ok: true, target } }
    } else if (str(r.reason, 200)) return { t: 'sent', rid: m.rid, res: { ok: false, reason: r.reason } }
  }
  return null
}

/** A line from the service, checked; anything else is null. */
export function parseToClient(line: string): ToClient | null {
  if (line.length > MAX_LINE) return null
  let m: Record<string, unknown>
  try {
    m = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  if (!m || typeof m !== 'object') return null
  if (m.t === 'nonce' && hex(m.n, NONCE_HEX)) return { t: 'nonce', n: m.n }
  if (m.t === 'proof' && hex(m.mac, MAC_HEX)) return { t: 'proof', mac: m.mac }
  if (m.t === 'tabs?' && int(m.rid)) return { t: 'tabs?', rid: m.rid }
  if (m.t === 'send' && int(m.rid) && str(m.id, 128) && str(m.text, MAX_TEXT)) return { t: 'send', rid: m.rid, id: m.id, text: m.text }
  if (m.t === 'paste' && str(m.text, MAX_TEXT)) return { t: 'paste', text: m.text }
  return null
}

/** A Prism Terminal copy's name in the list (owner, 2026-10-17: "Prism
 *  terminal, and then maybe parentheses two"): the stable copy and a dev run
 *  say which they are; two of the same are numbered by the service. Prism
 *  names itself "Prism". */
export function copyName(execPath: string): string {
  const base = (execPath.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '')
  if (/^PrismTerminalStable$/i.test(base)) return 'Prism Terminal (Stable)'
  if (/^PrismTerminal$/i.test(base)) return 'Prism Terminal'
  return 'Prism Terminal (Dev)'
}

function lines(sock: Socket, onLine: (l: string) => void): void {
  let buf = ''
  sock.setEncoding('utf8')
  sock.on('data', (d: string) => {
    buf += d
    if (buf.length > MAX_LINE * 4) {
      sock.destroy()
      return
    }
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (l.trim()) onLine(l)
    }
  })
}
const write = (sock: Socket, m: ToClient | ToService): void => {
  try {
    sock.write(JSON.stringify(m) + '\n')
  } catch {
    /* gone: its close says so */
  }
}

export interface RemoteCopy {
  pid: number
  name: string
}

/** The service's end: the copies connected now, and asking them. */
export interface LinkService {
  copies(): RemoteCopy[]
  /** Every copy's tabs; a copy that does not answer in time is left out. */
  tabs(timeoutMs?: number): Promise<{ copy: RemoteCopy; tabs: SendTab[] }[]>
  send(pid: number, id: string, text: string, timeoutMs?: number): Promise<SendDecision>
  paste(pid: number, text: string): boolean
  close(): void
}

export function startLinkService(pipe: string, key: Buffer, onError?: (e: unknown) => void): LinkService {
  type Peer = { sock: Socket; copy: RemoteCopy | null; n: string }
  const peers = new Set<Peer>()
  const waits = new Map<number, (m: ToService) => void>()
  let rid = 1
  const server: Server = createServer((sock) => {
    const p: Peer = { sock, copy: null, n: nonce() }
    peers.add(p)
    write(sock, { t: 'nonce', n: p.n })
    // A peer that has not proved itself in a few seconds is not one.
    const timer = setTimeout(() => {
      if (!p.copy) sock.destroy()
    }, 5000)
    timer.unref()
    lines(sock, (l) => {
      const m = parseToService(l)
      if (!m) return
      if (m.t === 'hello') {
        if (p.copy || !sameMac(m.mac, macOf(key, `client|${p.n}|${m.n}`))) return void sock.destroy()
        p.copy = { pid: m.pid, name: m.name }
        write(sock, { t: 'proof', mac: macOf(key, `service|${m.n}|${p.n}`) })
      } else if (p.copy) waits.get(m.rid)?.(m)
    })
    sock.on('close', () => peers.delete(p))
    sock.on('error', () => peers.delete(p))
  })
  server.on('error', (e) => onError?.(e))
  server.listen(pipe)
  const ask = <T>(p: Peer, m: ToClient & { rid: number }, pick: (r: ToService) => T | null, timeoutMs: number, fallback: T): Promise<T> =>
    new Promise((resolve) => {
      const done = (v: T): void => {
        clearTimeout(timer)
        waits.delete(m.rid)
        resolve(v)
      }
      const timer = setTimeout(() => done(fallback), timeoutMs)
      waits.set(m.rid, (r) => {
        const v = pick(r)
        if (v !== null) done(v)
      })
      write(p.sock, m)
    })
  const named = (): Peer[] => [...peers].filter((p) => p.copy)
  return {
    copies: () => named().map((p) => p.copy!),
    tabs: (timeoutMs = 800) =>
      Promise.all(
        named().map(async (p) => ({
          copy: p.copy!,
          tabs: await ask(p, { t: 'tabs?', rid: rid++ }, (r) => (r.t === 'tabs' ? r.tabs : null), timeoutMs, [] as SendTab[])
        }))
      ),
    send: (pid, id, text, timeoutMs = 15000) => {
      const p = named().find((x) => x.copy!.pid === pid)
      if (!p) return Promise.resolve({ ok: false, reason: 'that copy of the app has closed' })
      return ask<SendDecision>(p, { t: 'send', rid: rid++, id, text }, (r) => (r.t === 'sent' ? r.res : null), timeoutMs, {
        ok: false,
        reason: 'that copy of the app did not answer'
      })
    },
    paste: (pid, text) => {
      const p = named().find((x) => x.copy!.pid === pid)
      if (!p) return false
      write(p.sock, { t: 'paste', text })
      return true
    },
    close: () => {
      for (const p of peers) p.sock.destroy()
      peers.clear()
      server.close()
    }
  }
}

export interface ClientHandlers {
  tabs(): Promise<SendTab[]>
  send(id: string, text: string): Promise<SendDecision>
  paste(text: string): void
}

/** A client's end: connects, and keeps trying while it is not the service.
 *  `onState` hears when it is connected to a service and when it is not. */
export function startLinkClient(
  pipe: string,
  key: Buffer,
  me: RemoteCopy,
  h: ClientHandlers,
  retryMs = 1000,
  onState?: (connected: boolean) => void
): { close(): void } {
  let sock: Socket | null = null
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let up = false
  const state = (on: boolean): void => {
    if (on === up) return
    up = on
    onState?.(on)
  }
  const again = (): void => {
    sock = null
    if (!closed) state(false)
    if (!closed && !timer) timer = setTimeout(go, retryMs)
  }
  const go = (): void => {
    timer = null
    if (closed) return
    const s = connect(pipe)
    sock = s
    const mine = nonce()
    let theirs: string | null = null
    let trusted = false
    lines(s, (l) => {
      const m = parseToClient(l)
      if (!m) return
      if (m.t === 'nonce') {
        if (theirs) return void s.destroy()
        theirs = m.n
        write(s, { t: 'hello', pid: me.pid, name: me.name, n: mine, mac: macOf(key, `client|${m.n}|${mine}`) })
        return
      }
      if (m.t === 'proof') {
        // The service holds the key too, or it is not the service.
        if (!theirs || trusted || !sameMac(m.mac, macOf(key, `service|${mine}|${theirs}`))) return void s.destroy()
        trusted = true
        state(true)
        return
      }
      // Nothing is answered, typed or pasted for a peer that has not proved itself.
      if (!trusted) return void s.destroy()
      if (m.t === 'tabs?') void h.tabs().then((tabs) => write(s, { t: 'tabs', rid: m.rid, tabs }), () => write(s, { t: 'tabs', rid: m.rid, tabs: [] }))
      else if (m.t === 'send') void h.send(m.id, m.text).then((res) => write(s, { t: 'sent', rid: m.rid, res }), () => write(s, { t: 'sent', rid: m.rid, res: { ok: false, reason: 'it failed' } }))
      else h.paste(m.text)
    })
    s.on('error', () => {})
    s.on('close', again)
  }
  go()
  return {
    close: () => {
      closed = true
      if (timer) clearTimeout(timer)
      sock?.destroy()
    }
  }
}
