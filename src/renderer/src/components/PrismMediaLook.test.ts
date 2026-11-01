import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { useMediaLook, type MediaLook } from '../lib/viz/mediaLook'
import { useViz, vizState, type VizState } from '../lib/viz/vizStore'
import { PrismMediaLook } from './PrismMediaLook'

/**
 * Prism's provider follows the live store (#29, 2026-11-01).
 *
 * `useViz()` is the subscribing hook: each Settings change hands the provider a
 * new snapshot, and the players under it re-render with it. If the provider read
 * the store once (`vizState()`), a playing player would keep the old look until
 * it remounted. The test stands in for the store's hook, renders the provider
 * twice with two snapshots, and checks that the player sees each one.
 */

vi.mock('../lib/viz/vizStore', async (actual) => {
  const real = await actual<typeof import('../lib/viz/vizStore')>()
  return { ...real, useViz: vi.fn(real.vizState) }
})

const hook = vi.mocked(useViz)

afterEach(() => {
  hook.mockImplementation(vizState)
})

/** Renders a player under the provider and returns the look it read. */
function lookUnderProvider(): MediaLook {
  let seen: MediaLook | null = null
  const Player = (): null => {
    seen = useMediaLook()
    return null
  }
  renderToString(createElement(PrismMediaLook, null, createElement(Player)))
  if (!seen) throw new Error('the player never rendered')
  return seen
}

describe("Prism's provider follows the store's live settings (#29)", () => {
  it('reads the settings through the subscribing hook', () => {
    lookUnderProvider()
    expect(hook).toHaveBeenCalled()
  })

  it('a new snapshot from the store reaches the player with its new values', () => {
    const before: VizState = { ...vizState(), height: 31, barTheme: 'scheme-a', glow: false }
    const after: VizState = { ...before, height: 64, barTheme: 'scheme-b', glow: true }

    hook.mockImplementation(() => before)
    const first = lookUnderProvider()
    expect(first.viz).toMatchObject({ height: 31, barTheme: 'scheme-a', glow: false })

    hook.mockImplementation(() => after)
    const second = lookUnderProvider()
    expect(second.viz).toMatchObject({ height: 64, barTheme: 'scheme-b', glow: true })
  })
})
