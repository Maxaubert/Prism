# Main never waits on the disk: plan

Owner, 2026-10-12: after a 3.9 s freeze traced to `writeFileSync` of `tabs.json` on the main
thread ("ok yes plan then go ahead", to: convert the main process's synchronous disk calls that
run while the user works, and add a test that blocks new ones).

## The rule

The main process never waits on the disk or on another program while the user works. A
synchronous call is allowed only at startup (before the first window shows), at quit, inside a
worker thread or child process, or where a synchronous answer is the design (a `sendSync` IPC
that paints in the same frame, the root wall's path check); each such call carries a
`// sync-ok: <reason>` comment on its line or the line above.

## Inventory (2026-10-12)

163 synchronous calls in `src/main` (classified by tracing each to its trigger; the full list is
the workflow output kept with this plan's PR): 68 on live hot paths, 69 on live rare paths, 18
at startup, 3 at quit, 5 test-only.

## Steps

1. **Leaf modules** (each owns its files; none edits `index.ts`): add async variants (or make
   the module async where all callers can await) for `fileOps` (uniqueName, renameFile),
   `moveOps` (moveEntries and its merge walk), `openWith`, `crashLog`, `everything`,
   `videoConvert`, `midi`, `peaks`, `subtitles`, `docConvert`, `comic`, `rawPreview`,
   `audioSidecar`, `docImages`, `memberTemp`, `sevenZip`, `archive` (its fs calls),
   `archiveBrowse` (an async `container`), `explorerWindow`. Two sync-IPC modules keep their
   synchronous answer from memory and persist off main: `windowPreferences` (an in-memory
   snapshot, refreshed asynchronously from its watcher, written with an async atomic write
   serialized per key) and `listingCache` (its index written asynchronously on the debounce; the
   per-folder `browse:cached` read stays a `sendSync` by design, marked `sync-ok`).
2. **`index.ts`**: every IPC handler and timer on the inventory awaits the async variants; the
   window-state save becomes an async atomic write like the tab strip's; `file:stat` awaits;
   `seven()` and the archive handlers await. Startup reads stay, marked.
3. **The guard**: `src/main/syncCalls.test.ts` scans `src/main/**/*.ts` (not tests) for any
   `*Sync(` call and `execSync` / `execFileSync` / `spawnSync`; each must carry `sync-ok:`.
   Unmarked ones fail `npm test` with file:line.
4. **Known remainder, named not hidden**: `adm-zip` reads and writes whole archives
   synchronously (`archive.ts`: list, rename, delete, add, move within a zip). Its calls are
   marked `sync-ok` with "adm-zip is synchronous; moving zip edits to a worker is the follow-up".
5. **Proof**: unit tests for every changed module; the full e2e; the e2e's stall report
   (main-lag lines) compared with the run before this branch.
