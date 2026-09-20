# Where should a file from outside open? (#167, part two)

Date: 2026-09-19 (written up 2026-09-20). Status: option A is built, in its own PR, for the
owner to judge alone. Options B and C are NOT built.

## The question

Issue #167 relabelled Explorer's right-click entries ("Open file", "Open as project"). Asked
what the entry on a single file should then DO, the owner said:

> open file, but im not sure if it should be opened in file explorer, thats probably best
> rather than a project

Two things are in that sentence. It is about ONE entry, the right-click "Open file". And it is
unsure. So this document first writes down what happens today, then what "in the Explorer"
would mean in practice, and then gives three sizes of change to choose from.

## For the owner: the short version

Today, every file that reaches Prism from outside (a double-click, "Open with", the right-click
entry, a command line) makes the file's FOLDER into a project tab, unless a project tab on
exactly that folder is already open. Look at one photo in Downloads and you now have a
"Downloads" project in the strip, which comes back next launch, which warms a terminal in
Downloads a second later, and which the phone can browse.

- **Option A (built in this PR): only the right-click "Open file" goes to the Explorer tab.**
  Double-click, "Open with" and the command line stay exactly as they are. Smallest change, and
  the one that matches the sentence above word for word.
- **Option B (not built): every file from outside goes to the Explorer tab.** Double-clicking a
  photo would show it in the Explorer tab and never make a project. This reverses two written
  decisions and changes how about eighty automated tests start. It needs its own yes.
- **Option C (not built): leave everything as it is.** Close this PR.

Recommendation: **A now, and live with it for a while before deciding B.** A is cheap to undo
(one switch on one registry command), it lets you feel what "a file in the Explorer tab" is like
on real files, and B is the same machinery pointed at more doors, so nothing built for A is
wasted if you later want B.

## How a file arrives today

1. **Windows starts Prism with the path on the command line.** That is true of all four doors:
   a double-click and "Open with" go through the per-extension classes the installer registers,
   the right-click entry goes through the `OpenWithPrism` verb (`src/main/shellVerb.ts`), and a
   terminal types it. Before this change all four command lines were identical: `"Prism.exe"
   "<path>"`. Prism could not tell them apart.
2. **Main reads the command line** (`src/main/argv.ts`, `pathsFromArgv`): every existing path,
   in order, each marked as a file or a folder, skipping switches and Prism's own files.
   - Prism not running: the paths wait in `pendingOpen` until the window has restored last
     session's tabs (the pinned Explorer first), then go out one at a time.
   - Prism already running (it is resident, so this is the usual case): Windows starts a second
     copy, which hands its command line to the first through `second-instance` and exits. The
     window is raised and the paths go out one at a time.
3. **Main builds a payload per path** (`sendOpen` -> `buildPayload` in `src/main/index.ts`): the
   folder's viewable files, which one was asked for, and `root` = the file's folder. Building it
   REGISTERS that folder as a root (`addRoot`), which is what makes it a project's folder and
   what the phone is allowed to see. It is sent on the `open:file` channel.
4. **The window routes it** (`arrive` -> `open` in `App.tsx`, then `receiveFile` in
   `lib/tabs.ts`): a PROJECT tab whose root is EXACTLY that folder takes the file; otherwise a
   new project tab is made, rooted there. Explorer tabs are skipped on purpose. A film or a
   track is marked to play (#139). A full-view terminal in the receiving tab steps aside.
5. **What you see:** a project tab named after the folder, the file in the viewer, the folder
   tree in the sidebar with the file marked, Up and Down paging through the folder's files.
   A second later, because a project tab with no shell is in front, a spare terminal is warmed
   in that folder.

## What "in the Explorer tab" means, concretely

- **Which tab:** the PINNED Explorer, the one that is always first and cannot be closed. It
  comes to the front. No tab is made, none is reused, none is closed.
- **What the viewer shows:** the file in the Explorer's "full view", the same state a
  double-click on a row inside the Explorer produces: the file fills the window under the path
  bar, and the path bar ends in the file's name.
- **Where the Explorer is:** it has WALKED to the file's folder. Back (or Backspace, or the
  folder's name in the path bar) shows that folder's list with the file selected, and Back
  again returns to wherever the Explorer was before. Its remembered location is now that
  folder.
- **What Up and Down page through:** the viewable files of the file's folder, the same list a
  project tab would page (the title bar's "4 / 4" counts it). Over a film or a track they are
  the volume, which is the existing rule wherever no tree takes them first.
- **What the sidebar shows:** the Explorer's own, Quick access and the drives (hidden while a
  file is in full view), not a folder tree. There is no tree row to mark.
- **A second file:** replaces the first. The Explorer shows one file at a time, which is its
  rule for every file opened in it. Five photos sent at once leave the last one on screen with
  the other four one arrow key away.
- **What does NOT happen:** no project tab, so nothing new comes back next launch; no root is
  registered, so the phone sees nothing new; no terminal is warmed in the folder.
- **A film or a track plays,** exactly as it does on the project route (#139).
- **A folder is unaffected:** "Open as project" is that entry's whole meaning.

## What each option reverses and breaks

### Option A: only the right-click "Open file"

How: the file verb's registry command gains one switch, `"Prism.exe" --explorer-tab "%1"`.
Nothing else in Windows carries it, so it is the only thing that takes the new route.

Reverses: nothing that is written down. The arriving-file rule (2026-08-20), EXACT ROOT ONLY
(2026-09-04) and "a file arriving means show me this file" (2026-09-04) all still govern every
other door. One sentence in `shellVerb.ts` ("the file verb opens the file with its own folder as
the root") stops being true and is corrected.

Breaks: nothing in the test suite. `tools/e2e/run.mjs` `launchOnce` starts Prism with a bare
path and waits for a selected tree row named after the file; about eighty scenario launches
begin that way, and a bare path is exactly the route that does not change.

Costs, said plainly:
- The entry's command text changes, so a registration written by an older build no longer
  matches what this build writes. An ordinary upgrade rewrites it anyway (the old uninstaller
  deletes the keys, the startup repair puts them back). For the rare registration that SURVIVES
  an upgrade, a new narrow repair (`recommandVerb`, the twin of #167's `relabelVerb`) rewrites
  the one stale command: only when the verb is on, all three keys, pointing at this exe, and
  only a command it could read and recognise as Prism's own.
- "Open file" and a double-click on the same file now do different things. That is the point,
  but it is a difference somebody has to learn.
- It is always the Explorer tab, even when a project tab on that very folder is open. See the
  open questions.

### Option B: every file from outside

Reverses: the arriving-file rule itself (2026-08-20: "a file arriving from outside reuses a tab
whose root IS its folder, otherwise spawns one rooted at that folder"); EXACT ROOT ONLY
(2026-09-04), which would have nothing left to decide; the half of "a file arriving means show me
this file" (2026-09-04) that is about a project's full-view terminal stepping aside. (Prism's
OWN "Open as project" on a file row, in `docs/folder-browsing.md`, is a different door and
would stay.)

Breaks:
- `launchOnce` waits up to fifteen seconds for a selected tree row that would never appear, then
  carries on regardless, so each of about eighty launches would lose fifteen seconds and then
  fail wherever the scenario touches the tree, the sidebar search, tree drag and drop, rename
  and delete from the tree, the terminal (an Explorer tab has none) or a split view. That is
  most of the suite. They would need a deliberate way to start as a project (launching on the
  FOLDER, or a test-only switch), scenario by scenario.
- Habits: someone who double-clicks a source file to get the tree and a terminal beside it
  would have to use "Open as project" on the folder instead.
- The "Follow the file", unsaved-text and media-deck behaviours all work in the Explorer tab
  today, but they have been exercised far more in project tabs.

### Option C: nothing

Reverses and breaks nothing. The right-click entry keeps making a project, under a label that
says only "Open file".

## Open questions for the owner

1. **A project on that folder is already open.** With option A, "Open file" still goes to the
   Explorer tab, because the words were "rather than a project" and one predictable answer is
   easier to learn than two. The alternative is "use the open project if there is one, otherwise
   the Explorer". Which do you want?
2. **The pinned Explorer moves.** It walks to the file's folder and remembers that. Back returns.
   The alternative is a fresh ordinary Explorer tab per "Open file", which leaves the pinned one
   where it was but grows the strip, which is the thing being avoided.
3. **Is B wanted at all?** If yes, it should be its own issue, with the e2e rework as part of
   the plan.

## What was built (option A)

- `src/main/argv.ts`: `EXPLORER_TAB_SWITCH` (`--explorer-tab`) and `arrivalsFromArgv`, which
  marks the FILES of a command line that carries it. `pathsFromArgv` is untouched.
- `src/main/index.ts`: `sendOpen` sends a marked file as `{ explorerFile }` and builds nothing,
  so no root is registered.
- `src/shared/types.ts`: `OpenPayload.explorerFile`.
- `src/renderer/src/lib/tabs.ts`: `frontPinnedExplorer`, pure. `App.tsx`: `arrive` parks the
  arrival; an effect brings the Explorer to the front and then makes the Explorer's own
  full-view open, the call a Quick access file pin makes. No pinned Explorer (not a state main
  leaves the strip in) falls back to the ordinary route.
- `src/main/shellVerb.ts`: the switch in the file verb's command, `commandFor`, a reader that
  understands both the old and the new command, `verbInstalled` exact and `verbRegistered`
  lenient, and `recommandVerb`. `shellVerbSetting.ts` runs it beside the relabel.
- Tests: `argv.test.ts`, `tabs.test.ts`, `shellVerb.test.ts`, `shellVerbSetting.test.ts`, and the
  `openFileExplorer` e2e, which proves both halves: the switch lands in the Explorer tab (as a
  handoff and as a cold start), and a plain launch and a plain handoff still make a project.

Not verified, and it cannot be from a test: the real right-click entry in Explorer. Nothing
here may write the owner's registry, so the e2e starts Prism with the exact command line the
entry carries, and the unit tests pin that command's text.
