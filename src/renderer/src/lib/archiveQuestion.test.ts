import { beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = typeof import('./archiveQuestion')
let q: Mod

// The module's state is the point of it, so each test gets a fresh one.
beforeEach(async () => {
  vi.resetModules()
  q = await import('./archiveQuestion')
})

const ask = (archive: string, extra: Partial<Parameters<Mod['askArchivePassword']>[0]> = {}) =>
  q.askArchivePassword({ archive, name: 'a.txt', wrong: false, ...extra })

describe('one password question per archive', () => {
  it('a second request joins the question and both get its answer', async () => {
    const first = ask('C:\\a.zip')
    const second = ask('c:\\A.ZIP')
    const up = q.archiveQuestionUp()
    expect(up?.archive).toBe('C:\\a.zip')
    q.answerArchiveQuestion('pw')
    expect(q.archiveQuestionUp()).toBeNull()
    await expect(first.answer).resolves.toBe('pw')
    await expect(second.answer).resolves.toBe('pw')
  })

  it('a Cancel drops every request on it', async () => {
    const first = ask('C:\\a.zip')
    const second = ask('C:\\a.zip')
    q.answerArchiveQuestion(null)
    await expect(first.answer).resolves.toBeNull()
    await expect(second.answer).resolves.toBeNull()
  })

  it('a request already under way when the question was cancelled is dropped too', async () => {
    const began = performance.now()
    ask('C:\\a.zip', { began })
    await new Promise((r) => setTimeout(r, 2))
    q.answerArchiveQuestion(null)
    await expect(ask('C:\\a.zip', { began }).answer).resolves.toBeNull()
    expect(q.archiveQuestionUp()).toBeNull()
  })

  it('asks again for a request that begins after a Cancel', () => {
    ask('C:\\a.zip')
    q.answerArchiveQuestion(null)
    ask('C:\\a.zip', { began: performance.now() + 1 })
    expect(q.archiveQuestionUp()?.archive).toBe('C:\\a.zip')
  })

  it('a request that returns after the answer was given is handed it without asking', async () => {
    ask('C:\\a.zip')
    q.answerArchiveQuestion('pw')
    await expect(ask('C:\\a.zip').answer).resolves.toBe('pw')
    expect(q.archiveQuestionUp()).toBeNull()
  })

  it('asks again when the request has tried that answer, so a wrong one cannot loop', () => {
    ask('C:\\a.zip')
    q.answerArchiveQuestion('wrong')
    ask('C:\\a.zip', { tried: 'wrong', wrong: true })
    expect(q.archiveQuestionUp()).toMatchObject({ wrong: true })
  })

  it('a withdrawn request leaves the question to whoever still wants it', () => {
    const first = ask('C:\\a.zip')
    const second = ask('C:\\a.zip')
    first.withdraw()
    expect(q.archiveQuestionUp()).not.toBeNull()
    second.withdraw()
    expect(q.archiveQuestionUp()).toBeNull()
  })

  it('questions about different archives wait in line', () => {
    ask('C:\\a.zip')
    ask('C:\\b.zip')
    expect(q.archiveQuestionUp()?.archive).toBe('C:\\a.zip')
    q.answerArchiveQuestion('pw')
    expect(q.archiveQuestionUp()?.archive).toBe('C:\\b.zip')
  })

  it('keeps one object for one question and tells listeners when it changes', () => {
    const heard = vi.fn()
    const off = q.onArchiveQuestion(heard)
    ask('C:\\a.zip')
    const up = q.archiveQuestionUp()
    ask('C:\\a.zip')
    expect(q.archiveQuestionUp()).toBe(up)
    expect(heard).toHaveBeenCalledTimes(1)
    q.answerArchiveQuestion('pw')
    expect(heard).toHaveBeenCalledTimes(2)
    off()
  })
})
