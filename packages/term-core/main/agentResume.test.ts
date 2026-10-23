import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { CODEX_RESUME, claudeSessions, claudeSessionsAsync, isInteractiveHead, validResume } from './agentResume'

describe('validResume', () => {
  it('accepts a session id and the codex marker, refuses a command', () => {
    expect(validResume('3f2a9c1e-77aa-4c0d-9b1e-0a1b2c3d4e5f')).toBeTruthy()
    expect(validResume(CODEX_RESUME)).toBe(CODEX_RESUME)
    expect(validResume('x; rm -rf')).toBeUndefined()
  })
  it('refuses an id with a command riding behind it, and nothing at all', () => {
    expect(validResume('3f2a9c1e-77aa-4c0d-9b1e-0a1b2c3d4e5f; calc')).toBeUndefined()
    expect(validResume('')).toBeUndefined()
    expect(validResume(undefined)).toBeUndefined()
  })
})

describe('claudeSessions', () => {
  it("reads claude's own store for the folder, newest first", () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    // claude's encoding: every non-alphanumeric character becomes a dash.
    const dir = join(home, '.claude', 'projects', 'C--Users-me-my-project')
    mkdirSync(dir, { recursive: true })
    const at = (name: string, secs: number): void => {
      writeFileSync(join(dir, name), '')
      utimesSync(join(dir, name), secs, secs)
    }
    at('old.jsonl', 1_000_000)
    at('new.jsonl', 2_000_000)
    at('notes.txt', 3_000_000)
    expect(claudeSessions('C:\\Users\\me\\my project', home)).toEqual(['new', 'old'])
  })
  it('answers nothing for a folder claude never recorded', () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    expect(claudeSessions('C:\\nowhere', home)).toEqual([])
  })
})

// The first lines of real transcripts (2026-09-28), trimmed: a commit hook's
// SDK review run, and the owner's own conversation in a terminal.
const SDK_HEAD =
  '{"type":"queue-operation","operation":"enqueue","timestamp":"2026-09-28T18:02:10.114Z","content":"Review this change for security vulnerabilities."}\n' +
  '{"parentUuid":null,"isSidechain":false,"userType":"external","entrypoint":"sdk-py","type":"user"}\n'
const CLI_HEAD =
  '{"type":"last-prompt","lastPrompt":"prism stable was closed"}\n' +
  '{"parentUuid":null,"isSidechain":false,"userType":"external","entrypoint":"cli","type":"user"}\n'

describe('isInteractiveHead', () => {
  it('keeps a conversation somebody had in a terminal', () => {
    expect(isInteractiveHead(CLI_HEAD)).toBe(true)
  })
  it("refuses a session a tool started through the SDK, by either mark", () => {
    expect(isInteractiveHead(SDK_HEAD)).toBe(false)
    expect(isInteractiveHead('{"type":"user","entrypoint":"sdk-cli"}\n')).toBe(false)
  })
  it('keeps a transcript that says neither, as older claude wrote them', () => {
    expect(isInteractiveHead('{"type":"user","message":{"role":"user"}}\n')).toBe(true)
    expect(isInteractiveHead('')).toBe(true)
  })
})

describe('only your own conversations are resumed', () => {
  it("skips a NEWER session a tool started in the same folder", async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const dir = join(home, '.claude', 'projects', 'C--Users-me-repo')
    mkdirSync(dir, { recursive: true })
    const at = (name: string, body: string, secs: number): void => {
      writeFileSync(join(dir, name), body)
      utimesSync(join(dir, name), secs, secs)
    }
    at('mine-11111111.jsonl', CLI_HEAD, 1_000_000)
    at('review-2222222.jsonl', SDK_HEAD, 2_000_000)
    expect(await claudeSessionsAsync('C:\\Users\\me\\repo', home)).toEqual(['mine-11111111'])
    expect(claudeSessions('C:\\Users\\me\\repo', home)).toEqual(['mine-11111111'])
  })
})

describe('claudeSessionsAsync', () => {
  it('gives exactly the answer the synchronous walk gives, across many files', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    const dir = join(home, '.claude', 'projects', 'C--Users-me-busy')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 60; i += 1) {
      const f = join(dir, `s${i}.jsonl`)
      writeFileSync(f, '')
      utimesSync(f, 1_000_000 + ((i * 37) % 60) * 10, 1_000_000 + ((i * 37) % 60) * 10)
    }
    writeFileSync(join(dir, 'notes.txt'), '')
    const sync = claudeSessions('C:\\Users\\me\\busy', home)
    // The first 32 interactive ones, newest first: more than any folder's
    // tabs could use (2026-09-28).
    expect(sync).toHaveLength(32)
    expect(await claudeSessionsAsync('C:\\Users\\me\\busy', home)).toEqual(sync)
  })
  it('answers nothing for a folder claude never recorded', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pt-home-'))
    expect(await claudeSessionsAsync('C:\\nowhere', home)).toEqual([])
  })
})
