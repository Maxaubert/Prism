import { useState, type JSX } from 'react'

/** The screen with no token: paste the code, or the link already carried it. */
export function Pairing({
  initialCode,
  error,
  onPair
}: {
  initialCode: string | null
  error: string | null
  onPair: (code: string) => Promise<void>
}): JSX.Element {
  const [code, setCode] = useState(initialCode ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
      data-phone-pairing
    >
      <h1 className="text-2xl font-semibold">Prism</h1>
      <p className="opacity-70">
        Open Tools &gt; Phone on the PC and scan the code, or type it here.
      </p>
      <input
        className="w-48 rounded border border-[color:var(--p-line)] bg-transparent px-3 py-2 text-center text-xl uppercase tracking-[0.3em]"
        value={code}
        maxLength={6}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Pairing code"
        onChange={(e) => setCode(e.target.value.toUpperCase())}
      />
      {error && (
        <p className="text-red-400" role="alert">
          {error}
        </p>
      )}
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
