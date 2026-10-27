# Explorer only: Prism without the terminal and projects (2026-10-26)

Owner decision 2026-10-26: Prism becomes an Explorer + viewer. The terminal, dictation and
project tabs (with their file tree) go. The phone page stays. Reason: a fast viewer should not
carry what the owner never uses, and the terminal's agent poll is the measured cause of the
~5 s startup freeze (diag.jsonl 2026-10-21, 24, 26; reproduced 7 of 8 runs).

## What stays

Explorer tabs (pinned + extra), every viewer, search, rename/move/delete, Properties, archives,
Win+E, file associations, the folder handler (#393), the update chip and window, Settings
(frame, Appearance, Explorer, Media, About, Diagnostics), 18 themes and the colour picker, the
phone page, `npm run diag`.

## What goes

- **Terminal**: node-pty, `@xterm/*`, TermDock / TerminalPanel, the agent poll, shell detection,
  agent resume, Claude plugin, Settings > Terminal and Agents, the terminal button and menus,
  CloseAgentDialog.
- **Dictation**: the Whisper engine (`resources/bin/whisper`, `fetch:whisper`), the microphone
  permission, Settings > Dictation. `%LOCALAPPDATA%\PrismDictation` is never deleted (Flare may
  use it).
- **Projects**: project tabs, the Sidebar file tree, pinned panes, Settings > Project, the
  Projects group in places, the tree's dir re-listing.

## Behaviour changes

| Entry point | Today | After |
|---|---|---|
| Double-click / file association / argv file | project tab with tree | Explorer tab, file open in its full viewer, folder behind it |
| Folder from argv, drop, "Open as project" verb | project tab | Explorer tab at that folder; the verb is relabelled "Open in Prism" on the next start |
| Saved `role:'project'` tabs | restored with tree | migrated to Explorer tabs at their folder (open file kept) |
| PDF external links | via the terminal bridge | Prism's own `openExternal` channel |
| Mic / camera | mic granted for dictation | all `media` permission denied |

## How

- `packages/term-core` is PRUNED, not deleted: it also holds the settings frame, update chip,
  diag log, colour maths and Tooltips (a transitive import scan names ~45 kept modules). Every
  terminal, agent and dictation module goes; a rename to a UI-core name can follow later.
- Moved out of the core into `src/`: `recentRoots` (+ folderNames, same storage keys), the
  permission handler (deny media), `openExternal`.
- Cut type edges first (`IpcMainLike`, `IpcRendererLike` into their own files) so typecheck
  holds at every step.
- Kept pref keys keep their exact strings (`prism.term.colourFormat`, `prism.tree.size`,
  `prism.newtab.*`); `prefKeys.test.ts` holds that.
- The phone keeps `listDir` / `searchTree` on `PrismApi`.

## Tests and gates

- e2e harness: `launch(file)` seeds an Explorer tab with the file in its viewer instead of a
  project tab; ~45 scenarios retargeted from tree rows to Explorer rows. 11 terminal/dictation
  scenarios deleted, tree-only ones deleted, `tailScenario` and unsaved-edit ones rerun on the
  Explorer seed (and the viewer gets a watch if a file stops hearing disk changes).
- `terminal-gate.yml` becomes a runner-safe `ui-gate` keeping the non-terminal scenarios it
  ran (tabs, sort, pinRecent, settingsLook, diagLog, updateWindow, updateGuard, updateQuiet).
- New unit tests: old saved tab with `role:'project'` + `term:'full'` restores as Explorer;
  permission handler denies media; openExternal channel.
- Full e2e green before the PR; install verified (no `whisper`, no `node-pty` in the build).

## Docs

CLAUDE.md (terminal sections and node-pty rules out), features.md entry with this decision,
architecture.md, menus.md, dialogs.md, THIRD-PARTY-NOTICES (xterm, node-pty, whisper out),
`docs/terminal-rules.md` deleted. Version 0.119.0.

## Plan (one PR, branch `strip/explorer-only`, worktree off origin/main)

1. Worktree + `npm install`; move type edges, `recentRoots`, permission handler, `openExternal`.
2. Remove the terminal and dictation (main, preload, renderer, core modules, deps, whisper).
3. Remove projects (tab role, Sidebar tree, panes, places group, Settings page); route every
   folder/file entry point to the Explorer; tabs.json migration + test.
4. Prune the core's package.json, settings index and channels; typecheck, lint, unit tests.
5. e2e harness reseed, scenario deletions and retargets; CI gate rename; full e2e green.
6. Docs, notices, version; package, check the asar, install, PR.
