# Structure cleanup (DRY and architecture): plan

Owner, 2026-10-12: "make a plan and then go straight ahead and fix all of these things". Source: the
audit `C:\Users\Admin\Documents\Claude\research\prism\2026-10-12-code-structure-audit.md` (Sonnet
mapping, Opus staging; 188 raw findings, 56 kept). Each stage below is that report's stage of the
same number; its Touches / Single home / Holds lines are the spec. One branch,
`refactor/structure`, one commit per stage, behaviour unchanged unless a line here says otherwise.

## Decisions taken for the owner (2026-10-12)

- **Markdown is one list** in `src/shared/fileKind.ts`: `md, markdown, mdown, mkd, mkdn`. Not `.mk`
  (a Makefile; main counted it as markdown, a bug) and not `.mdx` (JSX). The new three are
  registered in `build/installer/assoc.nsh` too (`fileAssoc.test.ts` parity).
- **Not done, left for the owner:** splitting `tools/e2e/run.mjs` into files (CLAUDE.md says e2e
  code goes in `run.mjs`; helpers are tidied INSIDE it), Explorer inline rename, one look for the
  floating pills, moving `videos/` out, deleting the `roundN.py` icon experiments.

## Stages, in order

0. Bugs: e2e `switchStyle` restore, `fixtures.mjs` ffmpeg path, tree paste `.catch`, atomic
   `positions.json`, guarded localStorage on App mount, the zipClient/adm-zip-on-main comment.
1. Dead code: unused exports, stray scripts, keyframes, duplicate `BrowseSort` (each grep-verified).
2. One path module (`src/shared/path.ts`): basename, parent, ext, same-path, inside-root, the
   collator, `isMarkdown`; 2a renderer and phone, 2b main.
3. Main fs helpers: `exists`, atomic write, userData paths, a small LRU.
4. Colour maths in `lib/colour.ts` (and the tests' copies use it).
5. One pref store (`createPref` / `createStore`), every store guarded.
6. Shared viewer and input pieces: find shortcut and find bar, spinner, overlays, popover dismiss,
   modal shell, "is the user typing".
7. Duplicated renderer flows: archive actions (panel uses `useArchiveActions`), rename field,
   paste, unsaved dialog, one viewer switch.
8. Icons in one folder with one `<Icon>` primitive; inline SVGs that repeat move there.
9. Split `src/main/index.ts`: 9a the path wall (with unit tests), 9b worker client / HEIC / media
   protocol / MIME, 9c window chrome / tabs / update / phone / shutdown, 9d handlers by area in
   `src/main/ipc/`.
10. IPC contract: one shared channel table, shared result types, phone route types, a preload
    `subscribe` helper.
11. App, Sidebar and ArchiveView broken into hooks; confirm dialogs get a folder like `menus/`
    with an index doc.
12. Tooling: shared download/build helpers in scripts, e2e helpers deduplicated inside `run.mjs`,
    shared unit-test shims.
13. Folder moves the report lists as clear-cut (lib by feature, hooks in one place), last.

## Gates

Every stage: `npm run typecheck`, `npm run lint` (0 errors), `npx vitest run`, the e2e scenarios
covering what it touched (`PRISM_E2E_PROFILE_NAME=prism-e2e-structure`), then a commit. New homes
get a line in `docs/architecture.md` (and CLAUDE.md only where a mistake would follow without it).
At the end: a review pass, the full e2e, version bump, package and install, one PR.
