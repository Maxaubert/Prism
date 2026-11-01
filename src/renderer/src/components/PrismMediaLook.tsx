import { useMemo, type JSX, type ReactNode } from 'react'
import { MediaLookContext } from '../lib/viz/mediaLook'
import { prismMediaLook } from '../lib/viz/prismMediaLook'
import { useViz } from '../lib/viz/vizStore'

/**
 * Installs Prism's viz store and app theme as the players' look (#29).
 * `useViz()` subscribes, so a Settings change reaches a playing player at once;
 * a one-time `vizState()` read here would freeze the look until it remounts
 * (PrismMediaLook.test.ts holds this). The look is rebuilt only when the store
 * hands out new settings, so a re-render of the stage alone does not re-render
 * every player that reads it.
 */
export function PrismMediaLook({ children }: { children: ReactNode }): JSX.Element {
  const viz = useViz()
  const look = useMemo(() => prismMediaLook(viz), [viz])
  return <MediaLookContext.Provider value={look}>{children}</MediaLookContext.Provider>
}
