# Prism on your phone, PR 1: server, pairing, Tools menu, phone page, direct play

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prism serves a phone-sized web page on the LAN; a phone pairs once by QR, browses the tab's folder and plays video, audio and pictures the phone can play natively.

**Architecture:** A Node `http` server in `src/main/phone/` (pure pairing/route logic in their own tested files) reuses `serveMedia` for bytes and `listDir` for folders, walled by the phone's own root with `validRoot`. A second Vite entry (`src/renderer/phone.html`) installs a network shim as `window.prism` and mounts the existing `ImageView`, `VideoView` and `AudioView`. The PC gets a Tools button in the title bar whose Phone dialog holds the switch, the QR, the address and the paired list.

**Tech Stack:** Electron 43 main (Node `http`, `os.networkInterfaces`), React 19 renderer, `qrcode` (new, main), Vitest, the Playwright e2e in `tools/e2e/run.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-06-phone-design.md`

## Global Constraints

- No em-dashes anywhere in code, comments, docs or UI copy.
- Nothing synchronous on main's thread for the phone path: `fs/promises`, `createReadStream`, spawned processes only.
- Every phone route checks `validRoot(phoneRoot, path)` before touching a path; media additionally passes through `serveMedia`'s own `mediaAllowed`.
- Under `--e2e` the server binds `127.0.0.1` only (no firewall prompt for a throwaway build); otherwise `0.0.0.0`.
- Version: `package.json` to `0.38.0` inside this PR. New dependency: `qrcode` + `@types/qrcode` (dev).
- Commits: `type(scope): subject` with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01MGe29Jw7CVa2MjsshPeQPM`.
- Branch: `feat/104-phone-server`, issue #104.

---

### Task 1: Pairing state, pure

**Files:**
- Create: `src/main/phone/pairing.ts`
- Test: `src/main/phone/pairing.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Phone { token: string; name: string; root: string; paired: number; seen: number }
  export interface PairState { codes: Array<{ code: string; root: string; expires: number }>; phones: Phone[] }
  export const CODE_TTL_MS = 2 * 60 * 1000
  export function emptyState(): PairState
  export function issueCode(s: PairState, root: string, now: number, rnd?: () => string): string
  export function redeem(s: PairState, code: string, name: string, now: number, rnd?: () => string): Phone | null
  export function phoneFor(s: PairState, token: string | null | undefined): Phone | null
  export function touch(s: PairState, token: string, now: number): void
  export function forget(s: PairState, token: string): boolean
  export function parseState(raw: string): PairState
  export function serializeState(s: PairState): string
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/phone/pairing.test.ts
import { describe, expect, it } from 'vitest'
import {
  CODE_TTL_MS, emptyState, forget, issueCode, parseState, phoneFor, redeem, serializeState, touch
} from './pairing'

const fixed = (v: string) => () => v

describe('pairing', () => {
  it('issues a 6-character code from the unambiguous alphabet', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 1000)
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    expect(s.codes).toHaveLength(1)
  })

  it('redeems once, within its two minutes, and remembers the root', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 1000, fixed('ABCDEF'))
    const phone = redeem(s, 'abcdef', 'iPhone', 2000, fixed('tok1'))
    expect(phone).toEqual({ token: 'tok1', name: 'iPhone', root: 'C:\\films', paired: 2000, seen: 2000 })
    expect(redeem(s, 'ABCDEF', 'again', 2001)).toBeNull()
    expect(s.codes).toHaveLength(0)
  })

  it('refuses an expired code', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 1000)
    expect(redeem(s, code, 'x', 1000 + CODE_TTL_MS + 1)).toBeNull()
  })

  it('a fresh code for the same root replaces the old one', () => {
    const s = emptyState()
    issueCode(s, 'C:\\films', 1000, fixed('AAAAAA'))
    issueCode(s, 'C:\\films', 1500, fixed('BBBBBB'))
    expect(s.codes.map((c) => c.code)).toEqual(['BBBBBB'])
  })

  it('finds, touches and forgets a phone', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\films', 0)
    const p = redeem(s, code, 'Pixel', 10, fixed('tok'))!
    expect(phoneFor(s, 'tok')).toBe(p)
    expect(phoneFor(s, 'nope')).toBeNull()
    expect(phoneFor(s, undefined)).toBeNull()
    touch(s, 'tok', 99)
    expect(p.seen).toBe(99)
    expect(forget(s, 'tok')).toBe(true)
    expect(forget(s, 'tok')).toBe(false)
    expect(phoneFor(s, 'tok')).toBeNull()
  })

  it('round-trips through JSON and survives a malformed file', () => {
    const s = emptyState()
    const code = issueCode(s, 'C:\\a', 0)
    redeem(s, code, 'p', 1, fixed('t'))
    const back = parseState(serializeState(s))
    expect(back.phones).toEqual(s.phones)
    expect(back.codes).toEqual([]) // codes are never persisted
    expect(parseState('soup')).toEqual(emptyState())
    expect(parseState('{"phones":"no"}')).toEqual(emptyState())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/phone/pairing.test.ts`
Expected: FAIL, cannot resolve `./pairing`.

- [ ] **Step 3: Implement**

```ts
// src/main/phone/pairing.ts
/**
 * Pairing a phone (2026-09-06, #104). The QR carries a six-character code,
 * single-use and two minutes long; the phone trades it for a token it keeps,
 * and the token remembers the ROOT it was paired to (the tab the code was
 * shown from). Pure: the server owns the clock and the randomness.
 */
import { randomBytes } from 'crypto'

export interface Phone {
  token: string
  name: string
  root: string
  paired: number
  seen: number
}

export interface PairState {
  codes: Array<{ code: string; root: string; expires: number }>
  phones: Phone[]
}

export const CODE_TTL_MS = 2 * 60 * 1000

/** No 0/O, 1/I: the code is read off a screen and typed by hand as well as scanned. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomCode(): string {
  const bytes = randomBytes(6)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return out
}

function randomToken(): string {
  return randomBytes(32).toString('hex')
}

export function emptyState(): PairState {
  return { codes: [], phones: [] }
}

/** A new code for `root`, replacing any older code for the same root. */
export function issueCode(s: PairState, root: string, now: number, rnd: () => string = randomCode): string {
  s.codes = s.codes.filter((c) => c.root !== root && c.expires > now)
  const code = rnd()
  s.codes.push({ code, root, expires: now + CODE_TTL_MS })
  return code
}

/** Trade a code for a phone. Null when unknown, spent or expired. */
export function redeem(
  s: PairState,
  code: string,
  name: string,
  now: number,
  rnd: () => string = randomToken
): Phone | null {
  const want = code.trim().toUpperCase()
  const i = s.codes.findIndex((c) => c.code === want)
  if (i < 0) return null
  const [hit] = s.codes.splice(i, 1)
  if (hit.expires <= now) return null
  const phone: Phone = { token: rnd(), name: name.slice(0, 80) || 'Phone', root: hit.root, paired: now, seen: now }
  s.phones.push(phone)
  return phone
}

export function phoneFor(s: PairState, token: string | null | undefined): Phone | null {
  if (!token) return null
  return s.phones.find((p) => p.token === token) ?? null
}

export function touch(s: PairState, token: string, now: number): void {
  const p = phoneFor(s, token)
  if (p) p.seen = now
}

export function forget(s: PairState, token: string): boolean {
  const before = s.phones.length
  s.phones = s.phones.filter((p) => p.token !== token)
  return s.phones.length !== before
}

/** Codes are never persisted: a code that survives a restart is a door left open. */
export function serializeState(s: PairState): string {
  return JSON.stringify({ phones: s.phones }, null, 2)
}

export function parseState(raw: string): PairState {
  try {
    const j = JSON.parse(raw) as { phones?: unknown }
    if (!Array.isArray(j.phones)) return emptyState()
    const phones = j.phones.filter(
      (p): p is Phone =>
        !!p &&
        typeof p === 'object' &&
        typeof (p as Phone).token === 'string' &&
        typeof (p as Phone).name === 'string' &&
        typeof (p as Phone).root === 'string' &&
        typeof (p as Phone).paired === 'number' &&
        typeof (p as Phone).seen === 'number'
    )
    return { codes: [], phones }
  } catch {
    return emptyState()
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/phone/pairing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/phone/pairing.ts src/main/phone/pairing.test.ts
git commit -m "feat(phone): pairing state, pure and tested (#104)"
```

---

### Task 2: Routes and the LAN address, pure

**Files:**
- Create: `src/main/phone/routes.ts`, `src/main/phone/lan.ts`
- Test: `src/main/phone/routes.test.ts`, `src/main/phone/lan.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // routes.ts
  export type Route =
    | { kind: 'static'; file: string }          // '' for index
    | { kind: 'pair' }
    | { kind: 'api'; name: string; query: URLSearchParams }
    | { kind: 'media'; path: string; query: URLSearchParams }
    | { kind: 'none' }
  export function parseRoute(url: string): Route
  export function tokenOf(query: URLSearchParams, auth: string | undefined): string | null
  export function pairLink(address: string, port: number, code: string): string
  // lan.ts
  export function lanAddresses(ifaces: Record<string, Array<{ family: string | number; internal: boolean; address: string }> | undefined>): string[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/phone/routes.test.ts
import { describe, expect, it } from 'vitest'
import { pairLink, parseRoute, tokenOf } from './routes'

describe('parseRoute', () => {
  it('maps the index and static assets', () => {
    expect(parseRoute('/')).toEqual({ kind: 'static', file: '' })
    expect(parseRoute('/?code=ABC')).toEqual({ kind: 'static', file: '' })
    expect(parseRoute('/assets/phone-abc.js')).toEqual({ kind: 'static', file: 'assets/phone-abc.js' })
    expect(parseRoute('/pdf/cmaps/x.bcmap')).toEqual({ kind: 'static', file: 'pdf/cmaps/x.bcmap' })
  })
  it('refuses a path that climbs', () => {
    expect(parseRoute('/assets/../../main/index.js')).toEqual({ kind: 'none' })
    expect(parseRoute('/m/..%5C..%5Cx')).toMatchObject({ kind: 'media', path: '..\\..\\x' }) // the wall decides, not the parser
  })
  it('names the api and pair routes', () => {
    expect(parseRoute('/pair')).toEqual({ kind: 'pair' })
    const r = parseRoute('/api/dir?path=C%3A%5Cfilms&t=abc')
    expect(r.kind).toBe('api')
    if (r.kind === 'api') {
      expect(r.name).toBe('dir')
      expect(r.query.get('path')).toBe('C:\\films')
    }
  })
  it('decodes the media path', () => {
    const r = parseRoute('/m/C%3A%5Cfilms%5Ca%20b.mp4?t=abc')
    expect(r).toMatchObject({ kind: 'media', path: 'C:\\films\\a b.mp4' })
  })
})

describe('tokenOf', () => {
  it('prefers the bearer header, falls back to the query', () => {
    expect(tokenOf(new URLSearchParams('t=q'), 'Bearer h')).toBe('h')
    expect(tokenOf(new URLSearchParams('t=q'), undefined)).toBe('q')
    expect(tokenOf(new URLSearchParams(''), undefined)).toBeNull()
  })
})

describe('pairLink', () => {
  it('is the page with the code in the query', () => {
    expect(pairLink('192.168.1.5', 47320, 'ABCDEF')).toBe('http://192.168.1.5:47320/?code=ABCDEF')
  })
})
```

```ts
// src/main/phone/lan.test.ts
import { describe, expect, it } from 'vitest'
import { lanAddresses } from './lan'

describe('lanAddresses', () => {
  it('lists non-internal IPv4 addresses, private ranges first', () => {
    expect(
      lanAddresses({
        'Loopback': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
        'Wi-Fi': [
          { family: 'IPv6', internal: false, address: 'fe80::1' },
          { family: 'IPv4', internal: false, address: '192.168.1.5' }
        ],
        'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.29.0.1' }],
        'Tailscale': [{ family: 'IPv4', internal: false, address: '100.101.102.103' }],
        'Gone': undefined
      })
    ).toEqual(['192.168.1.5', '172.29.0.1', '100.101.102.103'])
  })
  it('accepts Node 18 numeric families', () => {
    expect(lanAddresses({ a: [{ family: 4, internal: false, address: '10.0.0.2' }] })).toEqual(['10.0.0.2'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/main/phone/routes.test.ts src/main/phone/lan.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

```ts
// src/main/phone/routes.ts
/** The phone server's URL shapes (2026-09-06, #104). Parsing only: no fs, no wall. */

export type Route =
  | { kind: 'static'; file: string }
  | { kind: 'pair' }
  | { kind: 'api'; name: string; query: URLSearchParams }
  | { kind: 'media'; path: string; query: URLSearchParams }
  | { kind: 'none' }

export function parseRoute(url: string): Route {
  let u: URL
  try {
    u = new URL(url, 'http://phone.invalid')
  } catch {
    return { kind: 'none' }
  }
  const p = u.pathname
  if (p === '/' || p === '/index.html' || p === '/phone.html') return { kind: 'static', file: '' }
  if (p === '/pair') return { kind: 'pair' }
  if (p.startsWith('/api/')) return { kind: 'api', name: p.slice(5), query: u.searchParams }
  if (p.startsWith('/m/')) {
    let path: string
    try {
      path = decodeURIComponent(p.slice(3))
    } catch {
      return { kind: 'none' }
    }
    return { kind: 'media', path, query: u.searchParams }
  }
  let file: string
  try {
    file = decodeURIComponent(p.replace(/^\/+/, ''))
  } catch {
    return { kind: 'none' }
  }
  if (!file || file.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) return { kind: 'none' }
  return { kind: 'static', file }
}

/** The token: an Authorization header for fetches, `?t=` for `<video src>`,
 *  which can carry no header. */
export function tokenOf(query: URLSearchParams, auth: string | undefined): string | null {
  const m = auth ? /^Bearer\s+(\S+)$/i.exec(auth) : null
  if (m) return m[1]
  return query.get('t') || null
}

export function pairLink(address: string, port: number, code: string): string {
  return `http://${address}:${port}/?code=${code}`
}
```

```ts
// src/main/phone/lan.ts
/** The addresses a phone could reach this machine on, private ranges first:
 *  a Wi-Fi 192.168.x beats a WSL or Hyper-V 172.x, which beats a VPN 100.x. */
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/phone/routes.test.ts src/main/phone/lan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/phone/routes.ts src/main/phone/routes.test.ts src/main/phone/lan.ts src/main/phone/lan.test.ts
git commit -m "feat(phone): route parsing and LAN address choice, pure and tested (#104)"
```

---

### Task 3: The server

**Files:**
- Create: `src/main/phone/server.ts`
- Modify: `package.json` (add `qrcode`, `@types/qrcode`, version `0.38.0`), `src/shared/types.ts` (add `PhoneState`, `PhoneInfo`)
- Test: `src/main/phone/server.test.ts` (integration over loopback, real `http`)

**Interfaces:**
- Consumes: Task 1 and 2 exports; `DirListing` from `@shared/types`.
- Produces:
  ```ts
  // src/shared/types.ts
  export interface PhoneInfo { token: string; name: string; root: string; paired: number; seen: number }
  export interface PhoneState {
    on: boolean
    port: number | null
    addresses: string[]
    phones: PhoneInfo[]
    /** Phones that fetched something in the last 30 seconds, by token. */
    watching: string[]
    /** The current tab's pairing: link and QR (SVG) for it, when the server is up. */
    code?: { code: string; link: string; svg: string; expires: number }
    error?: string
  }

  // src/main/phone/server.ts
  export interface PhoneDeps {
    rendererDir: string
    devUrl?: string                                   // ELECTRON_RENDERER_URL in dev
    media: (req: Request) => Promise<Response>        // serveMedia
    listDir: (dir: string) => Promise<DirListing>
    validRoot: (root: string, p: string) => boolean
    isRoot: (root: string, p: string) => boolean
    rootOpen: (root: string) => boolean
    subsFor: (p: string) => Array<{ path: string; label: string }>
    readSubs: (p: string) => Promise<string | null>
    onChange: () => void                              // pairing/watchers changed
    loopbackOnly: boolean
    now?: () => number
  }
  export class PhoneServer {
    constructor(deps: PhoneDeps, state: PairState)
    start(preferredPort: number): Promise<number>      // resolves the bound port
    stop(): Promise<void>
    get port(): number | null
    get state(): PairState
    watching(): string[]
    issue(root: string): { code: string; expires: number }
  }
  export const DEFAULT_PORT = 47320
  ```

- [ ] **Step 1: Install the dependency and bump the version**

Run: `npm i qrcode && npm i -D @types/qrcode` then set `"version": "0.38.0"` in `package.json`.

- [ ] **Step 2: Add the shared types**

Append to `src/shared/types.ts` the `PhoneInfo` and `PhoneState` interfaces exactly as in the Interfaces block above.

- [ ] **Step 3: Write the failing integration test**

```ts
// src/main/phone/server.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { emptyState } from './pairing'
import { PhoneServer, type PhoneDeps } from './server'

let dir: string
let renderer: string
let server: PhoneServer
let port: number
let changes = 0

const listing = (files: string[]) => ({
  folders: [],
  files: files.map((f) => ({ path: join(dir, f), name: f, ext: '.mp4', kind: 'video' as const, size: 4, mtimeMs: 0 }))
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prism-phone-'))
  renderer = join(dir, 'renderer')
  mkdirSync(join(renderer, 'assets'), { recursive: true })
  writeFileSync(join(renderer, 'phone.html'), '<html>phone</html>')
  writeFileSync(join(renderer, 'assets', 'a.js'), 'console.log(1)')
  writeFileSync(join(dir, 'clip.mp4'), 'abcd')
  const deps: PhoneDeps = {
    rendererDir: renderer,
    media: async (req) => {
      const p = decodeURIComponent(new URL(req.url).pathname).slice(1)
      const range = req.headers.get('range')
      if (range) return new Response('bc', { status: 206, headers: { 'Content-Range': 'bytes 1-2/4' } })
      return new Response(p.endsWith('clip.mp4') ? 'abcd' : null, { status: p.endsWith('clip.mp4') ? 200 : 404 })
    },
    listDir: async () => listing(['clip.mp4']),
    validRoot: (root, p) => root === dir && p.toLowerCase().startsWith(dir.toLowerCase()),
    isRoot: (root, p) => root === dir && p === dir,
    rootOpen: (root) => root === dir,
    subsFor: () => [{ path: join(dir, 'clip.srt'), label: 'English' }],
    readSubs: async () => 'WEBVTT\n',
    onChange: () => {
      changes += 1
    },
    loopbackOnly: true,
    now: () => 1000
  }
  server = new PhoneServer(deps, emptyState())
  port = await server.start(0)
})

afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

const url = (p: string) => `http://127.0.0.1:${port}${p}`

async function pair(): Promise<string> {
  const { code } = server.issue(dir)
  const r = await fetch(url('/pair'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name: 'Test phone' })
  })
  expect(r.status).toBe(200)
  const j = (await r.json()) as { token: string; root: string }
  expect(j.root).toBe(dir)
  return j.token
}

describe('PhoneServer', () => {
  it('serves the page and its assets, and nothing above the renderer dir', async () => {
    expect(await (await fetch(url('/'))).text()).toBe('<html>phone</html>')
    expect(await (await fetch(url('/?code=ABC'))).text()).toBe('<html>phone</html>')
    expect((await fetch(url('/assets/a.js'))).status).toBe(200)
    expect((await fetch(url('/assets/../phone.html'))).status).toBe(404)
  })

  it('pairs once and refuses a spent code', async () => {
    const token = await pair()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(changes).toBeGreaterThan(0)
    const { code } = server.issue(dir)
    const first = await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code, name: 'x' }) })
    expect(first.status).toBe(200)
    const again = await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code, name: 'x' }) })
    expect(again.status).toBe(403)
  })

  it('a paired phone scanning another code keeps its token and moves root', async () => {
    const token = await pair()
    const { code } = server.issue(dir) // stands in for another tab's root
    const r = await fetch(url('/pair'), {
      method: 'POST',
      body: JSON.stringify({ code, name: 'Test phone', token })
    })
    expect(r.status).toBe(200)
    expect(((await r.json()) as { token: string }).token).toBe(token)
    expect(server.state.phones).toHaveLength(1)
  })

  it('walls every api route behind the token', async () => {
    expect((await fetch(url('/api/me'))).status).toBe(401)
    expect((await fetch(url(`/api/dir?path=${encodeURIComponent(dir)}`))).status).toBe(401)
    expect((await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}`))).status).toBe(401)
  })

  it('answers me, dir, subs and media for a paired phone', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    const me = (await (await fetch(url('/api/me'), { headers: auth })).json()) as { root: string; open: boolean; name: string }
    expect(me).toEqual({ root: dir, open: true, name: 'Test phone' })
    const d = (await (await fetch(url(`/api/dir?path=${encodeURIComponent(dir)}`), { headers: auth })).json()) as { files: unknown[] }
    expect(d.files).toHaveLength(1)
    const subs = (await (await fetch(url(`/api/subs?path=${encodeURIComponent(join(dir, 'clip.mp4'))}`), { headers: auth })).json()) as unknown[]
    expect(subs).toHaveLength(1)
    const vtt = await (await fetch(url(`/api/subs/read?path=${encodeURIComponent(join(dir, 'clip.srt'))}`), { headers: auth })).text()
    expect(vtt).toBe('WEBVTT\n')
    const m = await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}?t=${token}`))
    expect(m.status).toBe(200)
    expect(await m.text()).toBe('abcd')
    const r = await fetch(url(`/m/${encodeURIComponent(join(dir, 'clip.mp4'))}?t=${token}`), { headers: { range: 'bytes=1-2' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 1-2/4')
    expect(server.watching()).toEqual([token])
  })

  it('refuses a path outside the phone root, even for a paired phone', async () => {
    const token = await pair()
    const auth = { authorization: `Bearer ${token}` }
    expect((await fetch(url('/api/dir?path=C%3A%5CWindows'), { headers: auth })).status).toBe(403)
    expect((await fetch(url('/m/C%3A%5CWindows%5Cnotepad.exe'), { headers: auth })).status).toBe(403)
  })

  it('rate-limits pairing attempts', async () => {
    for (let i = 0; i < 5; i++)
      await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code: 'ZZZZZZ', name: 'x' }) })
    const r = await fetch(url('/pair'), { method: 'POST', body: JSON.stringify({ code: 'ZZZZZZ', name: 'x' }) })
    expect(r.status).toBe(429)
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run src/main/phone/server.test.ts`
Expected: FAIL, `./server` missing.

- [ ] **Step 5: Implement the server**

```ts
// src/main/phone/server.ts
/**
 * The phone server (2026-09-06, #104): a plain Node http server on the LAN
 * that serves the phone page, pairs phones and answers the read-only routes
 * the page needs. The wall is written ONCE, at the top of `handle`: every
 * route but pairing and the static page needs a paired phone, and every
 * path is checked against THAT phone's root with the strict per-root check
 * before anything else looks at it. Bytes come from `serveMedia`, so the
 * media route inherits fsmedia's own rules on top.
 *
 * Nothing here is synchronous on main's thread: static files stream, the
 * listing is the bounded async one the sidebar uses, and pairing is a Map.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createReadStream, promises as fsp } from 'fs'
import { join, extname, normalize } from 'path'
import { Readable } from 'stream'
import type { DirListing } from '@shared/types'
import { forget, issueCode, phoneFor, redeem, touch, type PairState } from './pairing'
import { parseRoute, tokenOf } from './routes'

export const DEFAULT_PORT = 47320
const WATCH_WINDOW_MS = 30_000
const PAIR_LIMIT = 5
const PAIR_WINDOW_MS = 60_000

export interface PhoneDeps {
  rendererDir: string
  devUrl?: string
  media: (req: Request) => Promise<Response>
  listDir: (dir: string) => Promise<DirListing>
  validRoot: (root: string, p: string) => boolean
  isRoot: (root: string, p: string) => boolean
  rootOpen: (root: string) => boolean
  subsFor: (p: string) => Array<{ path: string; label: string }>
  readSubs: (p: string) => Promise<string | null>
  onChange: () => void
  loopbackOnly: boolean
  now?: () => number
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.bcmap': 'application/octet-stream'
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export class PhoneServer {
  private server: Server | null = null
  private bound: number | null = null
  private seen = new Map<string, number>()
  private pairHits = new Map<string, number[]>()
  private readonly now: () => number

  constructor(
    private readonly deps: PhoneDeps,
    readonly state: PairState
  ) {
    this.now = deps.now ?? Date.now
  }

  get port(): number | null {
    return this.bound
  }

  /** Phones that fetched something in the last 30s. */
  watching(): string[] {
    const cutoff = this.now() - WATCH_WINDOW_MS
    return [...this.seen.entries()].filter(([, t]) => t >= cutoff).map(([tok]) => tok)
  }

  issue(root: string): { code: string; expires: number } {
    const code = issueCode(this.state, root, this.now())
    const expires = this.state.codes.find((c) => c.code === code)!.expires
    return { code, expires }
  }

  /** Bind, trying the ten ports above the preferred one before giving up. */
  start(preferredPort: number): Promise<number> {
    const host = this.deps.loopbackOnly ? '127.0.0.1' : '0.0.0.0'
    const tryPort = (port: number, left: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const s = createServer((req, res) => void this.handle(req, res))
        s.once('error', (err: NodeJS.ErrnoException) => {
          s.close()
          if (err.code === 'EADDRINUSE' && left > 0 && port !== 0) resolve(tryPort(port + 1, left - 1))
          else reject(err)
        })
        s.listen(port, host, () => {
          this.server = s
          const addr = s.address()
          this.bound = typeof addr === 'object' && addr ? addr.port : port
          resolve(this.bound)
        })
      })
    return tryPort(preferredPort, 10)
  }

  stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.bound = null
    if (!s) return Promise.resolve()
    return new Promise((resolve) => {
      s.closeAllConnections()
      s.close(() => resolve())
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const route = parseRoute(req.url ?? '/')
      if (route.kind === 'none') return void json(res, 404, { error: 'not found' })
      if (route.kind === 'static') return this.serveStatic(route.file, req, res)
      if (route.kind === 'pair') return this.pair(req, res)

      const token = tokenOf(route.query, req.headers.authorization)
      const phone = phoneFor(this.state, token)
      if (!phone) return void json(res, 401, { error: 'not paired' })
      touch(this.state, phone.token, this.now())
      this.seen.set(phone.token, this.now())

      if (route.kind === 'media') {
        if (!this.deps.validRoot(phone.root, route.path)) return void json(res, 403, { error: 'outside the folder' })
        return this.serveMedia(route.path, req, res)
      }
      return this.api(route.name, route.query, phone.root, phone.name, res)
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: String((err as Error)?.message ?? err) })
      else res.end()
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return void json(res, 405, { error: 'POST' })
    const from = req.socket.remoteAddress ?? '?'
    const now = this.now()
    const hits = (this.pairHits.get(from) ?? []).filter((t) => t > now - PAIR_WINDOW_MS)
    if (hits.length >= PAIR_LIMIT) return void json(res, 429, { error: 'too many attempts, wait a minute' })
    hits.push(now)
    this.pairHits.set(from, hits)
    let body: { code?: unknown; name?: unknown }
    try {
      body = JSON.parse(await readBody(req)) as typeof body
    } catch {
      return void json(res, 400, { error: 'bad request' })
    }
    if (typeof body.code !== 'string') return void json(res, 400, { error: 'no code' })
    const phone = redeem(this.state, body.code, typeof body.name === 'string' ? body.name : 'Phone', now)
    if (!phone) return void json(res, 403, { error: 'that code is not valid any more; scan again' })
    // A phone that is ALREADY paired and scans a code from another tab MOVES
    // to that root (spec): it keeps its token and the list does not grow a
    // second entry for the same phone.
    const existing = phoneFor(this.state, typeof body.token === 'string' ? body.token : null)
    if (existing) {
      existing.root = phone.root
      existing.name = phone.name
      existing.seen = now
      forget(this.state, phone.token)
      this.deps.onChange()
      return void json(res, 200, { token: existing.token, root: existing.root })
    }
    this.deps.onChange()
    json(res, 200, { token: phone.token, root: phone.root })
  }

  private async api(name: string, q: URLSearchParams, root: string, phoneName: string, res: ServerResponse): Promise<void> {
    const path = q.get('path') ?? ''
    const inside = (): boolean => this.deps.validRoot(root, path) || this.deps.isRoot(root, path)
    switch (name) {
      case 'me':
        return void json(res, 200, { root, open: this.deps.rootOpen(root), name: phoneName })
      case 'dir': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        return void json(res, 200, await this.deps.listDir(path))
      }
      case 'subs': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        return void json(res, 200, this.deps.subsFor(path))
      }
      case 'subs/read': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        const vtt = await this.deps.readSubs(path)
        if (vtt === null) return void json(res, 404, { error: 'no subtitles' })
        res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' })
        return void res.end(vtt)
      }
      default:
        return void json(res, 404, { error: 'no such route' })
    }
  }

  /** Bytes through serveMedia: same handler as fsmedia://, same rules. */
  private async serveMedia(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const headers: Record<string, string> = {}
    if (req.headers.range) headers.range = String(req.headers.range)
    const r = await this.deps.media(new Request(`fsmedia://local/${encodeURIComponent(path)}`, { headers }))
    const out: Record<string, string> = { 'cache-control': 'no-store' }
    r.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'access-control-allow-origin') out[k] = v
    })
    res.writeHead(r.status, out)
    if (!r.body) return void res.end()
    const node = Readable.fromWeb(r.body as never)
    node.on('error', () => res.destroy())
    res.on('close', () => node.destroy())
    node.pipe(res)
  }

  /** The phone bundle out of the renderer dir; in dev, out of vite's server. */
  private async serveStatic(file: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.deps.devUrl) {
      const target = new URL(file ? `/${file}` : '/phone.html', this.deps.devUrl)
      const r = await fetch(target, { headers: { accept: String(req.headers.accept ?? '*/*') } })
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' })
      if (!r.body) return void res.end()
      Readable.fromWeb(r.body as never).pipe(res)
      return
    }
    const rel = file || 'phone.html'
    const full = normalize(join(this.deps.rendererDir, rel))
    if (!full.toLowerCase().startsWith(normalize(this.deps.rendererDir).toLowerCase())) return void json(res, 404, { error: 'not found' })
    let st: Awaited<ReturnType<typeof fsp.stat>>
    try {
      st = await fsp.stat(full)
    } catch {
      return void json(res, 404, { error: 'not found' })
    }
    if (!st.isFile()) return void json(res, 404, { error: 'not found' })
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(st.size),
      'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    })
    const s = createReadStream(full)
    s.on('error', () => res.destroy())
    s.pipe(res)
  }
}
```

- [ ] **Step 6: Run the tests, typecheck**

Run: `npx vitest run src/main/phone && npm run typecheck:node`
Expected: PASS, typecheck clean. If `Readable.fromWeb` complains about types, the `as never` cast is deliberate (Node's web-stream type and the DOM one disagree).

- [ ] **Step 7: Commit**

```bash
git add src/main/phone/server.ts src/main/phone/server.test.ts src/shared/types.ts package.json package-lock.json
git commit -m "feat(phone): the LAN server, walled per phone, tested over loopback (#104)"
```

---

### Task 4: Wire the server into main, persist, and expose it over IPC

**Files:**
- Create: `src/main/phone/store.ts` + `src/main/phone/store.test.ts`, `src/main/phone/qr.ts`
- Modify: `src/main/index.ts` (imports near the top; a block inside the `app.whenReady().then(() => {` at ~1295 after `protocol.handle(MEDIA_SCHEME, ...)`; `roots.ts`'s `onRootsChanged` is already used by dirWatch, so hook the phone through a second listener wrapper), `src/preload/index.ts`

**Interfaces:**
- Consumes: `PhoneServer`, `DEFAULT_PORT`, `PairState`, `parseState`, `serializeState`, `lanAddresses`, `pairLink`.
- Produces (preload):
  ```ts
  phoneGet: (root: string | null): Promise<PhoneState>
  phoneSetOn: (on: boolean): Promise<PhoneState>
  phoneCode: (root: string): Promise<PhoneState>          // a fresh code for that root
  phoneForget: (token: string): Promise<PhoneState>
  onPhoneChanged: (cb: () => void) => () => void          // 'phone:changed'
  ```

- [ ] **Step 1: store.ts, test first**

```ts
// src/main/phone/store.test.ts
import { describe, expect, it } from 'vitest'
import { parseStore, serializeStore } from './store'

describe('phone store', () => {
  it('round-trips and defaults', () => {
    const s = parseStore('{"on":true,"port":47321,"phones":[{"token":"t","name":"n","root":"C:\\\\a","paired":1,"seen":2}]}')
    expect(s.on).toBe(true)
    expect(s.port).toBe(47321)
    expect(s.pairing.phones).toHaveLength(1)
    expect(parseStore('soup')).toEqual({ on: false, port: null, pairing: { codes: [], phones: [] } })
    expect(JSON.parse(serializeStore(s))).toMatchObject({ on: true, port: 47321 })
  })
})
```

```ts
// src/main/phone/store.ts
/** userData/phone.json: the switch, the port it settled on, the paired phones. */
import { emptyState, parseState, type PairState } from './pairing'

export interface PhoneStore {
  on: boolean
  port: number | null
  pairing: PairState
}

export function parseStore(raw: string): PhoneStore {
  try {
    const j = JSON.parse(raw) as { on?: unknown; port?: unknown }
    return {
      on: j.on === true,
      port: typeof j.port === 'number' && j.port > 0 && j.port < 65536 ? j.port : null,
      pairing: parseState(raw)
    }
  } catch {
    return { on: false, port: null, pairing: emptyState() }
  }
}

export function serializeStore(s: PhoneStore): string {
  return JSON.stringify({ on: s.on, port: s.port, phones: s.pairing.phones }, null, 2)
}
```

Run: `npx vitest run src/main/phone/store.test.ts` and expect PASS.

- [ ] **Step 2: qr.ts**

```ts
// src/main/phone/qr.ts
import QRCode from 'qrcode'

/** The pairing link as an SVG string, sized by the dialog's CSS. */
export function qrSvg(link: string): Promise<string> {
  return QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
}
```

- [ ] **Step 3: Main wiring**

In `src/main/index.ts`, add imports:

```ts
import { networkInterfaces } from 'os'
import { PhoneServer, DEFAULT_PORT } from './phone/server'
import { parseStore, serializeStore, type PhoneStore } from './phone/store'
import { lanAddresses } from './phone/lan'
import { pairLink } from './phone/routes'
import { qrSvg } from './phone/qr'
import { forget as forgetPhone } from './phone/pairing'
import type { PhoneState } from '@shared/types'
```

Add, after `const TABS_STATE = ...` (~621):

```ts
const PHONE_STATE = (): string => join(app.getPath('userData'), 'phone.json')
```

Inside `app.whenReady().then(() => {` after the `protocol.handle(MEDIA_SCHEME, ...)` lines:

```ts
    /**
     * PRISM ON YOUR PHONE (2026-09-06, #104). The server lives for as long as
     * the switch is on; the switch and the paired phones persist. Every
     * change the dialog could care about is pushed as `phone:changed`, and
     * the dialog re-reads with `phone:get`, which is what keeps the two
     * from drifting.
     */
    let phoneStore: PhoneStore = parseStore(readFileSync(PHONE_STATE(), 'utf8').toString())
    const savePhone = (): void => {
      try {
        writeFileSync(PHONE_STATE(), serializeStore(phoneStore))
      } catch {
        /* a failed write loses the pairing, not the session */
      }
    }
    let phone: PhoneServer | null = null
    let phoneError = ''
    const phoneChanged = (): void => mainWindow?.webContents.send('phone:changed')
    const phoneDeps = () => ({
      rendererDir: RENDERER_DIR,
      devUrl: !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined,
      media: serveMedia,
      listDir,
      validRoot,
      isRoot: (root: string, p: string) => isRoot(root, p),
      rootOpen: (root: string) => openRoots().some((r) => isRoot(r, root)),
      subsFor: (p: string) => sidecarsFor(p).map((t) => ({ path: t.path, label: t.label })),
      readSubs: (p: string) =>
        readAsVtt(p, findFfmpeg(app.isPackaged, process.resourcesPath, app.getAppPath())?.ffmpeg),
      onChange: () => {
        savePhone()
        phoneChanged()
      },
      loopbackOnly: E2E
    })
    const startPhone = async (): Promise<void> => {
      if (phone) return
      const s = new PhoneServer(phoneDeps(), phoneStore.pairing)
      try {
        phoneStore.port = await s.start(phoneStore.port ?? DEFAULT_PORT)
        phone = s
        phoneError = ''
      } catch (err) {
        phoneError = `Could not open a port: ${String((err as Error).message ?? err)}`
        phoneStore.on = false
      }
      savePhone()
      phoneChanged()
    }
    const stopPhone = async (): Promise<void> => {
      const s = phone
      phone = null
      if (s) await s.stop()
      phoneChanged()
    }
    const phoneState = async (root: string | null): Promise<PhoneState> => {
      const state: PhoneState = {
        on: !!phone,
        port: phone?.port ?? null,
        addresses: E2E ? ['127.0.0.1'] : lanAddresses(networkInterfaces() as never),
        phones: phoneStore.pairing.phones.map((p) => ({ ...p })),
        watching: phone?.watching() ?? [],
        error: phoneError || undefined
      }
      if (phone && root && state.addresses[0]) {
        const live = phoneStore.pairing.codes.find((c) => c.root === root && c.expires > Date.now())
        const { code, expires } = live ?? phone.issue(root)
        const link = pairLink(state.addresses[0], phone.port!, code)
        state.code = { code, link, svg: await qrSvg(link), expires }
      }
      return state
    }
    ipcMain.handle('phone:get', (_e, root: string | null) => phoneState(typeof root === 'string' ? root : null))
    ipcMain.handle('phone:set-on', async (_e, on: boolean, root: string | null) => {
      phoneStore.on = on === true
      savePhone()
      if (phoneStore.on) await startPhone()
      else await stopPhone()
      return phoneState(typeof root === 'string' ? root : null)
    })
    ipcMain.handle('phone:code', async (_e, root: string) => {
      if (phone && typeof root === 'string' && openRoots().some((r) => isRoot(r, root))) phone.issue(root)
      return phoneState(typeof root === 'string' ? root : null)
    })
    ipcMain.handle('phone:forget', async (_e, token: string, root: string | null) => {
      if (typeof token === 'string' && forgetPhone(phoneStore.pairing, token)) savePhone()
      return phoneState(typeof root === 'string' ? root : null)
    })
    if (phoneStore.on) void startPhone()
    app.on('before-quit', () => {
      void phone?.stop()
    })
```

Confirm the names `listDir`, `validRoot`, `isRoot`, `openRoots`, `sidecarsFor`, `readAsVtt`, `findFfmpeg`, `E2E`, `RENDERER_DIR`, `readFileSync`, `writeFileSync` are already imported in `index.ts` (grep each; import the missing ones from `./dirList`, `./roots`, `./subtitles`, `./ffmpeg`, `fs`). `readFileSync` on a missing file throws: wrap the initial read in a try that falls back to `parseStore('')`.

- [ ] **Step 4: Preload**

Add to `api` in `src/preload/index.ts`, next to `tabsChanged`:

```ts
  /** Prism on your phone (#104): the Tools > Phone dialog's state and verbs. */
  phoneGet: (root: string | null): Promise<PhoneState> => ipcRenderer.invoke('phone:get', root),
  phoneSetOn: (on: boolean, root: string | null): Promise<PhoneState> =>
    ipcRenderer.invoke('phone:set-on', on, root),
  phoneCode: (root: string): Promise<PhoneState> => ipcRenderer.invoke('phone:code', root),
  phoneForget: (token: string, root: string | null): Promise<PhoneState> =>
    ipcRenderer.invoke('phone:forget', token, root),
  onPhoneChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('phone:changed', listener)
    return () => ipcRenderer.removeListener('phone:changed', listener)
  },
```

and `PhoneState` to the type import from `@shared/types`.

- [ ] **Step 5: Typecheck, lint, unit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/main/phone/store.ts src/main/phone/store.test.ts src/main/phone/qr.ts src/main/index.ts src/preload/index.ts
git commit -m "feat(phone): main runs the server on the switch, persists pairing, exposes it over IPC (#104)"
```

---

### Task 5: The Tools button and the Phone dialog on the PC

**Files:**
- Create: `src/renderer/src/components/PhoneDialog.tsx`
- Modify: `src/renderer/src/App.tsx` (TopBar props + JSX around line 392, the update chip; App state for the menu and the dialog; pass the active tab's root)

**Interfaces:**
- Consumes: `window.prism.phoneGet/phoneSetOn/phoneCode/phoneForget/onPhoneChanged`, `PhoneState`, `ContextMenu`, `Dialog`.
- Produces: `PhoneDialog({ root, onClose })`.

- [ ] **Step 1: The dialog**

```tsx
// src/renderer/src/components/PhoneDialog.tsx
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { PhoneState } from '@shared/types'
import { Dialog } from './Dialog'

/**
 * Tools > Phone (2026-09-06, #104): the one home of "Prism on your phone".
 * The switch, the QR and address for the CURRENT tab, the paired phones,
 * and who is watching. Everything it shows is main's answer to `phoneGet`,
 * re-read on every `phone:changed`, so the switch reflects what the server
 * IS rather than what was clicked.
 */
export function PhoneDialog({ root, onClose }: { root: string | null; onClose: () => void }): JSX.Element {
  const [state, setState] = useState<PhoneState | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback((): void => {
    void window.prism.phoneGet(root).then(setState)
  }, [root])
  useEffect(() => {
    refresh()
    return window.prism.onPhoneChanged(refresh)
  }, [refresh])
  // The code has two minutes; ask for a new one when it runs out.
  useEffect(() => {
    if (!state?.code) return
    const left = state.code.expires - Date.now()
    const t = window.setTimeout(() => root && void window.prism.phoneCode(root).then(setState), Math.max(0, left))
    return () => window.clearTimeout(t)
  }, [state?.code, root])

  const toggle = async (): Promise<void> => {
    if (!state || busy) return
    setBusy(true)
    setState(await window.prism.phoneSetOn(!state.on, root))
    setBusy(false)
  }

  const body = !state ? (
    <p className="text-sm opacity-70">Reading...</p>
  ) : (
    <div className="flex flex-col gap-3 text-sm" data-phone-dialog>
      <label className="flex items-center justify-between gap-3">
        <span>Serve this PC&apos;s open folders to phones on this network</span>
        <button
          role="switch"
          aria-checked={state.on}
          aria-label="Phone server"
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            state.on ? 'bg-[var(--p-accent)]' : 'bg-[var(--p-hover)]'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              state.on ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>
      {!state.on && !state.error && (
        <p className="opacity-70">
          Windows will ask whether Prism may accept connections the first time. Allow it on private
          networks, or phones cannot reach it. Plain HTTP on your own network; nothing leaves it.
        </p>
      )}
      {state.error && <p className="text-[var(--p-danger,#e5484d)]">{state.error}</p>}
      {state.on && root && state.code && (
        <div className="flex gap-4">
          <div
            className="h-40 w-40 shrink-0 rounded bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
            aria-label="Pairing QR code"
            dangerouslySetInnerHTML={{ __html: state.code.svg }}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="opacity-70">Scan, or open on the phone:</span>
            <code className="select-all break-all" data-phone-link>
              {state.code.link}
            </code>
            <span className="opacity-70">
              Code <b data-phone-code>{state.code.code}</b>, good for two minutes.
            </span>
            {state.addresses.length > 1 && (
              <span className="opacity-70">Other addresses: {state.addresses.slice(1).join(', ')}</span>
            )}
            <button
              className="mt-1 self-start rounded border border-[color:var(--p-line)] px-2 py-0.5 hover:bg-[var(--p-hover)]"
              onClick={() => void navigator.clipboard.writeText(state.code!.link)}
            >
              Copy address
            </button>
          </div>
        </div>
      )}
      {state.on && !root && <p className="opacity-70">Open a folder in a tab to pair a phone to it.</p>}
      <div className="flex flex-col gap-1">
        <span className="font-medium">Paired phones</span>
        {state.phones.length === 0 && <span className="opacity-70">None yet.</span>}
        {state.phones.map((p) => (
          <div key={p.token} className="flex items-center justify-between gap-3" data-phone-row>
            <span className="min-w-0 truncate">
              {p.name}
              <span className="opacity-60">
                {' '}
                {state.watching.includes(p.token) ? 'watching now' : `seen ${new Date(p.seen).toLocaleString()}`}
              </span>
            </span>
            <button
              className="shrink-0 rounded px-2 py-0.5 hover:bg-[var(--p-hover)]"
              onClick={() => void window.prism.phoneForget(p.token, root).then(setState)}
            >
              Forget
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  return <Dialog title="Prism on your phone" body={body} choices={[{ label: 'Close', onPick: onClose, primary: true }]} onCancel={onClose} />
}
```

Check `Dialog`'s `choices`/`body` props against `src/renderer/src/components/Dialog.tsx:16` and adapt if the body slot is named differently.

- [ ] **Step 2: The Tools button in the TopBar**

In `App.tsx`'s `TopBar` props add `onTools: (x: number, y: number) => void`. Before the update chip JSX (`{!setup && update && (`), add:

```tsx
      {/* Tools (2026-09-06, #104): a menu of things that are not about the
          open file. One row today, Phone; the button exists so the next
          one has a home. Left of the update chip, glyph only like its
          neighbours. */}
      {!setup && (
        <button
          className="grid h-7 w-8 place-items-center rounded text-[var(--p-icon)] transition-colors hover:bg-white/10 hover:text-[var(--p-text)]"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onTools(r.left, r.bottom + 2)
          }}
          title="Tools"
          aria-label="Tools"
        >
          <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.7 6.3a4 4 0 0 0 5 5L13 18a2.1 2.1 0 0 1-3-3l6.7-6.7Z" />
            <path d="M14.7 6.3 17 4l3 3-2.3 2.3M5 19l3-3" />
          </svg>
        </button>
      )}
```

In `App`, add state `const [toolsMenu, setToolsMenu] = useState<{ x: number; y: number } | null>(null)` and `const [phoneOpen, setPhoneOpen] = useState(false)`, pass `onTools={(x, y) => setToolsMenu({ x, y })}` to `<TopBar>`, and render beside the other overlays (find where `ContextMenu` for the tab strip or sidebar is rendered at App level and put these next to it):

```tsx
      {toolsMenu && (
        <ContextMenu
          x={toolsMenu.x}
          y={toolsMenu.y}
          onClose={() => setToolsMenu(null)}
          items={[{ label: 'Phone', onPick: () => setPhoneOpen(true) }]}
        />
      )}
      {phoneOpen && <PhoneDialog root={active?.kind === 'folder' ? active.root : null} onClose={() => setPhoneOpen(false)} />}
```

`active` is App's current tab; use whatever expression App already uses for the current tab's root (grep `active.root` and copy the guard). Ensure the ContextMenu's z-index sits above the Settings page (the tab-strip menu was raised to `z-[45]` for that reason, #99: reuse the same wrapper if App wraps menus).

- [ ] **Step 3: Typecheck and lint, run the app**

Run: `npm run typecheck && npm run lint`, then `npm run dev` and click Tools > Phone: the dialog opens, the switch turns the server on (Windows firewall prompt appears once on this machine; allow private), the QR renders, `http://<lan-ip>:47320/?code=...` is shown. Close dev.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/PhoneDialog.tsx src/renderer/src/App.tsx
git commit -m "feat(phone): Tools button and the Phone dialog: switch, QR, address, paired phones (#104)"
```

---

### Task 6: The phone page: entry, shim, pairing screen

**Files:**
- Create: `src/renderer/phone.html`, `src/renderer/src/phone/main.tsx`, `src/renderer/src/phone/api.ts`, `src/renderer/src/phone/api.test.ts`, `src/renderer/src/phone/prismShim.ts`, `src/renderer/src/phone/prismShim.test.ts`, `src/renderer/src/phone/PhoneApp.tsx`, `src/renderer/src/phone/Pairing.tsx`
- Modify: `electron.vite.config.ts` (second renderer input)

**Interfaces:**
- Produces:
  ```ts
  // api.ts (pure over fetch/localStorage)
  export const TOKEN_KEY = 'prism.phone.token'
  export function readToken(): string | null
  export function writeToken(t: string | null): void
  export function apiUrl(path: string, params?: Record<string, string>): string   // adds ?t=
  export function mediaUrl(path: string): string                                   // /m/<enc>?t=
  export async function getJson<T>(path: string, params?: Record<string, string>): Promise<T>  // throws PhoneError{status}
  export class PhoneError extends Error { status: number }
  export function codeFromLocation(search: string): string | null
  // prismShim.ts
  export function installShim(): void   // sets window.prism
  export const capabilities = { write: false, clipboard: false, explorer: false, drag: false } as const
  ```

- [ ] **Step 1: api.ts tests and implementation**

```ts
// src/renderer/src/phone/api.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { apiUrl, codeFromLocation, mediaUrl, readToken, writeToken } from './api'

beforeEach(() => localStorage.clear())

describe('phone api urls', () => {
  it('carries the token in the query, and the path encoded', () => {
    writeToken('abc')
    expect(readToken()).toBe('abc')
    expect(apiUrl('/api/dir', { path: 'C:\\a b' })).toBe('/api/dir?path=C%3A%5Ca+b&t=abc')
    expect(mediaUrl('C:\\a b.mp4')).toBe('/m/C%3A%5Ca%20b.mp4?t=abc')
    writeToken(null)
    expect(readToken()).toBeNull()
    expect(apiUrl('/api/me')).toBe('/api/me')
  })
  it('reads the pairing code off the link', () => {
    expect(codeFromLocation('?code=ABCDEF')).toBe('ABCDEF')
    expect(codeFromLocation('?x=1')).toBeNull()
    expect(codeFromLocation('')).toBeNull()
  })
})
```

```ts
// src/renderer/src/phone/api.ts
/** The phone page's side of the wire (2026-09-06, #104). */
export const TOKEN_KEY = 'prism.phone.token'

export class PhoneError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function writeToken(t: string | null): void {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode: the session still works until reload */
  }
}

export function apiUrl(path: string, params: Record<string, string> = {}): string {
  const q = new URLSearchParams(params)
  const t = readToken()
  if (t) q.set('t', t)
  const s = q.toString()
  return s ? `${path}?${s}` : path
}

/** `<video src>` cannot carry a header, so the token rides in the query. */
export function mediaUrl(path: string): string {
  const t = readToken()
  return `/m/${encodeURIComponent(path)}${t ? `?t=${t}` : ''}`
}

export async function getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const r = await fetch(apiUrl(path, params))
  if (!r.ok) {
    let msg = r.statusText
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg
    } catch {
      /* not json */
    }
    throw new PhoneError(r.status, msg)
  }
  return (await r.json()) as T
}

export function codeFromLocation(search: string): string | null {
  const c = new URLSearchParams(search).get('code')
  return c && c.trim() ? c.trim().toUpperCase() : null
}
```

Run: `npx vitest run src/renderer/src/phone/api.test.ts` and expect PASS (vitest's jsdom environment gives `localStorage`; check `vitest.config` uses the same environment the other renderer tests do).

- [ ] **Step 2: prismShim.ts, test first**

```ts
// src/renderer/src/phone/prismShim.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installShim } from './prismShim'
import { writeToken } from './api'

describe('the phone shim', () => {
  beforeEach(() => {
    localStorage.clear()
    writeToken('tok')
    installShim()
  })
  it('builds media urls with the token', () => {
    expect(window.prism.mediaUrl('C:\\x.mp4')).toBe('/m/C%3A%5Cx.mp4?t=tok')
  })
  it('answers the media probe as nothing to decode', async () => {
    await expect(window.prism.probeMedia('C:\\x.mp4')).resolves.toEqual({ ffmpeg: false, needed: false })
  })
  it('says what it cannot do, and never throws for it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(window.prism.nativeDrag).toBe(false)
    expect(window.prism.capabilities).toEqual({ write: false, clipboard: false, explorer: false, drag: false })
    await expect((window.prism as unknown as { trashFile: (p: string) => Promise<unknown> }).trashFile('x')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
```

```ts
// src/renderer/src/phone/prismShim.ts
/**
 * `window.prism` for the phone page (2026-09-06, #104): the READ-ONLY subset
 * of the bridge, answered over HTTP. Everything else is a Proxy fallback
 * that warns once and resolves to false/null, so a verb a reused viewer
 * reaches for cannot crash the page; `capabilities` is how the viewers
 * learn not to offer it in the first place (PR 3 wires the menus to it).
 */
import type { PrismApi } from '../../../preload/index'
import type { DirListing, MediaProbe, TextRead } from '@shared/types'
import { getJson, mediaUrl } from './api'

export const capabilities = { write: false, clipboard: false, explorer: false, drag: false } as const

type Shim = Partial<PrismApi> & { capabilities: typeof capabilities }

const implemented: Shim = {
  capabilities,
  mediaUrl,
  nativeDrag: false,
  demo: false,
  listDir: (_root: string, path: string): Promise<DirListing | null> =>
    getJson<DirListing>('/api/dir', { path }).catch(() => null),
  readText: (_path: string): Promise<TextRead> => Promise.resolve({ error: 'unreadable' }), // PR 3
  probeMedia: (): Promise<MediaProbe> => Promise.resolve({ ffmpeg: false, needed: false }),
  audioBlind: () => Promise.resolve(null),
  subsFor: (path: string) => getJson<Array<{ path: string; label: string }>>('/api/subs', { path }).catch(() => []),
  readSubs: async (path: string) => {
    const r = await fetch(mediaUrl(path).replace(/^\/m\//, '/api/subs/read?path=').replace(/\?t=/, '&t='))
    return r.ok ? r.text() : null
  },
  pickSubtitle: () => Promise.resolve(null),
  startDrag: () => {},
  onDragEnd: () => () => {},
  onDirChanged: () => () => {},
  onFileAppended: () => () => {},
  onWindowState: () => () => {}
}

const warned = new Set<string>()

export function installShim(): void {
  const proxy = new Proxy(implemented, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof Shim]
      return (): Promise<false> => {
        if (!warned.has(prop)) {
          warned.add(prop)
          console.warn(`prism.${prop} is not available on the phone`)
        }
        return Promise.resolve(false)
      }
    }
  })
  ;(window as unknown as { prism: unknown }).prism = proxy
}
```

The `readSubs` URL building is clumsy: replace it with `fetch(apiUrl('/api/subs/read', { path }))` using `apiUrl` from `./api` (import it), which is the honest form; the test in Step 3 covers `mediaUrl` only. Check each name against `PrismApi` (`src/preload/index.ts`): `onWindowState`, `onDirChanged`, `onFileAppended`, `demo` must exist there with these shapes; drop any that do not and add any the three media viewers call (grep `window\.prism\.` in `ImageView.tsx`, `VideoView.tsx`, `AudioView.tsx`, `Transport.tsx`, `PlayerMenu.tsx`, `Visualizer.tsx`, `lib/useSidecarAudio.ts`, `lib/useSubtitles.ts`, `lib/audio.ts`, `lib/playState.ts`, `lib/mediaDeck.ts`, `lib/awake.ts`, `lib/backgroundPause.ts`).

Run: `npx vitest run src/renderer/src/phone` and expect PASS.

- [ ] **Step 3: The HTML entry and Vite input**

```html
<!-- src/renderer/phone.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="theme-color" content="#0b0b0f" />
    <title>Prism</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/phone/main.tsx"></script>
  </body>
</html>
```

No CSP meta: the page is same-origin with everything it loads, and `unsafe-inline` styles are what Tailwind's runtime needs anyway.

In `electron.vite.config.ts`, renderer `build.rollupOptions.input`:

```ts
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          phone: resolve(__dirname, 'src/renderer/phone.html')
        }
      }
    }
```

- [ ] **Step 4: main.tsx, Pairing.tsx, PhoneApp.tsx**

```tsx
// src/renderer/src/phone/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installShim } from './prismShim'
installShim() // before anything imports a viewer: lib/theme paints on import
import '../index.css'
import { PhoneApp } from './PhoneApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>
)
```

(ES imports hoist; to guarantee order, put `installShim()` in its own module `src/renderer/src/phone/boot.ts` that main.tsx imports FIRST, then the rest. Do that.)

```tsx
// src/renderer/src/phone/Pairing.tsx
import { useState, type JSX } from 'react'

/** The screen with no token: paste the code, or the link already carried it. */
export function Pairing({ initialCode, error, onPair }: { initialCode: string | null; error: string | null; onPair: (code: string) => Promise<void> }): JSX.Element {
  const [code, setCode] = useState(initialCode ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Prism</h1>
      <p className="opacity-70">Open Tools &gt; Phone on the PC and scan the code, or type it here.</p>
      <input
        className="w-48 rounded border border-[color:var(--p-line)] bg-transparent px-3 py-2 text-center text-xl uppercase tracking-[0.3em]"
        value={code}
        maxLength={6}
        autoCapitalize="characters"
        autoCorrect="off"
        aria-label="Pairing code"
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      {error && <p className="text-red-400">{error}</p>}
      <button
        className="rounded bg-[var(--p-accent)] px-5 py-2 text-[var(--p-on-accent)] disabled:opacity-50"
        disabled={busy || code.length !== 6}
        onClick={() => {
          setBusy(true)
          void onPair(code).finally(() => setBusy(false))
        }}
      >
        Pair
      </button>
    </div>
  )
}
```

```tsx
// src/renderer/src/phone/PhoneApp.tsx
import { useCallback, useEffect, useState, type JSX } from 'react'
import { codeFromLocation, getJson, PhoneError, readToken, writeToken } from './api'
import { Pairing } from './Pairing'
import { Browser } from './Browser'

type Me = { root: string; open: boolean; name: string }

/**
 * The phone shell (2026-09-06, #104). Three states: no token (pair), a
 * token whose root is no longer open (scan again), and a root to browse.
 * A 401 anywhere drops the token: the PC forgot this phone.
 */
export function PhoneApp(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null)
  const [token, setToken] = useState<string | null>(readToken())
  const [error, setError] = useState<string | null>(null)
  const initialCode = codeFromLocation(window.location.search)

  const load = useCallback(async (): Promise<void> => {
    if (!readToken()) return
    try {
      setMe(await getJson<Me>('/api/me'))
    } catch (e) {
      if (e instanceof PhoneError && e.status === 401) {
        writeToken(null)
        setToken(null)
        setError('This PC forgot this phone. Scan again.')
      } else setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const pair = useCallback(async (code: string): Promise<void> => {
    setError(null)
    const r = await fetch('/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // The current token rides along: an already-paired phone scanning a
      // code from another tab MOVES to that root and keeps its token.
      body: JSON.stringify({
        code,
        name: navigator.userAgent.replace(/^Mozilla\/5\.0 \(([^;)]+).*$/, '$1'),
        token: readToken() ?? undefined
      })
    })
    if (!r.ok) {
      setError(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Could not pair')
      return
    }
    const j = (await r.json()) as { token: string }
    writeToken(j.token)
    setToken(j.token)
    window.history.replaceState(null, '', '/') // the code has been spent
    await load()
  }, [load])

  useEffect(() => {
    // A link with a code pairs (or re-pairs onto another tab) on arrival.
    if (initialCode) void pair(initialCode)
    else void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!token) return <Pairing initialCode={initialCode} error={error} onPair={pair} />
  if (!me) return <div className="p-6 opacity-70">{error ?? 'Connecting...'}</div>
  if (!me.open)
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p>That folder is no longer open in Prism.</p>
        <p className="opacity-70">Open it there, or scan a new code from another tab.</p>
        <button className="rounded border border-[color:var(--p-line)] px-4 py-1" onClick={() => void load()}>Try again</button>
      </div>
    )
  return <Browser root={me.root} />
}
```

`Browser` comes in Task 7; for this task create a placeholder `Browser.tsx` that renders the root path so the build passes, replaced next task.

- [ ] **Step 5: Build, typecheck, lint**

Run: `npm run typecheck && npm run lint && npm run build` and confirm `out/renderer/phone.html` exists.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/phone.html src/renderer/src/phone electron.vite.config.ts
git commit -m "feat(phone): the phone page, its shim of window.prism, and pairing (#104)"
```

---

### Task 7: The folder browser and the viewer on the phone

**Files:**
- Create: `src/renderer/src/phone/Browser.tsx` (replace placeholder), `src/renderer/src/phone/PhoneViewer.tsx`, `src/renderer/src/phone/browse.ts` + `browse.test.ts`

**Interfaces:**
- Consumes: `window.prism.listDir(root, path)` → `DirListing`, `ImageView`, `VideoView`, `AudioView` props as in `App.tsx:518-560`.
- Produces:
  ```ts
  // browse.ts (pure)
  export function parentOf(root: string, dir: string): string | null   // null at the root
  export function crumbs(root: string, dir: string): Array<{ name: string; path: string }>
  export function stepFile(files: ViewerFile[], current: string, dir: 1 | -1): ViewerFile | null
  ```

- [ ] **Step 1: browse.ts, test first**

```ts
// src/renderer/src/phone/browse.test.ts
import { describe, expect, it } from 'vitest'
import { crumbs, parentOf, stepFile } from './browse'

const f = (name: string) => ({ path: `C:\\r\\${name}`, name, ext: '.mp4', kind: 'video' as const, size: 0, mtimeMs: 0 })

describe('browse', () => {
  it('walks up to the root and no further', () => {
    expect(parentOf('C:\\r', 'C:\\r\\a\\b')).toBe('C:\\r\\a')
    expect(parentOf('C:\\r', 'C:\\r\\a')).toBe('C:\\r')
    expect(parentOf('C:\\r', 'C:\\r')).toBeNull()
    expect(parentOf('C:\\r\\', 'C:\\r\\a')).toBe('C:\\r\\')
  })
  it('crumbs from the root folder name down', () => {
    expect(crumbs('C:\\films\\r', 'C:\\films\\r\\a\\b')).toEqual([
      { name: 'r', path: 'C:\\films\\r' },
      { name: 'a', path: 'C:\\films\\r\\a' },
      { name: 'b', path: 'C:\\films\\r\\a\\b' }
    ])
  })
  it('steps through the files and stops at the ends', () => {
    const files = [f('a'), f('b'), f('c')]
    expect(stepFile(files, 'C:\\r\\b', 1)?.name).toBe('c')
    expect(stepFile(files, 'C:\\r\\b', -1)?.name).toBe('a')
    expect(stepFile(files, 'C:\\r\\c', 1)).toBeNull()
    expect(stepFile(files, 'C:\\r\\zz', 1)).toBeNull()
  })
})
```

```ts
// src/renderer/src/phone/browse.ts
import type { ViewerFile } from '@shared/types'

const trim = (p: string): string => p.replace(/[\\/]+$/, '')

export function parentOf(root: string, dir: string): string | null {
  if (trim(dir).toLowerCase() === trim(root).toLowerCase()) return null
  const i = trim(dir).lastIndexOf('\\')
  const up = i > 0 ? trim(dir).slice(0, i) : null
  if (!up) return null
  return trim(up).toLowerCase() === trim(root).toLowerCase() ? root : up
}

export function crumbs(root: string, dir: string): Array<{ name: string; path: string }> {
  const out: Array<{ name: string; path: string }> = []
  let at: string | null = dir
  while (at) {
    const t = trim(at)
    out.unshift({ name: t.slice(t.lastIndexOf('\\') + 1) || t, path: t })
    at = parentOf(root, at)
  }
  return out
}

export function stepFile(files: ViewerFile[], current: string, dir: 1 | -1): ViewerFile | null {
  const i = files.findIndex((f) => f.path === current)
  if (i < 0) return null
  return files[i + dir] ?? null
}
```

Run: `npx vitest run src/renderer/src/phone/browse.test.ts` and expect PASS.

- [ ] **Step 2: Browser.tsx**

```tsx
// src/renderer/src/phone/Browser.tsx
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { DirListing, ViewerFile } from '@shared/types'
import { crumbs, parentOf, stepFile } from './browse'
import { PhoneViewer } from './PhoneViewer'

/**
 * One folder at a time, Explorer-shaped (2026-09-06, #104): folders first,
 * then the files Prism can show, tapped to open. The viewer takes the whole
 * screen and pages the folder's files with its own next/previous.
 */
export function Browser({ root }: { root: string }): JSX.Element {
  const [dir, setDir] = useState(root)
  const [listing, setListing] = useState<DirListing | null>(null)
  const [open, setOpen] = useState<ViewerFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: string): Promise<void> => {
    setError(null)
    const l = await window.prism.listDir(root, d)
    if (!l) setError('Prism could not read this folder')
    setListing(l)
  }, [root])

  useEffect(() => {
    void load(dir)
  }, [dir, load])

  const files = listing?.files ?? []
  const step = (d: 1 | -1): void => {
    if (!open) return
    const next = stepFile(files, open.path, d)
    if (next) setOpen(next)
  }

  if (open) {
    return (
      <PhoneViewer
        file={open}
        onClose={() => setOpen(null)}
        onStep={step}
        canStep={(d) => !!stepFile(files, open.path, d)}
      />
    )
  }

  const up = parentOf(root, dir)
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--p-bg)] text-[var(--p-text)]">
      <header className="sticky top-0 flex h-12 items-center gap-2 border-b border-[color:var(--p-line)] bg-[var(--p-bg)] px-3 pt-[env(safe-area-inset-top)]">
        {up !== null && (
          <button className="rounded px-2 py-1 hover:bg-[var(--p-hover)]" aria-label="Up" onClick={() => setDir(up)}>
            &larr;
          </button>
        )}
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap text-sm" aria-label="Folder">
          {crumbs(root, dir).map((c, i, all) => (
            <button
              key={c.path}
              className={i === all.length - 1 ? 'font-semibold' : 'opacity-70'}
              onClick={() => setDir(c.path)}
            >
              {c.name}
              {i < all.length - 1 && <span className="opacity-50"> &rsaquo; </span>}
            </button>
          ))}
        </nav>
      </header>
      {error && <p className="p-4 text-red-400">{error}</p>}
      {!listing && !error && <p className="p-4 opacity-70">Loading...</p>}
      {listing && (
        <ul className="flex flex-col" role="list">
          {listing.folders.map((f) => (
            <li key={f.path}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-[var(--p-hover)]" onClick={() => setDir(f.path)} data-phone-folder>
                <span aria-hidden>&#128193;</span>
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
          {listing.files.map((f) => (
            <li key={f.path}>
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-[var(--p-hover)]" onClick={() => setOpen(f)} data-phone-file data-kind={f.kind}>
                <span className="w-5 text-center text-xs uppercase opacity-60" aria-hidden>{f.ext.slice(1, 4)}</span>
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
          {listing.folders.length === 0 && listing.files.length === 0 && <li className="p-4 opacity-70">Nothing Prism can show here.</li>}
        </ul>
      )}
    </div>
  )
}
```

The folder glyph is a placeholder; use the sidebar's own folder SVG from `components/icons.tsx` if it exports one (grep `Folder` there), else keep a small inline SVG rather than an emoji.

- [ ] **Step 3: PhoneViewer.tsx**

```tsx
// src/renderer/src/phone/PhoneViewer.tsx
import { useState, type JSX } from 'react'
import type { ViewerFile } from '@shared/types'
import { ImageView } from '../components/ImageView'
import { VideoView } from '../components/VideoView'
import { AudioView } from '../components/AudioView'

/**
 * The reused viewers on a phone (2026-09-06, #104). Video, audio and
 * pictures in this PR; the rest say so honestly until PR 3. A slim bar
 * on top carries back and next/previous, and hides while a video plays.
 */
export function PhoneViewer({
  file,
  onClose,
  onStep,
  canStep
}: {
  file: ViewerFile
  onClose: () => void
  onStep: (d: 1 | -1) => void
  canStep: (d: 1 | -1) => boolean
}): JSX.Element {
  const [fullscreen, setFullscreen] = useState(false)
  const url = window.prism.mediaUrl(file.path)
  const toggleFullscreen = (): void => {
    setFullscreen((f) => !f)
    const el = document.documentElement
    if (!document.fullscreenElement) void el.requestFullscreen?.().catch(() => {})
    else void document.exitFullscreen?.().catch(() => {})
  }
  let view: JSX.Element
  switch (file.kind) {
    case 'video':
      view = (
        <VideoView
          url={url}
          path={file.path}
          onToggleFullscreen={toggleFullscreen}
          onAutoAdvance={() => onStep(1)}
          onStep={onStep}
          canStep={canStep}
          transportStyle="bar"
          transportBg={100}
          fullscreen={fullscreen}
        />
      )
      break
    case 'image':
      view = (
        <ImageView url={url} path={file.path} name={file.name} onToggleFullscreen={toggleFullscreen} onStep={onStep} canStep={canStep} fullscreen={fullscreen} />
      )
      break
    case 'audio':
      view = (
        <AudioView url={url} path={file.path} name={file.name} fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} onAutoAdvance={() => onStep(1)} onStep={onStep} canStep={canStep} transportStyle="bar" />
      )
      break
    default:
      view = <p className="p-6 text-center opacity-70">{file.name}: this kind is not on the phone yet.</p>
  }
  return (
    <div className="flex h-dvh flex-col bg-[var(--p-bg)] text-[var(--p-text)]" data-phone-viewer data-kind={file.kind}>
      {!fullscreen && (
        <header className="flex h-11 shrink-0 items-center gap-2 px-2 pt-[env(safe-area-inset-top)] text-sm">
          <button className="rounded px-2 py-1" aria-label="Back to the folder" onClick={onClose}>&larr;</button>
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button className="rounded px-2 py-1 disabled:opacity-30" aria-label="Previous" disabled={!canStep(-1)} onClick={() => onStep(-1)}>&uarr;</button>
          <button className="rounded px-2 py-1 disabled:opacity-30" aria-label="Next" disabled={!canStep(1)} onClick={() => onStep(1)}>&darr;</button>
        </header>
      )}
      <div className="relative min-h-0 flex-1">{view}</div>
    </div>
  )
}
```

`transportStyle` and `transportBg` prop types: read them off `VideoView.tsx:61-90` and pass valid values (the default style id and the default opacity used by App; grep `transportStyle` in App to copy the defaults).

- [ ] **Step 4: Typecheck, lint, unit, build; try it from a phone**

Run: `npm run typecheck && npm run lint && npm test && npm run build`. Then `npm run dev`, Tools > Phone, switch on, scan the QR with a phone on the Wi-Fi: the folder lists, a jpg opens, an mp4 (H.264/AAC) plays, an mp3 plays with the visualizer. Note what breaks (touch, sizing) in the commit message; fix sizing regressions that stop the page from working, leave polish for the touch pass at the end of this task.

- [ ] **Step 5: Touch pass (measured on the phone)**

Address only what the hands-on showed, e.g. `100dvh` vs the address bar, the transport's hover-only reveal (tap to reveal on a coarse pointer: `@media (hover: none)` shows it always while paused), pinch on `ImageView` if it has none (a `touch-action: pinch-zoom` on the image container is the cheap first cut). Each fix a small commit.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/phone
git commit -m "feat(phone): browse the tab's folder and play video, audio and pictures on the phone (#104)"
```

---

### Task 8: E2E scenario, CLAUDE.md, PR

**Files:**
- Modify: `tools/e2e/run.mjs` (add `phoneScenario` and `await run(phoneScenario)` in the table), `CLAUDE.md` (a note under the terminal/agent notes, same voice), `README.md` (one paragraph under features)

- [ ] **Step 1: The scenario**

```js
async function phoneScenario(fixtures) {
  console.log('phone: pair, browse, play over the LAN server')
  const { app, win } = await launch(join(fixtures, 'one.png'))
  let page = null
  let browser = null
  try {
    // Switch the server on from the renderer, the way the dialog does.
    const state = await win.evaluate(async () => {
      const root = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('title')
      return window.prism.phoneSetOn(true, root ?? null)
    })
    ok(state.on === true, 'the server reports on')
    ok(typeof state.port === 'number', 'the server has a port')
    ok(state.addresses[0] === '127.0.0.1', 'under --e2e it binds loopback only')
    ok(state.code && /^[A-Z2-9]{6}$/.test(state.code.code), 'a six-character code is issued for the tab')
    ok(state.code.svg.startsWith('<svg'), 'the QR renders as SVG')
    const base = `http://127.0.0.1:${state.port}`

    // Pair the way the phone does.
    const r = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: state.code.code, name: 'e2e phone' })
    })
    ok(r.status === 200, 'pairing succeeds')
    const { token, root } = await r.json()
    ok(root.toLowerCase() === fixtures.toLowerCase(), 'the phone is paired to the tab root')
    ok((await fetch(`${base}/api/me`)).status === 401, 'no token, no answer')
    const dir = await (await fetch(`${base}/api/dir?path=${encodeURIComponent(fixtures)}`, { headers: { authorization: `Bearer ${token}` } })).json()
    ok(dir.files.some((f) => f.name === 'one.png'), 'the listing carries the fixture')
    const outside = await fetch(`${base}/api/dir?path=${encodeURIComponent('C:\\Windows')}`, { headers: { authorization: `Bearer ${token}` } })
    ok(outside.status === 403, 'a path outside the root is refused')
    const ranged = await fetch(`${base}/m/${encodeURIComponent(join(fixtures, 'ep1.mp4'))}?t=${token}`, { headers: { range: 'bytes=0-99' } })
    ok(ranged.status === 206 && ranged.headers.get('content-range')?.startsWith('bytes 0-99/'), 'media answers a Range with 206')

    // The dialog on the PC lists the phone.
    await win.click('[aria-label="Tools"]')
    await win.click('[role="menuitem"]:has-text("Phone")')
    await win.waitForSelector('[data-phone-dialog]', { timeout: 5000 })
    ok((await win.locator('[data-phone-row]').count()) === 1, 'the dialog lists the paired phone')
    await win.keyboard.press('Escape')

    // The phone page itself, in a phone-sized window of the app's own
    // Chromium: the harness ships playwright-core and no browser binary, so
    // a second BrowserWindow stands in for the phone. Hidden and parked like
    // the main one; Playwright drives it over CDP all the same.
    page = await openPhoneWindow(app, `${base}/?code=INVALID`)
    await page.waitForSelector('text=Pair', { timeout: 10000 })
    // A second code for the same tab: the first was spent above.
    const again = await win.evaluate(async () => {
      const root = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('title')
      return window.prism.phoneCode(root)
    })
    await page.goto(`${base}/?code=${again.code.code}`)
    await page.waitForSelector('[data-phone-file]', { timeout: 10000 })
    ok((await page.locator('[data-phone-file][data-kind="image"]').count()) >= 1, 'the phone lists pictures')
    await page.click('[data-phone-file]:has-text("one.png")')
    await page.waitForSelector('[data-phone-viewer][data-kind="image"] img', { timeout: 10000 })
    const natural = await page.locator('[data-phone-viewer] img').evaluate((el) => el.naturalWidth)
    ok(natural > 0, 'the picture loads over the LAN route')
    await page.click('[aria-label="Back to the folder"]')
    await page.click('[data-phone-file]:has-text("ep1.mp4")')
    await page.waitForSelector('[data-phone-viewer][data-kind="video"] video', { timeout: 10000 })
    await page.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 1, null, { timeout: 15000 })
    ok(true, 'the video has metadata over the LAN route')

    // Forget from the PC: the phone's next request is a 401 and it re-pairs.
    await win.evaluate(async (tok) => window.prism.phoneForget(tok, null), token)
    await page.click('[aria-label="Back to the folder"]')
    await page.reload()
    await page.waitForSelector('text=Pair', { timeout: 10000 })
    ok(true, 'a forgotten phone lands on the pairing screen')
  } catch (e) {
    fail('phone scenario crashed: ' + e)
  } finally {
    await page?.close().catch(() => {})
    await browser?.close().catch(() => {})
    await win.evaluate(() => window.prism.phoneSetOn(false, null)).catch(() => {})
    await app.close()
  }
}
```

Requirements this scenario places on the app, to do while writing it: the active tab's `title` attribute IS its root (`TabStrip.tsx`, the `role="tab"` button), which is what the scenario reads, the `phoneScenario` name registered with `await run(phoneScenario)`, and the helper below added near `launchOnce` (drop the `browser` variable and its close from the scenario; `page.close()` closes the window). Confirm `ok`/`fail` helper names by reading the head of `run.mjs`.

```js
/** A second window of the app's own Chromium standing in for the phone. */
async function openPhoneWindow(app, url) {
  const before = app.windows().length
  await app.evaluate(({ BrowserWindow }, target) => {
    const w = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { sandbox: true } })
    void w.loadURL(target)
  }, url)
  let page = null
  for (let i = 0; i < 100 && !page; i++) {
    const wins = app.windows()
    if (wins.length > before) page = wins[wins.length - 1]
    else await sleep(100)
  }
  if (!page) throw new Error('the phone window never appeared')
  await page.waitForLoadState('domcontentloaded')
  return page
}
```

`page.goto(...)` on that page navigates the window; use it for the second code.

- [ ] **Step 2: Run the scenario until green**

Run: `npm run build && node tools/e2e/run.mjs phone`
Expected: all `ok`s pass. Fix what fails in the app, not the assertions, unless an assertion was wrong about a fixture.

- [ ] **Step 3: CLAUDE.md note**

Add under the terminal notes, in the file's voice, a paragraph beginning `- **Prism on your phone** (2026-09-06, #104).` covering: the server is plain HTTP on the LAN and why; pair once with a six-character single-use code, the token remembers the ROOT; every route checks the phone's own root with `validRoot` and media goes through `serveMedia`; loopback-only under `--e2e` (no firewall prompt for throwaway builds); the phone page is a second Vite entry mounting the SAME viewers behind a Proxy shim of `window.prism` that warns rather than throws; the Tools button is the home and is in the title bar because the sidebar can be hidden; what is NOT on the phone yet (transcode #105, documents #106, remote #107).

- [ ] **Step 4: Full gates and PR**

Run: `npm run typecheck && npm run lint && npm test`, then the FULL e2e (`npm run e2e`) before pushing. Then:

```bash
git add CLAUDE.md README.md tools/e2e/run.mjs
git commit -m "test(phone): e2e pairs, browses and plays over the LAN server; notes (#104)"
git push -u origin feat/104-phone-server
gh pr create --title "Prism on your phone (1): LAN server, pairing, Tools menu, phone page, direct play (#104)" --body "..."
```

The PR body: what it does, what it deliberately does not (transcode, documents, remote: #105, #106, #107), the firewall prompt, plain HTTP, the e2e scenario, `Closes #104`, and the trailer.

- [ ] **Step 5: Package and install**

`npm run package`, kill Prism and Prism-Setup, install `dist/Prism-Setup-x64-0.38.0.exe` silently, poll `Prism.exe`'s LastWriteTime until it moves, launch, confirm 0.38.0 in Settings. Then continue to PR 2's plan; the hands-on phone test of all four happens when the stack is done, per the owner.
