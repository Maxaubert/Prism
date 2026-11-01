import type { JSX, ReactNode } from 'react'
import { MediaLookContext } from '../lib/viz/mediaLook'
import { prismMediaLook } from '../lib/viz/prismMediaLook'
import { useViz } from '../lib/viz/vizStore'

/** Installs Prism's viz store and app theme as the players' look (#29). */
export function PrismMediaLook({ children }: { children: ReactNode }): JSX.Element {
  const look = prismMediaLook(useViz())
  return <MediaLookContext.Provider value={look}>{children}</MediaLookContext.Provider>
}
