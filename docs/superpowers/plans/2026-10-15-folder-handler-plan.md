# Folder handler (#393): implementation plan

Spec: `docs/superpowers/specs/2026-10-15-folder-handler-design.md`. One branch, one PR in
Prism (`feat/folder-handler`, worktree `.claude/worktrees/folders`), then one PR in
PrismTerminal `core/`.

1. **Measure the rest** (registry backed up first, diffed after): with a stand-in default
   verb on `Directory`/`Drive`, double-click a folder in an Explorer window and on the
   desktop; check the menu row with and without `ProgrammaticAccessOnly`. Done when the
   owner is away from the screen or with their go-ahead. Results go in the spec table.
2. **Launcher `--folder`** in `native/win-e/PrismShortcut.cs`: launch Prism with
   `--browse=<UUID>`, wait for the ack, else `explorer.exe "<path>"`; raw command-line parse
   with the `C:"` fix. Cases in `tools/test-win-e.mjs`.
3. **`src/main/folderHandler.ts`**: reg argument builders (add, conditional restore,
   status read-back) and the copy of the launcher to `%LOCALAPPDATA%\Prism\folders`. Tests in
   `folderHandler.test.ts`.
4. **`src/main/folderHandlerSetting.ts`**: queue, the userData marker, startup repair
   (packaged only), recorded-only under `--e2e`. Tests.
5. **`--browse=<UUID> <path>`** in main: argv parse (`argv.ts`), cold start and
   second-instance, open in the Explorer tab, focus, ack (reuse `winERequests.ts`).
6. **IPC + Settings row**: channels, preload, `ExplorerPage.tsx` WindowsSection,
   `appOptions.ts` entry (description at most eight words, `settingsCopy.test.ts`).
7. **Installer**: `assoc.nsh` uninstall half (conditional restore, keep on `isUpdated`,
   remove the copied launcher). Packaged check by hand: install, enable, uninstall, diff.
8. **e2e `folderHandler`** in `tools/e2e/run.mjs` (headless, reaps its processes).
9. **Docs**: `docs/features.md` entry (owner's decision, date, #393, the measurement table
   summary, which test holds it), `THIRD-PARTY-NOTICES.md` unchanged (no new dependency).
10. **Gates**: typecheck, lint 0 errors, unit tests, full e2e (peer told before/after), the
    by-hand list from the spec. Version bump (minor). PR, ask to merge.
11. **PrismTerminal PR**: `core/main/termPathOpen.ts` default-verb open with
    `shell.openPath` fallback, its `e2e:terminal`. Ask to merge there too. Prism gets it
    through the automatic core bump.
12. **Install** 0.115.x the usual way and report.
