import { describe, expect, it, vi } from 'vitest'
import { watchAppCopies } from './appCopyNotice'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve()
}

const setup = (opts: { mouse?: boolean } = {}) => {
  let clip = 'old'
  const announce = vi.fn()
  const waits: Array<() => void> = []
  const w = watchAppCopies({
    read: async () => clip,
    programHasMouse: () => opts.mouse ?? true,
    announce,
    wait: () => new Promise<void>((r) => waits.push(r))
  })
  const tick = async (): Promise<void> => {
    await flush()
    waits.shift()?.()
    await flush()
  }
  return { w, announce, set: (t: string) => (clip = t), tick }
}

describe('"Copied" for a program that copies its own selection (2026-10-16)', () => {
  it('a drag that changes the clipboard shows the badge, once', async () => {
    const { w, announce, set, tick } = setup()
    w.down(10, 10, 1)
    await flush()
    w.up(80, 10)
    set('copied text')
    await tick()
    await tick()
    await tick()
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it('a copy that lands late is still heard', async () => {
    const { w, announce, set, tick } = setup()
    w.down(10, 10, 1)
    await flush()
    w.up(80, 10)
    await tick()
    await tick()
    set('late')
    await tick()
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it('a plain click, or a clipboard that did not change, says nothing', async () => {
    const a = setup()
    a.w.down(10, 10, 1)
    a.w.up(11, 10)
    a.set('changed')
    for (let i = 0; i < 3; i += 1) await a.tick()
    expect(a.announce).not.toHaveBeenCalled()
    const b = setup()
    b.w.down(10, 10, 1)
    b.w.up(90, 10)
    for (let i = 0; i < 3; i += 1) await b.tick()
    expect(b.announce).not.toHaveBeenCalled()
  })

  it('a double click counts; a terminal that has the mouse itself is not watched', async () => {
    const a = setup()
    a.w.down(10, 10, 2)
    await flush()
    a.w.up(10, 10)
    a.set('word')
    for (let i = 0; i < 3; i += 1) await a.tick()
    expect(a.announce).toHaveBeenCalledTimes(1)
    const b = setup({ mouse: false })
    b.w.down(10, 10, 1)
    b.w.up(90, 10)
    b.set('x')
    for (let i = 0; i < 3; i += 1) await b.tick()
    expect(b.announce).not.toHaveBeenCalled()
  })
})

// Owner, 2026-10-16: with Claude's Copy on select off, "highlighting text then
// clicking ctrl c does nothing ... it shows no chip".
describe('the program\'s own selection, copied with Ctrl+C', () => {
  it('stands from the selecting release until a press, another key or the copy', async () => {
    const { w } = setup()
    expect(w.selecting()).toBe(false)
    w.down(10, 10, 1)
    w.up(80, 10)
    expect(w.selecting()).toBe(true)
    w.otherKey()
    expect(w.selecting()).toBe(false)
    w.down(10, 10, 2)
    w.up(10, 10)
    expect(w.selecting()).toBe(true)
    w.down(50, 50, 1)
    expect(w.selecting()).toBe(false)
    w.up(51, 50)
    expect(w.selecting()).toBe(false)
  })

  it('Ctrl+C on it shows the badge once the program has copied', async () => {
    const { w, announce, set, tick } = setup()
    w.down(10, 10, 2)
    await flush()
    w.up(10, 10)
    // Copy on select off: the release copies nothing.
    for (let i = 0; i < 3; i += 1) await tick()
    expect(announce).not.toHaveBeenCalled()
    w.copyKey()
    expect(w.selecting()).toBe(false)
    set('the word')
    await tick()
    expect(announce).toHaveBeenCalledTimes(1)
  })

  // Perf review 2026-10-16: every press read the whole clipboard through main.
  it('a plain click reads no clipboard; a drag reads it from its release on', async () => {
    const read = vi.fn(async () => 'same')
    const w = watchAppCopies({ read, programHasMouse: () => true, announce: vi.fn(), wait: async () => {} })
    for (let i = 0; i < 5; i += 1) {
      w.down(10, 10, 1)
      w.up(11, 10)
    }
    await flush()
    expect(read).not.toHaveBeenCalled()
    w.down(10, 10, 1)
    expect(read).not.toHaveBeenCalled()
    w.up(80, 10)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('a Ctrl+C with no selection of its own looks at nothing', async () => {
    const { w, announce, set, tick } = setup()
    w.copyKey()
    set('something')
    for (let i = 0; i < 3; i += 1) await tick()
    expect(announce).not.toHaveBeenCalled()
  })
})

// The drag's clipboard is read when it becomes a drag, before the release the
// program copies on: a copy faster than the read must still raise the badge.
describe('a drag is read as it starts', () => {
  it('a copy that lands the instant the button is released is still heard', async () => {
    const { w, announce, set, tick } = setup()
    w.down(10, 10, 1)
    w.move(12, 10)
    w.move(40, 10)
    await flush()
    set('copied at once')
    w.up(80, 10)
    await tick()
    expect(announce).toHaveBeenCalledTimes(1)
  })
})
