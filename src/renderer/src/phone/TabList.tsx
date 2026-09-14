import { useCallback, useEffect, useState, type JSX } from 'react'
import type { PhoneTab } from '@shared/types'
import { FolderGlyph } from './FolderGlyph'
import { ROW_CLASS } from './rows'
import { listTabs } from './tabs'

/**
 * The tabs the PC has open, and switching to one (2026-09-08, #107, owner:
 * "i should be able to switch tabs without scanning a new qr code. i should
 * be able to see the available tabs and switch").
 *
 * IT IS A LIST, NOT A THING ANYBODY CURATES: it is read fresh from the PC
 * every time it is shown, because a tab closes without telling the phone and
 * a held list offers a folder that is gone. That is also why a REFUSED pick
 * re-reads rather than only complaining - "that folder is not open in Prism
 * any more" is a list that has moved on, and the answer is to show the one
 * that has.
 *
 * The rows are the explorer's own, so a tab is tapped the way a folder is:
 * a folder glyph, the name over its path, and a DRAWN tick on the right of
 * the one the phone is on (2026-09-14, #145 - the tick used to be a text
 * glyph in a column of its own on the left, which held the names off the
 * edge and read as a menu rather than a list of places).
 */
export function TabList({ onPick }: { onPick: (root: string) => Promise<void> }): JSX.Element {
  const [tabs, setTabs] = useState<PhoneTab[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A promise chain rather than an async body, the shape the shell uses: an
  // await inside a function an effect calls reads to the hooks rule as a
  // synchronous setState. State is set only in the callbacks.
  const load = useCallback(
    (): Promise<void> =>
      listTabs().then(
        (t) => {
          setTabs(t)
          setError(null)
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e))
      ),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  const pick = (root: string): void => {
    void onPick(root).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      void load()
    })
  }

  return (
    <div className="flex flex-col" data-phone-tabs>
      {error && (
        <p className="px-4 py-3 text-red-400" role="alert">
          {error}
        </p>
      )}
      {tabs === null && !error && <p className="px-4 py-3 opacity-70">Loading...</p>}
      {tabs?.length === 0 && (
        <p className="px-4 py-3 opacity-70">Prism has no folder open right now.</p>
      )}
      <ul className="flex flex-col px-2" role="list">
        {(tabs ?? []).map((t) => (
          <li key={t.root}>
            <button
              className={`${ROW_CLASS} rounded-xl ${t.current ? 'bg-[var(--p-hover)]' : ''}`}
              onClick={() => pick(t.root)}
              data-phone-tab-row
              aria-current={t.current ? 'true' : undefined}
            >
              <FolderGlyph size={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{t.name}</span>
                {/* The path, because two open folders can share a name and
                    this list has the room the PC's tab strip does not. */}
                <span className="block truncate text-[13px] text-[var(--p-text-soft)]">{t.root}</span>
              </span>
              {t.current && (
                <svg
                  viewBox="0 0 24 24"
                  width={22}
                  height={22}
                  fill="none"
                  stroke="var(--color-accent-hi)"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                  aria-hidden
                  data-phone-tab-tick
                >
                  <path d="M4.5 12.5l5 5 10-11" />
                </svg>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
