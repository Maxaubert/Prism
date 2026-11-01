/**
 * THE ARCHIVE VERBS, ONCE (structure cleanup, 2026-10-12). The member panel
 * (ArchiveView, the phone's and a nested zip's) and a place inside a zip in
 * the Explorer or the tree (useArchiveActions, #300) used to carry their own
 * copies of the password retry, the add with its clash and its move, and the
 * permanent delete, and the copies had started to say different things.
 *
 * The runners here take main's calls as an argument, so a test hands them
 * fakes; `useArchiveOps` holds the questions they raise and draws them.
 */
import type { ExtractFail } from '@shared/extraction'
import type { UndoEntry } from '../../lib/undo'

export type ArchiveFail = ExtractFail

/** Main's archive calls the runners use; `window.prism` in the app. */
export type ArchiveIpc = Pick<
  Window['prism'],
  | 'archiveAdd'
  | 'archiveDelete'
  | 'archiveRename'
  | 'trashFile'
  | 'archiveStageMembers'
  | 'archiveUnstage'
>

/** Every line the archive verbs say. One table, so a fix lands everywhere. */
export const ARCHIVE_COPY = {
  // Prism ships its own 7-Zip, so reaching this means the bundled copy is
  // missing rather than that the machine lacks one.
  aes: (name: string): string =>
    `"${name}" is AES-encrypted, and the 7-Zip that opens those is missing from this install.`,
  unreadable: (name: string): string => `Couldn't read "${name}" from the archive.`,
  addEncrypted: "Prism can't add to a password-protected archive.",
  addFailed: "Those couldn't be added to the archive.",
  renameFailed: (name: string): string =>
    `Couldn't rename to "${name}". The name may be taken or invalid.`,
  otherArchive: 'That came from another archive. Extract it first, then add it here.',
  readOnly: "This archive can't be changed. Extract it to make changes.",
  moveEncrypted: "Prism can't rearrange a password-protected archive.",
  moveFailed: "Those couldn't be moved inside the archive.",
  deleteTitle: (names: readonly string[]): string =>
    names.length > 1
      ? `Delete ${names.length} items from the archive?`
      : `Delete "${names[0]}" from the archive?`,
  deleteBody: (count: number): string =>
    `This is permanent: a zip has no Recycle Bin to take ${count > 1 ? 'them' : 'it'} back from.`,
  deleteFailed: (failed: number, names: readonly string[]): string =>
    names.length === 1
      ? `Couldn't delete "${names[0]}".`
      : `${failed} of ${names.length} couldn't be deleted from the archive.`,
  clashTitle: (names: readonly string[]): string =>
    names.length > 1
      ? `${names.length} names are already in the archive`
      : `"${names[0]}" is already in the archive`,
  clashBody: 'Keep both adds them beside what is there. Nothing has been written yet.'
} as const

/** What a password question needs: whose, whether one was already refused,
 *  and what to do with the answer. */
export interface PassQuestion {
  name: string
  wrong: boolean
  run: (password: string) => void
}

/**
 * Run a member action with the remembered password; on 'password' ask, and
 * again when the answer was wrong. A password that worked is remembered for
 * the archive. 'aes' and 'failed' are said once, in the message box.
 */
export function runWithPassword(opts: {
  name: string
  run: (pw: string | undefined) => Promise<ArchiveFail | 'ok'>
  remembered: string | undefined
  remember: (pw: string) => void
  ask: (q: PassQuestion) => void
  say: (message: string) => void
}): void {
  const attempt = (pw: string | undefined, wrong: boolean): void => {
    void opts.run(pw).then((r) => {
      if (r === 'ok') {
        if (pw) opts.remember(pw)
        return
      }
      if (r === 'password')
        opts.ask({ name: opts.name, wrong, run: (answer) => attempt(answer, true) })
      else if (r === 'aes') opts.say(ARCHIVE_COPY.aes(opts.name))
      else opts.say(ARCHIVE_COPY.unreadable(opts.name))
    })
  }
  attempt(opts.remembered, false)
}

export type AddOutcome =
  | { kind: 'said'; message: string }
  | { kind: 'clash'; names: string[] }
  /** `entries`: each member's name inside the zip as written, for the
   *  landing marks (#70, #101). */
  | { kind: 'added'; entries: string[]; undo: UndoEntry | null }

/**
 * Real files into a zip. A taken name stops it before anything is written
 * (the caller asks, then calls again with `keepBoth`). A MOVE of Prism's own
 * rows (owner, 2026-08-22; the plain drag on one drive since #70) bins the
 * originals once the members are safely in, and the undo entry takes both
 * halves back. A COPY (Ctrl, another drive, files from Windows, a zip's
 * members from another zip) leaves them, and like a paste it is not on the
 * undo stack (#70 D4).
 */
export async function addMembers(
  ipc: ArchiveIpc,
  add: { container: string; paths: string[]; dest: string; keepBoth: boolean; move: boolean }
): Promise<AddOutcome> {
  const r = await ipc.archiveAdd(add.container, add.paths, add.dest, add.keepBoth)
  if (r === 'encrypted') return { kind: 'said', message: ARCHIVE_COPY.addEncrypted }
  if (r === 'failed') return { kind: 'said', message: ARCHIVE_COPY.addFailed }
  if (r.clashes.length) return { kind: 'clash', names: r.clashes }
  const entries = r.added.map((a) => a.entry)
  if (!add.move || !r.added.length) return { kind: 'added', entries, undo: null }
  const originals: string[] = []
  for (const a of r.added) if (await ipc.trashFile(a.src)) originals.push(a.src)
  return {
    kind: 'added',
    entries,
    undo: {
      kind: 'archive-in',
      zip: add.container,
      dest: add.dest,
      entries: r.added.map((a) => a.entry),
      originals
    }
  }
}

/**
 * ZIP A TO ZIP B IS A COPY (#70 D9; owner approved the spec "as recommended",
 * 2026-11-01; review fix the same day). The members go out to a staging
 * folder main makes in the run's member folder, through the extraction
 * window (progress and Cancel at any size), then `add` puts them in the other
 * zip, and the folder is dropped once the add is over, however it ended. A
 * Cancel or a failure is the window's to show; `password` is the caller's to
 * ask. It used to read file members past the preview limit with no window,
 * and leave a temp folder behind per folder member.
 */
export async function copyBetweenZips(
  ipc: ArchiveIpc,
  from: { container: string; entries: string[]; password: string | undefined },
  toZip: string,
  add: (paths: string[]) => Promise<void>
): Promise<ArchiveFail | 'ok'> {
  const staged = await ipc.archiveStageMembers(from.container, from.entries, from.password, toZip)
  if (!staged.ok) return staged.reason === 'password' ? 'password' : 'ok'
  try {
    if (staged.paths.length) await add(staged.paths)
  } finally {
    await ipc.archiveUnstage(staged.dir)
  }
  return 'ok'
}

/** Delete members, one at a time, permanently. The answer is what to say,
 *  or null when every one went. */
export async function deleteMembers(
  ipc: ArchiveIpc,
  container: string,
  inners: readonly string[],
  names: readonly string[]
): Promise<string | null> {
  let failed = 0
  for (const p of inners) if (!(await ipc.archiveDelete(container, p))) failed += 1
  return failed ? ARCHIVE_COPY.deleteFailed(failed, names) : null
}

/** Rename one member. 'failed' is said here and reported as handled, so the
 *  password runner does not say a second thing over it. */
export async function renameMember(
  ipc: ArchiveIpc,
  rename: { container: string; inner: string; name: string; pw: string | undefined },
  done: () => void,
  say: (message: string) => void
): Promise<ArchiveFail | 'ok'> {
  const r = await ipc.archiveRename(rename.container, rename.inner, rename.name, rename.pw)
  if (r === 'ok') {
    done()
    return 'ok'
  }
  if (r === 'failed') {
    say(ARCHIVE_COPY.renameFailed(rename.name))
    return 'ok'
  }
  return r
}
