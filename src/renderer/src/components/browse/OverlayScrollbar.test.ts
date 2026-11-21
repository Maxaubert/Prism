import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

// A tiny hooks runtime, so the component can be called and its handlers driven.
const refs: { current: unknown }[] = []
let cursor = 0
vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>()
  return {
    ...real,
    useState: (init: unknown): [unknown, () => void] => [
      typeof init === 'object' && init && 'scrollable' in init
        ? { ...init, scrollable: true, height: 100, thumbHeight: 20 }
        : init,
      () => {}
    ],
    useRef: (init: unknown): { current: unknown } => {
      const i = cursor++
      refs[i] ??= { current: init }
      return refs[i]
    },
    useEffect: (): void => {}
  }
})

import { OverlayScrollbar } from './OverlayScrollbar'

afterEach(() => vi.unstubAllGlobals())

type Handlers = Record<string, (e: unknown) => void>

describe('the list scrollbar thumb (audit #37)', () => {
  it('ends a drag when the pointer is lost, so the bar can hide again', () => {
    const timeouts: number[] = []
    vi.stubGlobal('window', {
      clearTimeout: () => {},
      setTimeout: (_fn: () => void, ms: number) => timeouts.push(ms)
    })
    cursor = 0
    const root = OverlayScrollbar({ target: { current: { scrollTop: 0 } as HTMLElement } }) as ReactElement<{
      children: ReactElement<Handlers>
    } & Handlers>
    const thumb = root.props.children.props as Handlers
    const pointer = {
      button: 0,
      pointerId: 1,
      clientY: 5,
      preventDefault: () => {},
      currentTarget: { setPointerCapture: () => {} }
    }
    thumb.onPointerDown(pointer)
    // While dragging, the pointer leaving the bar must not start the hide timer.
    root.props.onPointerLeave({})
    expect(timeouts).toEqual([])
    // Capture is lost with no pointerup: the drag ends and the bar may hide.
    expect(typeof thumb.onLostPointerCapture).toBe('function')
    thumb.onLostPointerCapture({})
    expect(timeouts).toEqual([900])
    root.props.onPointerLeave({})
    expect(timeouts).toEqual([900, 900])
  })
})