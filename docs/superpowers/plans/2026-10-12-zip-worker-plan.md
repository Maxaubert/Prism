# Zip work off the main process: plan

Owner, 2026-10-12 ("handle this, create a plan then go ahead"), the follow-up #365 named: adm-zip
reads and writes whole archives synchronously, so listing, previewing a member of, renaming in,
deleting from, adding to or moving inside a zip (up to the 600 MB write cap) freezes Prism's main
process for as long as that takes.

## Design

- **A zip utility process**, the HEIC worker's pattern (`heicWorker.ts`, `utilityProcess.fork` of
  its own `electron.vite.config` entry): `src/main/zipWorker.ts` owns every adm-zip call. Main
  sends `{ id, op, args }`, the worker answers `{ id, ok, result | error }`; a job's error comes
  back as the same Error message the sync code threw, so callers' handling is unchanged.
- **One file, one writer.** Edits to the same archive run one at a time in submission order (a
  per-path queue in main), reads may run alongside; the worker processes one message at a time
  anyway, so this is about keeping main's view (caches, `seven()` stats, listing caches) ordered.
- **Kept warm, not forever**: like HEIC, idle for 60 s then killed; a crash or exit rejects every
  pending job and the next job forks a fresh one.
- **`archive.ts` keeps its exports** (`listArchive`, `extractMember`, `renameMember`,
  `deleteMember`, `archiveStat`, `addToArchive`, `moveMembers`, `hasEncrypted`'s callers), now
  async and thin: they post to the worker. The adm-zip code moves into `zipOps.ts`, pure of
  Electron, imported only by the worker and by unit tests, so its tests still run in vitest
  without a utility process. Its `sync-ok: adm-zip` markers move with it (the worker is not main;
  `syncCalls.test.ts` skips `zipWorker.ts`/`zipOps.ts` or they keep their markers).
- 7-Zip (`sevenZip.ts`) already runs as a child process and is untouched.

## Proof

Unit tests for `zipOps.ts` (the moved logic, unchanged behaviour) and for the main-side client
(queueing per path, error propagation, worker exit rejecting pending jobs, idle kill). The e2e
`zipMenus`, `zipWrites`, archive and phone archive scenarios, then the full suite. A new check in
`zipWrites`: while a large zip is being written, the main process keeps answering (an IPC
round trip under 200 ms during the write).
