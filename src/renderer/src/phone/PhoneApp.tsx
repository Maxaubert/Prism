import { useCallback, useEffect, useState, type JSX } from 'react'
import { codeFromLocation, getJson, PhoneError, readToken, writeToken } from './api'
import { Pairing } from './Pairing'
import { Browser } from './Browser'
import { TabList } from './TabList'
import { switchTab } from './tabs'

/** `name` is this PHONE's, as the PC lists it; `folder` is the name of the
 *  TAB it is on, which main spells so the header and the tab list agree. */
type Me = { root: string; open: boolean; name: string; folder: string }

/** The phone's own name, as the PC lists it: the device out of the UA's
 *  parenthesis ("iPhone", "iPad", "Linux; Android 14; Pixel 8"). */
function deviceName(): string {
  const m = /^Mozilla\/5\.0 \(([^;)]+)/.exec(navigator.userAgent)
  return m?.[1]?.trim() || 'Phone'
}

/**
 * The phone shell (2026-09-06, #104). Three states: no token (pair), a
 * token whose root is no longer open (pick another tab), and a root to
 * browse. A 401 anywhere drops the token: the PC forgot this phone, and
 * SCANNING AGAIN is that phone's screen alone now (2026-09-08). A tab that
 * merely CLOSED is not a dead end any more: the PC has other folders open
 * and the phone can move to one of them without a code (owner).
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

  /**
   * Move to another of the PC's open tabs, which is what a re-scan used to be
   * the only way to do. The reason a refusal carries is left to reject so the
   * LIST can show it beside the rows it has just re-read: a folder that has
   * closed is a list that has moved on, not a message on its own.
   */
  const switchTo = useCallback(
    (root: string): Promise<void> =>
      switchTab(root).then(() => {
        setError(null)
        return load()
      }),
    [load]
  )

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
      <div className="flex min-h-dvh flex-col gap-3 p-6" data-phone-closed>
        <p>That folder is no longer open in Prism.</p>
        <p className="opacity-70">Pick one of the folders it does have open:</p>
        {/* The list, not a scan-again screen: the phone is still paired and
            the PC still has folders open, so a code buys nothing here. */}
        <TabList onPick={switchTo} />
        <button
          className="self-start rounded border border-[color:var(--p-line)] px-4 py-1"
          onClick={() => void load()}
        >
          Try again
        </button>
      </div>
    )
  // Keyed by the ROOT: moving to another tab starts in that folder with
  // nothing open, rather than in a folder the new root does not contain.
  return <Browser key={me.root} root={me.root} tab={me.folder} onSwitch={switchTo} />
}
