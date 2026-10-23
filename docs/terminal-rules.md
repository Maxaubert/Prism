# Terminal rules (the core, living in Prism)

The terminal is `packages/term-core` (npm workspace `prism-term-core`), in this repo since 2026-10-23
(the plan: `Documents\Claude\research\prism-terminal\2026-10-23-retire-pt-move-core-plan.md`). Prism Terminal, the
sibling app that grew it, is retired and archived; its CLAUDE.md and `docs/regression-rules.md` held these rules.
They are copied here (2026-10-23) with their measurements and the owner's words, adapted to Prism. File names are
relative to `packages/term-core/` unless they say `src/`. A spec path such as `docs/superpowers/specs/...`
names a file in the archived PrismTerminal repo. Rules that belonged only to Prism Terminal's app shell (tabs, the
start screen, window chrome from the theme, the stable copy, Explorer verbs, the update handoff, command help,
tab marks, the orchestrator and `/catch-up`, dictate-anywhere and the dictation link) did not come.

## How the core and Prism fit

- <a id="host-seam"></a>**`src/renderer/src/termHost.ts` is the ONLY place Prism differs from the core's defaults.** It
  is imported FIRST by `renderApp.tsx` and declares every difference as a `TermHostConfig` field
  (`renderer/host.ts`): the terminal follows the app style, "acrylic" means the style's material shows through (no
  opacity slider), the panel paints the ground, the indicator is Minimal in the accent, the Right Alt dictation key,
  a right-click is the menu's (`rightClickReports: () => false`), and Prism's chords (`ownsKey`). A difference that
  is not a field there is a fork. The e2e `termOptions` compares Settings > Terminal, Agents and Dictation with the
  core's own `settings/options.ts` and fails on a terminal row written in `src/`. Adding a field is an owner decision.
- <a id="core-lint-wall"></a>**The core is lint-walled** (`eslint.config.js`, the `packages/term-core` block): relative
  imports only (a consumer resolves `@shared` against ITS OWN tree, MEASURED, silently), never `window.prism` (use
  `termApi()`), never `src/`, never `electron`. Prism reaches the core as `prism-term-core/...`, never by a path
  into `packages/`. Carry the superset: a capability only a host uses stays in the core.
- <a id="no-core-bumps"></a>**There is no core version, no tag, no bump PR.** A terminal change is a Prism PR with
  Prism's own version (XTVERSION reports it, `shared/termVersion.ts`). Main is not protected by a bot: the gate is
  `npm run e2e:terminal` (also `terminal-gate.yml`, which triggers on `packages/term-core/**`, the build configs,
  `termHost.ts` and the terminal wiring) plus the core's unit tests in `check`. Keep the gate RUNNER-SAFE: nothing in
  those scenarios may assume one machine (a real `claude` CLI is skipped where absent; no path may sit under the
  Users folder). A flaky check is a bug in the gate: fix the race, never retry around it.
- <a id="ratchet"></a>**THE RATCHET** (owner, 2026-09-19: "if it ever, and it probably will at some point, create a bug
  in only one app, we'll make a test that it needs to pass, so the automation gets more and more secure over
  time"). A terminal bug is never just fixed. FIRST it becomes a scenario in `e2e:terminal` (or a unit test in the
  core) that FAILS on the broken build, THEN the fix. A change that passed the gate and still broke something is a
  hole in the gate, and the hole is the first thing to close. A gate may be landed before the feature (#253:
  `termColourPicker` skips while a file is missing, by the file and never a version).
- <a id="worktree-core-link"></a>**THE WORKTREE CORE-LINK TRAP** (plan section 8, 2026-10-23). Prism packages and tests
  from worktrees whose `node_modules` was robocopied from main. With a workspace, `node_modules/prism-term-core` is a
  link to the checkout that ran `npm install`, so a copied one points at MAIN's `packages/term-core`: the worktree
  would test, bundle and gate the WRONG core, green for the wrong reason. After the robocopy, run `npm install`
  in the worktree so the link points at THIS worktree. `tools/check-core-link.mjs` (`tools/lib/coreLink.mjs`) asserts
  `realpath(node_modules/prism-term-core) === <this checkout>/packages/term-core`; `npm test`, `typecheck`, `build`, `e2e`, `e2e:terminal` and `package` run it first, and it fails with the fix in its message.
- <a id="one-react"></a>**One React**: `resolve.dedupe` and `optimizeDeps.exclude` in `electron.vite.config.ts` stay (a
  linked core once loaded two Reacts); `check-packed` must keep its module count. `@source` in
  `src/renderer/src/index.css` points at `packages/term-core`, or Tailwind generates nothing used only there.
- <a id="main-never-waits"></a>The core's main code obeys Prism's "main never waits on the disk" rule (a `*Sync` call is
  marked `// sync-ok: <reason>`; `src/main/syncCalls.test.ts` fails on an unmarked one).
- <a id="diag-log"></a>**The diagnostics log** (#140; owner, 2026-10-07: "robust logging and debugging ... especially to
  catch stalls"): the core's `diagLog` writes `%APPDATA%\Prism\logs\diag.jsonl`: stalls with the scripts and the
  page stack, slow IPC, errors, crumbs; local only, typed text, the clipboard and audio are never written. When the
  owner says something stalled or failed, READ IT FIRST: `npm run diag -- --since 10m` (`tools/diag.mjs`; `--agent`
  shows the indicator's timeline; a `mark` line is the Mark button). Its wiring is in `packages/term-core/README.md`.
- <a id="product-for-others"></a>**THIS IS A PRODUCT FOR OTHER PEOPLE** (owner, 2026-09-19: "this isn't an app for just me. keep
  that in mind with all things you implement"). A feature bundles or fetches what it needs and works
  on a fresh Windows install: never lean on the owner's GPU, tools, caches or installed runtimes.
- <a id="not-carried"></a>**Not carried: Prism Terminal's renderer sandbox rule.** Prism's main window runs
  `sandbox: false` (its preload needs node), so "the renderer is sandboxed" is NOT a Prism rule; the terminal's
  clipboard still goes through main (`clipboard:term-write`, write-only, 1 MB) and navigation stays http(s)-only.
  The theme-drives-chrome rule (`lib/chromeTheme.ts`) is Prism Terminal's too: in Prism the chrome is the app
  style's, and the terminal reads it through `followsHostStyle` and `themedAgentColors`, every ink held to a contrast
  floor and light/dark MEASURED from the ground, never read off a name.

## Rules that must not regress (copied from Prism Terminal, all measured)

- <a id="only-command-is-resume"></a>**The only command the app writes into a shell is the agent resume**, as the shell's STARTUP
  command, with the id shape-checked in main (`validResume`). Never type into a user's shell. The id rides in the
  environment ([same command line](#same-command-line)). Dictation is the one other thing that reaches a prompt, and
  only as one bracketed paste with no Enter ([dictation](#dictation)). Prism Terminal's orchestrator exception (the
  app typing into ANOTHER tab's running Claude) was dropped with the orchestrator, so there is none here.
- <a id="inert-input"></a>**WHAT REACHES A SHELL IS INERT UNTIL THE USER ACTS** (code review 2026-09-24, #67; the review is
  `docs/reviews/2026-09-24-code-review.md`). A paste is stripped of every ESC and C0 control but
  tab, newline and CR (`sanitizePaste`), so clipboard text cannot end the bracketed paste and run
  what follows. A path is quoted for the SHELL it goes to (`quotePath`): single quotes for
  PowerShell and bash, which expand nothing, curly quotes doubled too; double for cmd and for a
  caller that names no shell. `cdCommand` doubles every quote PowerShell reads as one, and writes
  nothing to cmd for a path with `%` or `"`. Windows' own tools are started by their FULL PATH
  (`packages/term-core/main/sysTools.ts`, pwsh by `where`'s answer minus the current folder), and main leaves its
  launch folder at startup: a bare name is searched for in the current folder first.
- <a id="cells-not-characters"></a>**CELLS ARE NOT CHARACTERS, AND A KEY IS ITS PHYSICAL KEY** (#69, code review part 2). Anything
  that turns a screen cell into a place in the line's TEXT goes through `lib/termCells.ts`
  (`cellText`'s index), never by counting cells or `text.length`: the resize carry and link
  hit-testing were each one off after a trailing space, a wide character or an emoji. Ctrl+C and
  Ctrl+V match `e.code` too (a Russian layout's C is 'с'). Shift+Enter sends a newline ONLY where an
  agent runs, at a plain prompt it is Enter: Ctrl+J to Claude and the `\` continuation otherwise
  (`newlineKey`, measured: Codex 0.153.2 drops a bare LF), armed by Claude's title glyphs or Codex's
  Action Required before the poll, never a bare braille spinner (#175). The shell's prompt report
  takes them back at once and asks the poll for its next answer even if unchanged (`termAgentAgain`:
  Ctrl+V's ESC v reached PSReadLine as RevertLine), the poll's "left" takes back only what the poll
  saw (a resume's first "no agent" is asked again, not obeyed), and an agent only its title vouches
  for goes when the title stops naming it: a WSL tab's poll sees wsl.exe and bash prints no prompt
  report (`lib/agentArm.ts`, review 2026-10-11). An image on Ctrl+V sends the AGENT's key, Alt+V to Claude (on WSL
  too) and ^V otherwise, exactly one, since a
  keybindings.json binding both would paste twice (`imagePasteKey`, #170). The panel's attach is keyed on the
  session alone (a `cd` must not re-attach it and take the focus). Under a question or the update
  window the tab chords do nothing (Ctrl+W keeps its rule). A kill while a spawn is pending wins,
  and a warm shell's exit removes only itself. A stop during transcribing is not heard, so a clip is
  pasted once. The `reviewKeys` e2e holds the renderer half.
- <a id="bundled-conpty"></a>**Bundled ConPTY.** Shells spawn with `useConptyDll: true`; the inbox conhost fast-fails the whole
  app (0xc0000409) when a pty is killed mid-read. `node-pty` stays `asarUnpack`ed and
  `npmRebuild: false` (it ships N-API prebuilds; a rebuild dies in node-gyp).
- <a id="quit-waits-for-shells"></a>**THE QUIT WAITS FOR EVERY SHELL TO BE GONE** (#127, 2026-10-04; owner's screenshot of node-pty's
  "Assertion failed! remove_pty_baton" dialog). Two crashes at quit, both MEASURED: node-pty 1.1.0's
  exit threads race on an unlocked vector (fixed upstream in #922, so `node-pty` is pinned to
  `1.2.0-beta.15`, the owner's pick); and an exit callback that lands while Node tears down throws and
  Electron aborts, 0xc0000409, about one quit in four with ten shells (WER dump: `FreeEnvironment` ->
  `ThreadSafeFunction::CallJS` -> abort). So every kill goes through `killPty` and `will-quit` holds
  the quit on `shellsGone` (3 s cap). It waits for the agent's `exitCode`, set by the native callback,
  not the exit EVENT, which lags 1-2.7 s for a pwsh killed mid-start (a warm shell). `quitManyShells`.
  The pin was LOST once (#159, 2026-10-10): an icon PR's merge put `^1.1.0` back and the dialog
  returned for the owner. `src/main/nodePtyPin.test.ts` now fails on any build without the pin.
- <a id="conpty-resize"></a>**ConPTY sends nothing on a resize**, so `fitKeepingCursorLine` carries the prompt line across by
  hand, and `windowsPty` is declared WITH a build number (without one xterm turns reflow off).
- <a id="caret-follows-typing"></a>**THE CARET FOLLOWS TYPING, NOT A STREAMING AGENT** (#101; owner via the Wind session, 2026-09-29;
  spec `docs/superpowers/specs/2026-09-29-caret-follows-typing-design.md`). Magnifiers, screen readers
  and the IME window follow xterm's helper textarea, which xterm puts on the cursor after every write.
  MEASURED: Claude's INLINE view ends every streaming frame with the cursor on the output row, above
  its input line (its fullscreen view does not; neither view hides the cursor or draws a caret). On the
  normal screen `termCaretHold` holds the textarea on the caret the last key produced (the LOWEST
  position its echo reached) while the cursor is parked above it; at or below, on the alternate
  screen, scrolled back or after a resize, xterm's placement stands. Only the textarea moves. The
  `caretHold` e2e holds it.
- <a id="typing-on-onkey"></a>**Typing is heard on `onKey`**, never `onData`: xterm answers the pty on its own (focus reports,
  device attributes) and those replies must not count as the user typing.
- <a id="indicator-agent-word"></a>**The indicator is the agent's own word.** Claude and Codex write their state into the terminal
  title (`lib/agentTitle.ts`); a titled session is never scored from its output. A spinner before the
  first idle title is the agent STARTING, not working. Output scoring (`termActivity`) is only the
  fallback, and an agent's startup paint is not work (`markBorn` / `startupOutput`). The rules live in
  `lib/useAgentIndicator.ts`; change them there, with Prism's reasoning in hand.
- <a id="claude-hooks"></a>**CLAUDE CODE'S HOOKS ARE ITS WORD, ABOVE THE TITLE** (#131; owner, 2026-10-05: "go ahead and build
  that"; spec `docs/superpowers/specs/2026-10-05-agent-hooks-design.md`, evidence in the research
  folder's `prism-terminal/2026-10-05-agent-hooks-inventory.md`). `packages/term-core/claude-plugin` is a Claude Code
  plugin: each hook in `hooks/hooks.json` runs `hook.cmd`, a static echo (blocking events wait for it;
  MEASURED 20-100 ms, so no node), in EXEC FORM (`cmd.exe` + `args` `/d /c call <root>/hook.cmd`): a
  command string runs through PowerShell where Git Bash is missing and is a ParserError there, and
  without `call` a plugin folder with brackets fails (both MEASURED, review of #131). Its `terminalSequence` Claude writes into its OWN terminal as
  `ESC]777;prism-agent;state=working|question|done|failed[;kind=<StopFailure error>]BEL`. In-band: no
  listener, no tab ids, and `claude -p` / SDK runs never write it (MEASURED). SessionStart/End are left
  out (their bytes reached the pty 1 of 3 and 0 of 3). Main hands a shell the plugin through
  `CLAUDE_CODE_PLUGIN_DIRS` (`ptyEnv`, the user's value kept, an inherited copy of ours dropped:
  `claudePlugin.ts`), only where the host passes `claudePluginDir` +
+  extraResources; dev reads the core's copy)
  extraResources; dev reads the core's copy) AND the page's "Exact status from Claude Code"
  (`agent-hooks`, on) is on; a warm shell is adopted only with the same answer. +
+  nothing changes there until it ships the files.
  nothing changes there until it ships the files. The reader: `lib/agentHookSignal` (parse, our prefix
  only, else `false` so other OSC 777 users are untouched), termBus, `lib/agentHookState` (the pure
  rules), `useAgentIndicator`. A HOOKED session is never scored from output; its screen is read
  only to HOLD a Question its hooks raised, while the box is on screen, never to raise one. Its title
  says an Esc (no hook fires on one, MEASURED: idle title 72 ms after): an idle title
  after `working` with no Stop is idle with NO Finished line, and a Stop that lands after it still
  finishes. The poll still decides presence. **A SPINNER AFTER A QUESTION IS THE WORK THE YES
  APPROVED** (#148; spec `docs/superpowers/specs/2026-10-10-permission-indicator-design.md`): no
  hook fires between the answer and PostToolUse (MEASURED, Claude Code 2.1.296: spinner title 34 ms
  after Yes, PostToolUse 26 s later for a 25 s sleep; the tab showed nothing all that time), so a
  `working-title` in phase `question` or `stopped` is Working; never in `done` or `failed`, and never
  from the answer key (Enter on No is Enter on Yes; after No or Esc the title stays `✳`). The first
  spinner lands 6 ms BEFORE the repaint erasing the box, so one held by the box is read again 250 ms
  later. **WHILE THE BOX IS ON SCREEN, THE QUESTION STANDS** (#148): subagents' hooks write the same
  signal, and a sibling's PreToolUse / PostToolUse or the main turn's Stop took a pending Question
  down 1 to 4 s after it went up (MEASURED, case G2: up 3.9 s of the 14 s the box waited); so with
  phase `question` and `looksLikeQuestion` seeing the box, `working` and `working-title` change
  nothing and `done` raises Finished UNDER the Question (`screenDecides`, `hookStep`'s `seen`). The
  measured timelines are replayed in `agentHookState.timelines.test.ts`. **A STOP WITH THE SPINNER UP
  WAITS FOR THE NEXT TITLE** (#149, 2026-10-14): background subagents run on after the main turn's
  Stop, and the title keeps spinning until the last ends (MEASURED, case G2; after a lone Stop the
  star follows in 18 to 84 ms). So `done` with the title last `working` is phase `ending`, still
  Working: the star is the finish, another spinner frame is `background` (Working, finished by the
  star that ends it), and no title in `STOP_SETTLE_MS` (1.5 s, past the 960 ms frame) settles it as
  a finish. A restore is no finish (#151): a resume shows only idle titles, held by
  `launchSkeleton`. **Failed** is a third line (`agent-failed-on`, on), the
  theme's red apart from the accent by hue (`marksApart`), over Finished and under Question, counted by
  the badge, its kind on the tab's tooltip ("Failed: rate limit"); it raises Finished under it, so
  with the switch off the tab reads as before. Sessions that never send a signal (Codex, an older
  claude, an untrusted folder, plugins blocked by policy) keep the old method whole. Codex's
  `[ ! ] Action Required` title is its Question. The `agentHooks` e2e holds it (it fails on main).
- <a id="process-poll"></a>**The process poll** (`agentPoll.ts`) asks only after a pty printed something and backs off 2.5s to
  20s. It reports CHANGES, so its first verdict on a shell is said once; the e2e waits for it.
  A title that claims an agent the poll has not reported asks for a look NOW (`termAgentLook`,
  `pollAgentsNow`, #73): only the poll takes a title's claim back, and a claude opened and quit
  inside the 20s backoff was never seen, so its mark stayed. The detector matches the program as
  the FIRST token too: a native `claude.exe` started by bare name has the command line `claude`.
- <a id="same-command-line"></a>**EVERY SHELL OF A KIND STARTS WITH THE SAME COMMAND LINE, AND NO POWERSHELL IS
  `-EncodedCommand`** (#180; owner, 2026-10-11: "slow on startup and not responding until Claude sessions load").
  Windows Defender judges each NEW command line a process from `Prism.exe` starts, inside `CreateProcess`,
  which runs on main's thread (node-pty's deferred connect included). MEASURED on the packaged app: 700 ms per new
  command line, 3 ms per repeated one, 1.4 s for an `-EncodedCommand` (10 ms as plain `-Command`); eight restored
  Claude tabs with the session id on their command lines held main for 12 to 14 s. So the resume id rides in
  `PRISM_RESUME_ID` (`withResume`), cleared by the shell before claude starts, and the DWM helper is one quote-free
  `-Command` line. Measure a startup on the PACKAGED app: the dev `electron.exe` pays none of this. Held by
  `terminal.test.ts` (`withResume`) and `dwmHelper.test.ts`; +
+  [`diagnostics.md`](diagnostics.md).
  [`diagnostics.md`](diagnostics.md).
- <a id="redraw-nudge"></a>**A THEME PUSH IS FOLLOWED BY A RESIZE NUDGE, NEVER A KEY** (owner, 2026-10-11, choosing
  "Tiny resize nudge" over sending Ctrl+L or leaving it). Claude Code 2.1.296 switches palette on `?997` but redraws
  only its live frame (measured, the #172 section of the compat spec). After a push the program asked for, the panel
  resizes that terminal one column narrower for `NUDGE_HOLD_MS` and refits it back (`termReplies.ts`), waiting until
  a hidden tab is shown. Nothing is typed. Held by the `termReplies` e2e (the stand-in sees cols-1 then cols, once).
- <a id="replies-only-when-asked"></a>**THE APP ANSWERS A PROGRAM ONLY WHAT IT ASKED** (#168, #171, #172, #176; spec
  `docs/superpowers/specs/2026-10-10-claude-code-compat-design.md` section 15). Every byte the core writes into a pty that
  no key produced is a reply to a query in that pty's own stream (OSC 10/11 `?`, `CSI ? 996 n`, `CSI > q`, DECRQM 2031)
  or the `?997` report the program turned on with `?2031h`, only on a change and only while that program is there:
  the shell's prompt report, an agent leaving (`agentArm`'s `gone`: the poll's "left" for an agent it saw, or a
  title-armed agent's title going) and RIS turn the reports off; the poll's first "no agent" never does (review
  2026-10-11: a push after a killed Claude reached PSReadLine as ESC, RevertLine, then typed `[?997;1n`). Replies hold no CR, LF or printable
  command, go through `term.input(reply, false)` so `onData` and `looksTyped` treat them as the replies they are
  ([typing on onKey](#typing-on-onkey)), and never read anything private: OSC 52 is write-only and a read gets no
  answer. The pure half is `packages/term-core/renderer/lib/termReplies.ts` (tested); the light/dark it reports is the chrome's own
  measurement (Prism Terminal's `chromeTheme.test.ts` pinned that the two agree on every preset; Prism's chrome is its style). MEASURED (Claude Code 2.1.296, 2026-10-10):
  xterm had answered OSC 11 from the clear canvas as `rgb:0000/0000/0000`, so Claude was dark on every ground; Claude
  writes `?2031h` without a DECRQM probe, never asks `?996n` or OSC 10, and on a pushed `?997;2n` re-asks OSC 11 and
  turns light. XTVERSION (#171) answers `CSI > q` and `CSI > 0 q` only, +
+  <version>)`
  <version>)` (the constants in `packages/term-core/shared/termVersion.ts`, held to the package files by `termVersion.test.ts`); the
  name must NOT start with `xterm.js`, which Claude reads as VS Code's terminal. MEASURED (Claude Code 2.1.296 --model
  haiku, bundled ConPTY, one streamed answer, 2026-10-11): no reply, `synchronizedOutput=no` and 0 `?2026h`; with the
  reply, `synchronizedOutput=yes` and 65 frames wrapped in `?2026h`/`?2026l`. OSC 52 (#176) is WRITE-ONLY: only the
  `c` (or empty) selection, base64 of strict UTF-8, at most 1 MB (`OSC52_MAX`), through main
  (`clipboard:term-write`, its own channel and cap, opaque to the diagnostics log), with the Copied badge; a read
  (`?`) is swallowed and never answered, a clear is ignored, every OSC 52 is handled so none is drawn.
- <a id="panel-paints-ground"></a>**The terminal panel paints the ground; xterm's canvas is CLEAR** (2026-09-19, #6, owner
  screenshot: a grey bar under a black terminal). xterm sizes itself in whole rows (MEASURED: 604px
  in a 611px box), so the strip under the last row is never its to paint; with the ground on the
  canvas and a transparent box round it, that strip showed the native window background. So
  `TerminalPanel`'s box is `bg-[var(--p-bg)]` and `currentTermTheme()` hands xterm
  `background: #00000000` plus a named `cursorAccent` (it defaults to the background, which would
  make the character under a block cursor a hole). Exactly ONE coat per pixel, which also matters
  on acrylic: two translucent coats are a visibly darker panel, so App's own container behind the
  panel stays unpainted. The e2e `theme` scenario measures the strip, and fails on the old code.
- <a id="links-painted"></a>**Links are PAINTED, not only underlined on hover** (owner, 2026-09-19, #10). xterm's link addon
  marks a link only under the pointer, so `lib/termLinkPaint.ts` lays a DECORATION on each row a
  link sits on: the link colour as its foreground, a faint underline as its element, never in the
  way of a click. `lib/termLinks.ts` is the pure half: `findLinks` (a sentence's full stop and a
  bracket the link never opened are given back) and `linkColor`, which is `LINK_BLUE` moved only as
  far as the ground needs to reach 4.5:1, so it adapts to every preset and to a custom background,
  and is tested for all of them. WHAT IS SCANNED is the design: scrollback is immutable, so its
  links are painted once and ride a marker; the LIVE screen is redrawn in place by TUIs, so every
  pass throws away what it painted from the last finished line down and paints that again (a
  decoration left on a rewritten row is a blue smear over words that were never a link). Rebuilt
  on a resize (reflow) and on a theme change. **THE ALTERNATE SCREEN TOO** (#97; owner, 2026-09-28:
  a link in Claude Code's fullscreen view "is not blue ... it seems to know it's a link"): markers,
  so decorations, do not exist there, so each row xterm DRAWS there (`onRender`) has its link text
  wrapped in a span of the link colour; xterm replaces a row's contents when it draws it, so a
  rewritten row starts clean. Per row, since a TUI places its own text. Columns are counted in
  CELLS, since a wide character is one character and two cells. xterm splits a row into spans as
  it likes, so the e2e finds a link's span by POSITION, never by its text. **NO PASS HOLDS THE
  PAGE** (#167; MEASURED 2 s stalls before, 2009 ms and 2046 ms in `scan`, Stable's diag log
  2026-10-10): a full pass paints the live screen, then the scrollback bottom up in slices of 8 ms
  or less (`lib/linkScanPlan.ts`, a marker as the cursor), and a found path repaints only the tab
  and the lines that asked (`revisit`). The `linkPaintStall` e2e holds it. **OSC 8 LINKS** (#169)
  open on a LEFT click, http(s) only, never through a confirm (the `linkHandler` option; xterm's
  default asked `confirm()` and opened a blank window main denied, on any button). Their cells are
  painted from the stream (`lib/termOsc8.ts`: the cursor at the open and at the close, MEASURED to
  bracket Claude Code's label through the bundled ConPTY) while their text stands, on both screens,
  and the menu's Copy link / Open link take where a click goes. A LABEL THAT SHOWS ANOTHER HOST'S
  ADDRESS OPENS WHAT IT SHOWS (`osc8Target`, review 2026-10-11): xterm's OSC 8 provider outranks the
  visible-text match, so `https://github.com/...` printed over a hidden `https://evil.example/`
  opened evil.example. An OSC 8 label is a link to the click-caret gate too. A reflow or a buffer
  switch forgets them. **THE APP NEVER SETS `FORCE_HYPERLINK`** (#173 did; review 2026-10-11 took
  it out): supports-hyperlinks reads it BEFORE its isTTY test (read in claude.exe 2.1.296), so it
  put raw OSC 8 into every pipe and redirect, Claude's own Bash tool commands among them. Claude
  prints `label (long url)` without it; its `hyperlinks` setting, or a user's own variable, turns
  OSC 8 on. The `osc8Links` e2e holds both.
- <a id="path-links"></a>**A PATH ON SCREEN IS A LINK WHEN IT EXISTS** (#99; owner, 2026-09-29: "clickable links that would
  open the file or folder", then "go ahead"). `lib/termPaths` finds what COULD be a path (relative or
  absolute, sentence punctuation and `:12` taken off); main's `termPathOpen` answers which exist from
  the shell's folder (`cwd` tracks the prompt's OSC 9;9), and ONLY those are painted and clickable
  (`lib/termPathLinks`: batched, cached per folder, a "no" forgotten after 15 s). A left click opens
  a file in its own app and a folder in Explorer; ANYTHING RUNNABLE (exe, scripts, shortcuts,
  installers: `isRunnable`) is only SHOWN in Explorer, never run. Main never trusts the page with
  a path: it gets the TEXT back and resolves and checks it again. No UNC paths (a share can stall a
  stat). A prompt (`PS C:\x>`, `C:\x>`) is not a link. Menu: Open, Show in Explorer, Copy path.
  Under `--e2e` main records (`__e2eOpenedPaths`) and opens nothing. A host without `paths` in its
  main deps (Prism, until wired) paints no paths at all; `TermHostConfig.openPath` is where Prism
  opens them inside Prism. A found path repaints only the tab that asked and only the lines that
  asked (#167: `linkRanges(text, cwd, owner)`, `onPathsFound(owner, fn)`, `takeAsked`); waking
  every tab's full repaint froze the window 2 s (MEASURED). The `pathLinks` e2e holds it.
- <a id="file-drop-and-menu"></a>**A file dropped on the terminal types its quoted path, and the terminal answers a right-click**
  (2026-09-19, #16). The drop goes through `quotePaths` and `termInput`, never Enter, and only over a shell;
  the menu is Paste (the terminal's own paste rule, via `pasteInto`) and Find in scrollback, led by Copy link
  over a link and Copy with text marked, and with no Close tab. NOTHING IN A FEATURE LIST IS TRUE UNTIL A TEST HAS
  DONE IT: a drop once vanished with the dock that carried it while the README went on listing it. The e2e
  performs a REAL drop with Chromium's drag events (`Input.dispatchDragEvent` carrying a file path): a
  synthetic DataTransfer holds a File with no path and proves nothing about `getPathForFile`. When a component
  is stripped, grep what ELSE it owned before calling a feature kept.
- <a id="product-for-others"></a>**THIS IS A PRODUCT FOR OTHER PEOPLE** (owner, 2026-09-19: "this isn't an app for just me. keep
  that in mind with all things you implement"). A feature bundles or fetches what it needs and works
  on a fresh Windows install: never lean on the owner's GPU, tools, caches or installed runtimes.
- <a id="dictation"></a>**DICTATION** (#13, 2026-09-19; spec in `docs/superpowers/specs/2026-09-19-dictation-design.md`).
  Built ONCE in `packages/term-core/`, for Prism too. Hold Right Alt, speak, release: the FINAL text is pasted at the
  cursor of the shell that was in front when you started. The rules that must not regress:
  - **It is the FOURTH written exception to "the app never types into your shell"** (with the agent
    resume, Prism's `Set-Location`, and drop-to-type-path): the user spoke it on purpose, it arrives as
    one bracketed paste, and it NEVER carries Enter or a newline (`cleanTranscript` and the panel's
    `pasteSpokenText` both strip them; the e2e asserts no new prompt appears).
  - **Off means off.** Default off. With it off no key listener is armed, no process exists, nothing
    downloads. Switching it off kills the server. The e2e counts `whisper-server.exe` processes.
  - **Local only.** Audio goes renderer -> main -> `whisper-server` on 127.0.0.1 and is never written to
    disk. Official whisper.cpp binaries only, nothing we compile; every download (engine, models, the
    NVIDIA pack) is pinned by SHA-256 in `packages/term-core/shared/dictationCatalog.ts` and an unverified file is
    deleted, never loaded. Model urls are pinned to a Hugging Face COMMIT, not `main`.
  - **Right Alt is AltGr** on Norwegian and most European keyboards (Windows sends Ctrl+RightAlt, then
    the key). So a bare-modifier hotkey is a SOLO HOLD of 200 ms; any other key during that window
    means it was typing. `packages/term-core/renderer/lib/dictationKey.ts` is the pure reducer, heavily tested.
  - **Live text is provisional and only SHOWN** (in the pill); only the final pass is pasted. MEASURED:
    a phrase heard wrong at 6 s was corrected by 8 s, and text typed into a prompt cannot be unsent.
  - **The engine ships its own C++ runtime.** whisper.cpp's exe and DLLs import MSVCP140 /
    VCRUNTIME140(_1) / VCOMP140, which neither official zip carries and a fresh Windows may lack.
    `packages/term-core/tools/fetch-whisper.mjs` copies them app-local from the build machine, only if validly
    signed by Microsoft, plus the MIT notice. The GPU pack finds them through PATH (the engine sets it).
  - **Shared files, per-app values.** Models and the GPU pack live in `%LOCALAPPDATA%\PrismDictation`
    (shared with other apps on the PC, Flare among them; never removed by an uninstall); every setting VALUE is Prism's own.
  - **THE ENGINE IS WARM BEFORE YOU SPEAK** (owner, 2026-09-28: "it should work from the get-go").
    MEASURED on an RTX 5090, Large v3 Turbo: the server answers in 1.1 s, but the FIRST pass took
    31.8 s with no cached kernels (the pack has none for the card) and 0.26 s with them. So the GPU
    engine has its own kernel cache (`%LOCALAPPDATA%\PrismDictation\cuda-cache`, 4 GB,
    `CUDA_CACHE_PATH`), the renderer asks for a warm-up (`dictationWarm`, a silent pass) when
    dictation is armed, when its model or language changes and at every press, a partial on a
    cold engine answers `warming` at once instead of queueing, and the pill says "Starting speech
    engine" rather than "Transcribing". After a failed warm-up partials go the ordinary way.
  - **GPU:** the official CUDA 12.4 pack (643 MB) is an optional download, offered only when an NVIDIA
    adapter is found. MEASURED on an RTX 5090: it runs (first run 9 s compiling kernels), Large-v3 then
    answers in 0.36-0.5 s. AMD/Intel stay on CPU (Base/Small) until there is an official build.
  - **Testing is REAL:** the `dictation` e2e feeds Chromium's fake microphone a WAV
    (`PRISM_E2E_MIC`), runs the real bundled engine with the Tiny model (cached under `.e2e/cache`), and
    asserts the sentence lands on the prompt line. Not machine-testable, so on the hands-on list: how
    it sounds, AltGr on a physical keyboard, pause-media against a real player.
  - Re-pinning the engine: `fetch-whisper.mjs` and `ENGINE` in the catalog must agree (a test holds
    them together), and the GPU pack must be the SAME release tag.
  - **Which models, and why** (2026-10-04): `docs/research/2026-10-04-dictation-models.md`. Phonon 2
    is out (English only, not whisper.cpp); nothing is scrapped; quantized Whisper files are the next
    step to measure; Parakeet v3 runs one process per pass and lacks Norwegian. (The resident Parakeet HOST of Prism Terminal was dropped from Prism, 2026-10-23.)
- <a id="page-looks-right"></a>**A PAGE THAT WORKS IS NOT A PAGE THAT LOOKS RIGHT** (#20, 2026-09-19). Moving the settings into
  `packages/term-core/` dropped every Tailwind class used only there (`packages/term-core/` is outside the scanned root; the fix
  is the `@source` line at the top of `index.css`, do not remove it). Every e2e scenario passed over
  a ruined page, because they asserted that rows EXIST. The `settingsLook` scenario now MEASURES the
  layout (card width, wall rows, row padding) and writes `settings-<page>-<scheme>.png` into the e2e shots folder (`SHOTS` in `tools/e2e/run.mjs`). After any change
  that moves UI between `src/` and `packages/term-core/`, LOOK at those screenshots before calling it done.

## Dictation in Prism (additions to the rules above)

- Prism arms dictation only over a SHOWING terminal (`useDictationArm` in `App.tsx` hands the controller the shown
  shell or null), so Right Alt over a film, a PDF or the tree does nothing (the e2e holds the key with no terminal up
  and asserts no pill and no process). It dictates inside its own terminal only; the dictate-anywhere key, its widget
  and the cross-app link are not Prism's (Flare owns dictate-anywhere).
- **RIGHT ALT is Prism's default key**, set by `termHost.ts` (`defaultHotkey`). The core's own default is Ctrl+Win
  (owner, 2026-10-16: "one dictation key ... control plus the windows key"; right Alt is AltGr on a Norwegian
  keyboard). Core 0.43.0 moved that default and a user who never saved a key would have moved with it (the red
  `dictation` gate on the 0.44.4 bump). A saved key is always kept. On AltGr layouts Windows sends an injected LCtrl
  before Right Alt. NOT YET HANDLED (a follow-up from Flare, retire plan section 9, needs the owner's go): Esc during
  push-to-talk should not treat that Ctrl as foreign, while picker digits must (AltGr+2 is '@').
- Settings > Dictation is the core's `DictationPage` whole. The engine ships in the installer: `npm run fetch:whisper`
  runs `packages/term-core/tools/fetch-whisper.mjs` into `vendor/whisper`, packaged as `resources/bin/whisper` (its
  own folder: its ggml DLLs must not sit among ffmpeg's), never committed. The microphone is the one extra
  permission: main grants `media` for audio only to Prism's own windows, the camera is refused.