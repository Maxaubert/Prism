import { describe, expect, it } from 'vitest'
import { watchDragInFlight } from './dragInFlight'

function setup(): { win: EventTarget; log: string[]; stop: () => void } {
  const win = new EventTarget()
  const log: string[] = []
  const stop = watchDragInFlight(
    win,
    () => log.push('on'),
    () => log.push('off')
  )
  return { win, log, stop }
}
const fire = (win: EventTarget, type: string, relatedTarget: unknown = null): void => {
  win.dispatchEvent(Object.assign(new Event(type), { relatedTarget }))
}

describe('the drag-in-flight flag (audit #45)', () => {
  it('starts on dragenter and ends on drop or dragend', () => {
    const { win, log } = setup()
    fire(win, 'dragenter')
    fire(win, 'drop')
    fire(win, 'dragstart')
    fire(win, 'dragend')
    expect(log).toEqual(['on', 'off', 'on', 'off'])
  })

  it('ends when an outside drag leaves the window, but not when it moves between elements', () => {
    const { win, log } = setup()
    fire(win, 'dragenter')
    fire(win, 'dragleave', {})
    expect(log).toEqual(['on'])
    fire(win, 'dragleave', null)
    expect(log).toEqual(['on', 'off'])
  })

  it('stops listening when removed', () => {
    const { win, log, stop } = setup()
    stop()
    fire(win, 'dragenter')
    fire(win, 'dragleave')
    expect(log).toEqual([])
  })
})