import { useCallback, useEffect, useState, type JSX } from 'react'
import { codeFromLocation, getJson, PhoneError, readToken, writeToken } from './api'
import { Pairing } from './Pairing'
import { Browser } from './Browser'

type Me = { root: string; open: boolean; name: string }

/** The phone's own name, as the PC lists it: the device out of the UA's
 *  parenthesis ("iPhone", "iPad", "Linux; Android 14; Pixel 8"). */
function deviceName(): string {
  const m = /^Mozilla\/5\.0 \(([^;)]+)/.exec(navigator.userAgent)
  return m?.[1]?.trim() || 'Phone'
}

/**
 * The phone shell (2026-09-06, #104). Three states: no token (pair), a
 * token whose root is no longer open (scan again), and a root to browse.
 * A 401 anywhere drops the token: the PC forgot this phone.
 */
export function PhoneApp(): JSX.Element {
  const [me, setMe] = useState<Me | null>(null)
  const [token, setToken] = useState<string | null>(readToken())
  const [error, setError] = useState<string | null>(null)
  const [initialCode] = useState(() => codeFromLocation(window.location.search))

  // Both are promise chains rather than async bodies, and that is not style:
  // the React hooks rule reads a setState anywhere inside a function an
  // effect calls as a synchronous one, awaits or not. State is set only in
  // the callbacks the network hands back to.
  const load = useCallback((): Promise<void> => {
    if (!readToken()) return Promise.resolve()
    return getJson<Me>('/api/me').then(
      (m) => setMe(m),
      (e: unknown) => {
        if (e instanceof PhoneError && e.status === 401) {
          writeToken(null)
          setToken(null)
          setError('This PC forgot this phone. Scan again.')
        } else setError(e instanceof Error ? e.message : String(e))
      }
    )
  }, [])

  const pair = useCallback(
    (code: string): Promise<void> =>
      fetch('/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The current token rides along: an already-paired phone scanning
        // a code from another tab MOVES to that root and keeps its token.
        body: JSON.stringify({ code, name: deviceName(), token: readToken() ?? undefined })
      }).then(
        async (r) => {
          // The last attempt's message stands until this one has an answer.
          if (!r.ok) {
            const j = (await r.json().catch(() => ({}))) as { error?: string }
            setError(j.error ?? 'Could not pair')
            return
          }
          const j = (await r.json()) as { token: string }
          setError(null)
          writeToken(j.token)
          setToken(j.token)
          window.history.replaceState(null, '', '/') // the code has been spent
          await load()
        },
        () => setError('Could not reach Prism. Is the phone on the same Wi-Fi?')
      ),
    [load]
  )

  useEffect(() => {
    // A link with a code pairs (or re-pairs onto another tab) on arrival.
    if (initialCode) void pair(initialCode)
    else void load()
    // Once, on arrival: `pair` and `load` are stable, and a code is spent the
    // moment it is used, so re-running this would only report it as invalid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!token) return <Pairing initialCode={initialCode} error={error} onPair={pair} />
  if (!me)
    return (
      <div className="p-6 opacity-70" data-phone-connecting>
        {error ?? 'Connecting...'}
      </div>
    )
  if (!me.open)
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center"
        data-phone-closed
      >
        <p>That folder is no longer open in Prism.</p>
        <p className="opacity-70">Open it there, or scan a new code from another tab.</p>
        <button
          className="rounded border border-[color:var(--p-line)] px-4 py-1"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    )
  return <Browser root={me.root} />
}
