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
export function PhoneDialog({
  root,
  onClose
}: {
  /** The active tab's folder, or null when no folder tab is in front. */
  root: string | null
  onClose: () => void
}): JSX.Element {
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
    if (!state?.code || !root) return
    const left = state.code.expires - Date.now()
    const t = window.setTimeout(
      () => void window.prism.phoneCode(root).then(setState),
      Math.max(0, left)
    )
    return () => window.clearTimeout(t)
  }, [state?.code, root])

  const toggle = async (): Promise<void> => {
    if (!state || busy) return
    setBusy(true)
    try {
      setState(await window.prism.phoneSetOn(!state.on, root))
    } finally {
      setBusy(false)
    }
  }

  const body = !state ? (
    <p>Reading...</p>
  ) : (
    <div className="flex flex-col gap-3" data-phone-dialog>
      <label className="flex items-center justify-between gap-3 text-[var(--p-text)]">
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
            className={`absolute top-0.5 left-0 h-4 w-4 rounded-full bg-white transition-transform ${
              state.on ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </label>
      {/* Said BEFORE the switch goes on: a per-user installer cannot add the
          firewall rule, and a declined prompt is a phone that cannot connect
          and no error anywhere. */}
      {!state.on && !state.error && (
        <p>
          Windows will ask whether Prism may accept connections the first time. Allow it on
          private networks, or phones cannot reach it. Plain HTTP on your own network; nothing
          leaves it.
        </p>
      )}
      {state.error && <p className="text-[#d97b84]">{state.error}</p>}
      {state.on && root && state.code && (
        <div className="flex gap-4">
          {/* The SVG is main's own: `qrcode` rendering a link main built from
              the address, the port and the code. Nothing a phone sent. */}
          <div
            className="h-40 w-40 shrink-0 rounded bg-white p-1 [&_svg]:h-full [&_svg]:w-full"
            role="img"
            aria-label="Pairing QR code"
            dangerouslySetInnerHTML={{ __html: state.code.svg }}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span>Scan, or open on the phone:</span>
            <code className="select-all break-all text-[var(--p-text)]" data-phone-link>
              {state.code.link}
            </code>
            <span>
              Code{' '}
              <b className="text-[var(--p-text)]" data-phone-code>
                {state.code.code}
              </b>
              , good for two minutes.
            </span>
            {state.addresses.length > 1 && (
              <span>Other addresses: {state.addresses.slice(1).join(', ')}</span>
            )}
            <button
              className="mt-1 self-start rounded border border-[color:var(--p-line)] px-2 py-0.5 text-[var(--p-text-soft)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
              onClick={() => void navigator.clipboard.writeText(state.code!.link)}
            >
              Copy address
            </button>
          </div>
        </div>
      )}
      {state.on && !root && <p>Open a folder in a tab to pair a phone to it.</p>}
      <div className="flex flex-col gap-1">
        <span className="font-medium text-[var(--p-text)]">Paired phones</span>
        {state.phones.length === 0 && <span>None yet.</span>}
        {state.phones.map((p) => (
          <div key={p.token} className="flex items-center justify-between gap-3" data-phone-row>
            <span className="min-w-0 truncate">
              <span className="text-[var(--p-text)]">{p.name}</span>{' '}
              {state.watching.includes(p.token)
                ? 'watching now'
                : `seen ${new Date(p.seen).toLocaleString()}`}
            </span>
            <button
              className="shrink-0 rounded px-2 py-0.5 text-[var(--p-text-soft)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-text)]"
              onClick={() => void window.prism.phoneForget(p.token, root).then(setState)}
            >
              Forget
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <Dialog
      title="Prism on your phone"
      body={body}
      choices={[{ label: 'Close', onPick: onClose, primary: true }]}
      onCancel={onClose}
    />
  )
}
