/**
 * ONE PASSWORD QUESTION PER ARCHIVE (owner, 2026-11-09). The preview of a
 * locked member, an extract of it, the Explorer going in and the archive panel
 * each put up their own question, so two at once stood on top of each other
 * and the right password went to the wrong one. Every asker comes here, and
 * `ArchiveQuestion` draws the one question there is.
 *
 * A request for an archive already being asked about joins that question and
 * gets its answer. Each joiner tries the answer itself, so a wrong one brings
 * them all back, to one question again. A Cancel answers every joiner with
 * null, and they drop what they were doing.
 *
 * Two kinds of request come back too late to join, and both are settled here:
 * one that tried no password and returns after the answer was given is handed
 * that answer, and one that began before a Cancel is dropped with it.
 *
 * Questions about DIFFERENT archives wait in line, oldest first. All of this
 * is per window and lives only in memory, like `archivePass`.
 */
import { useSyncExternalStore } from 'react'

export interface ArchiveQuestionUp {
  archive: string
  name: string
  wrong: boolean
}

interface Question extends ArchiveQuestionUp {
  key: string
  askers: Set<(password: string | null) => void>
}

export interface ArchiveAsk {
  /** The password to try, or null when the question was cancelled. Never
   *  settles once withdrawn. */
  answer: Promise<string | null>
  /** The asker has gone (its file is no longer on screen): the question stays
   *  only if somebody else still wants it. */
  withdraw: () => void
}

const line: Question[] = []
/** The last answer given per archive, right or not yet known to be. */
const given = new Map<string, string>()
const cancelled = new Map<string, number>()
const listeners = new Set<() => void>()

const tell = (): void => listeners.forEach((l) => l())

const settled = (password: string | null): ArchiveAsk => ({
  answer: Promise.resolve(password),
  withdraw: () => {}
})

export function askArchivePassword(request: {
  /** The container, as main names it. */
  archive: string
  /** What the question calls the thing it opens. */
  name: string
  /** A password was already refused. */
  wrong: boolean
  /** The password this request just tried, if any. */
  tried?: string
  /** `performance.now()` from before the request went to main. */
  began?: number
}): ArchiveAsk {
  const key = request.archive.toLowerCase()
  const stop = cancelled.get(key)
  if (request.began !== undefined && stop !== undefined && request.began <= stop) return settled(null)
  const newer = given.get(key)
  if (newer !== undefined && newer !== request.tried) return settled(newer)
  let question = line.find((q) => q.key === key)
  if (!question) {
    question = {
      key,
      archive: request.archive,
      name: request.name,
      wrong: request.wrong,
      askers: new Set()
    }
    line.push(question)
    tell()
  }
  const joined = question
  let asker: (password: string | null) => void = () => {}
  const answer = new Promise<string | null>((resolve) => {
    asker = resolve
  })
  joined.askers.add(asker)
  return {
    answer,
    withdraw: () => {
      joined.askers.delete(asker)
      const at = line.indexOf(joined)
      if (joined.askers.size === 0 && at >= 0) {
        line.splice(at, 1)
        tell()
      }
    }
  }
}

/** The question in front answered: a password, or null for Cancel. */
export function answerArchiveQuestion(password: string | null): void {
  const question = line.shift()
  if (!question) return
  if (password === null) {
    given.delete(question.key)
    cancelled.set(question.key, performance.now())
  } else given.set(question.key, password)
  tell()
  question.askers.forEach((asker) => asker(password))
}

/** The question to draw; the same object until it is answered. */
export function archiveQuestionUp(): ArchiveQuestionUp | null {
  return line[0] ?? null
}

export function onArchiveQuestion(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Is a password question up in this window. */
export function useArchiveQuestionUp(): boolean {
  return useSyncExternalStore(onArchiveQuestion, archiveQuestionUp) !== null
}
