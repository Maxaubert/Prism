# prism-term-core

The terminal of Prism, and the few other things the update chip and window need. It lives in this repo as
`packages/term-core`, an npm workspace named `prism-term-core`; every import is `prism-term-core/...`.

Read [`docs/terminal-rules.md`](../../docs/terminal-rules.md) before changing anything here: it holds the
rules that must not regress, with their measurements and the owner's words.

## Where it came from

It began (2026-09-18) as the `core/` folder of Prism Terminal, a sibling app extracted from Prism's built-in
terminal, shared by both through a pinned `core-v*` tag. On 2026-10-23 Prism Terminal was retired and the core moved
into Prism (the plan: `Documents\Claude\research\prism-terminal\2026-10-23-retire-pt-move-core-plan.md`). There
is no `core-dist` branch, no tag and no core version any more. Text below that says "the two apps" or "both apps"
is from the era of two hosts; what still holds is that every difference of the ONE host (Prism) is a declared
`TermHostConfig` field, so the core can be hosted again without forking it.
## The contract

1. **What is the terminal lives here, once.** The pty and shells, the prompt
   bootstrap, agent detection / poll / resume, the panel, find, link painting,
   the agent indicator's rules and colours, the close question, the paste rule,
   the theme and look stores, **and the terminal's SETTINGS UI** (`renderer/settings`):
   the owner's rule (2026-09-19) is that terminal settings keep "the setting names, types, how they function" in one place,
   while the VALUES are the host's own (its storage).
2. **What is an app's shell stays in the app.** Prism: roots and the wall, the
   sidebar, the split dock, several shells per tab, app styles.
   Dictation (#13) is in here too, whole: the key, the microphone, the engine,
   the model store, the pill, the tab mark and its Settings page. A host wires
   it with four lines: `registerDictationIpc` in main, `createDictationApi` in
   the preload, the `dictation` field of its host config, and
   `useDictationArm` + `<DictationPill>` where its terminal is drawn. It also
   runs `core/tools/fetch-whisper.mjs <dir>` at build time and ships that folder
   as `resources/bin/whisper`, and grants its own window the `media` permission
   (audio only).
   Dictation here is Prism's own, inside its terminal: the cross-app link,
   its client and the Parakeet resident host were dropped (2026-10-23, the retire
   plan); `idleMs` keeps the engine up.
   **Claude Code's hooks** (#131) are in here too: the plugin itself
   (`claude-plugin/`), the env injection (`main/terminal.ts` `ptyEnv`,
   `main/claudePlugin.ts`), the reader (`renderer/lib/agentHookSignal.ts`,
   `agentHookState.ts`, the OSC 777 handler in the panel) and the Failed line's
   state and switches. The indicator reads signals in any host. A host ships the
   plugin by copying `core/claude-plugin` beside its app (real files, not in an
   asar) and passing that folder as `claudePluginDir` to `registerTermIpc`, plus
   the page's setting to `termPrewarm`; one that passes no folder changes no
   shell's environment. Its strip draws `failedIds` as a third line, and its
   `themedAgentColors` may name `failed` (else `FAILED_RED`).
   **A program's OSC 52 copy** (#176) needs nothing from a host: `createTermApi` and
   `registerTermIpc` carry `clipboard:term-write` (write-only, 1 MB). The orchestrator,
   `/catch-up`, the bell hook and command help were dropped (2026-10-23).
   **AND THE UPDATE CHIP AND ITS WINDOW, TERMINAL OR NOT** (#28, owner,
   2026-09-19). This WIDENS the core, on purpose, from "the terminal" to "what
   the two apps shared". Asked to build the update window (*"when you click the
   Update badge, it opens like a pop window, which shows the change log or like
   patch notes for the new update, and then you can choose cancel or install"*)
   and to show it in both apps, the question was whether to write it twice; the
   owner's answer: *"yes keep the core"*. So these live here although none is
   terminal: `shared/updateTypes.ts` (the offer), `shared/releaseNotes.ts` (a
   release body as SAFE plain entries), `main/updatePreview.ts` (the
   `--preview-update` fake), `renderer/lib/updateFlow.ts` + `useUpdateFlow.ts`
   (the rules and the hook) and `renderer/components/UpdateChip.tsx` +
   `UpdateDialog.tsx`. The bar for anything further is the same: both apps would
   otherwise write it, and it must look and behave the same in both. An app's
   own shell still does not come in (rule 2). A host wires the update with: the
   release body as `notes` in its own update check, `wantsPreview` /
   `previewUpdate` / `runPreviewInstall` in main, `useUpdateFlow(bridge, guard)`
   where its title bar is drawn, `<UpdateChip>` in the bar and ONE
   `<UpdateDialog>` at the root. The `guard` is the host's own question before
   an install, which ends in the app quitting: Prism Terminal asks about a
   working agent, Prism about unsaved text as well. And a host that raises a
   question of its OWN while the window is up (its chords still work over it:
   Ctrl+W, Alt+F4) must put the window away first (`cancel()`): the two are
   the same layer, and a question mounted under this one takes the focus where
   nobody can see it, so Enter at "Install" answers the hidden question.
   Two rules travel with it. **The notes are plain text**: they are text off the
   network in a window that can reach the bridge, so they are parsed to strings
   and printed as text nodes; never HTML, never rendered markdown, never an
   anchor. **The chip never changes width**, in any phase: every label is laid
   out in one cell and only the current one is visible.
3. **A difference is DECLARED, never forked.** Every place a host
   legitimately differs is a field of `TermHostConfig` in
   [`renderer/host.ts`](renderer/host.ts): the default each untouched setting
   reads as, whether there is a host style to follow, who paints the ground,
   what an unpicked indicator colour resolves to, what "acrylic" means as a
   terminal setting, which chords the app owns, whether a right-click reaches a program that reads the
   mouse (`rightClickReports`, Flare #49; absent, xterm forwards it as before), the dictation key a user who
   never picked one gets (`dictation.defaultHotkey`; absent, Ctrl+Win; Prism
   declares Right Alt in `src/renderer/src/termHost.ts`, the only host difference). If a difference is not on that page, it is a fork,
   and a fork is what this exists to end. Adding a field is an owner decision.
4. **Defaults are per host on purpose.** An update must never silently change
   what an existing user sees. Where the owner picks one value for both apps,
   both hosts pass it and the difference disappears.
5. **The bridge to main is written once.** [`shared/channels.ts`](shared/channels.ts)
   names every IPC channel; [`preload/api.ts`](preload/api.ts) is the preload
   half and [`main/ipc.ts`](main/ipc.ts) the main half. A host passes in its own
   `ipcRenderer` / `ipcMain` / clipboard; the core imports nothing from
   `electron`.

**THE COLOUR PICKER (#112)** is the third, under the same bar (owner,
2026-10-03: "the colour pickers should be the same for both apps, i need an
input field for a color code and an alpha per colour on every colour setting").
`renderer/settings/ColourPicker.tsx` (`ColourField`, `ColourPopover`, props
only), `renderer/lib/colour.ts` (parse, the one stored form `#rrggbb` or
`#rrggbbaa`, `composite`, `legibleOn`, `inkOn`, `selectionFor`,
`colourCommit`) and `renderer/lib/colourFormat.ts` (HEX, RGBA or HSLA, per
viewer, display only). A host passes `onRevert` on every row that can follow
the theme, so Escape gives it back unset. The popover is a portal, so the core
needs `react-dom` as a peer. Its DOM contract (both apps' e2e read it): the
code field is the row's only `<input>` with no `type`, `aria-label` = the
label; the swatch is `button[data-colour-swatch]` "Pick <label>"; the popover
is `[data-colour-popover][role="dialog"]`; the sliders are named "Saturation
and brightness", "Hue" and "Alpha"; `button[data-colour-format]` and
`button[data-colour-eyedropper]`. A host's own window-level key listener must
leave events from inside `[data-colour-popover]` alone. Since 0.22.0 (#114)
there is no Opacity row and no `termOpacity`/`setTermOpacity`: the window material belongs to the host's style (`acrylic.kind` is 'style', the only kind since the 2026-10-23 prune), so the row is a switch, `setTermAcrylic`; `TERMINAL_OPTIONS` is the same list in every host.
Since 0.31.0 (#157) the wall orders the presets after its leading cards with
`orderTermThemes` (`lib/themeOrder.ts`): neutral grounds first, then coloured,
each black to white by OKLab L; neutral is chroma below `NEUTRAL_CHROMA`.
Spec:
`docs/superpowers/specs/2026-10-03-colour-picker-alpha-design.md`.

**THE SETTINGS LAYOUT (2026-10-05, the grouped cards redesign; owner: "can you
mock up some new settings pages ... grouped cards ... both apps")** is the
fourth, under the same bar. Spec and plan:
`docs/superpowers/specs/2026-10-05-settings-redesign-design.md`.
- `renderer/settings/layout/`: `SettingsFrame` (the rail, Find a setting, the
  results page, the pane and its header; props `pages`, `page`, `onPage`,
  `index`, `title`, `headerAction`, `compact`), `SettingsSection` (heading +
  ONE panel), `SettingRow` (icon tile, label, one line of subtext, control;
  `warn`, `off`, `tap`), `SettingBlock` (a full-width part of a panel),
  `icons.ts`, `search.ts` (pure), `flash.ts`. Props only.
- `renderer/settings/sections/`: `ShellSection`, `TerminalTextSection`,
  `TerminalThemeSection({ afterTheme, onThemePicked })`,
  `AgentMarksSection({ after })`, `ClaudeCodeSection`, `MarkColoursSection`
  (carries the SAME Save changes as the theme row: both save the whole setup
  and light together, `theme/useTermSetup.ts`), `DictationPage`.
  WHICH PAGE holds a section is the host's; `coreSettingsIndex({ pageOf,
  nvidia })` gives the host the core's rows for its index.
- The lists (`options.ts`, `dictationOptions.ts`, `diagnosticsOptions.ts`) carry each
  row's `section`, `icon`, `sub` (its resting subtext, at most eight plain
  words, which the search reads too) and hidden `keywords`, as FLAT one-line
  entries with no brace inside: Prism's gate reads them as text. Their order
  is the display order inside each section, and each app's e2e checks it per
  section (`[data-settings-section]`).
- DOM hooks: `[data-settings-page]` on the frame, `[data-settings-tab=<page>]`
  on rail buttons (`aria-current="page"` on the chosen one, a GREY
  `--p-hover-hi` fill, never the accent), `[data-settings-find]` (it wears
  `data-owns-escape` only while it holds text, so an empty field lets Escape
  through to the host), a row's controls in a `role="group"` named by its label,
  `[data-settings-section=<id>]`, `[data-settings-panel]`,
  `[data-pref=<id>]` + `[data-setting-row]` on rows, `[data-term-wall]` on the
  theme wall's block, `[data-flash]` while a found row flashes, every
  existing dictation and theme hook unchanged.
- Focus inside a row is a fill and a lighter edge, never a ring (Prism #272);
  a dropdown's menu in a row blurs what is behind it and casts no shadow.
- No new token: panels are `color-mix()` of `--p-text`, edges `--p-line`,
  corners `max(4px, --p-radius + 3px)`.
- **The old layouts are gone** (audit 2026-10-12, after checking Prism's pinned
  core imports none of them): `Pref`, `ThemeHead`, `ROWS`,
  `TerminalAppearanceSettings`, `AgentIndicatorSetting`, `AttentionSettings`,
  `ShellSetting`, `DictationSettings`, and the colour fields'
  `parseHexInput` / `hexCommit` / `HexSwatch` (`colourCommit` and `ColourField`
  replaced them). The pieces they shared (`theme/ThemeWall.tsx`,
  `theme/useTermSetup.ts`, `dictation/useDictationState.ts`,
  `dictation/parts.tsx`) are the sections' own now.

**THE DIAGNOSTICS LOG (#140, 2026-10-07)** is the fifth: both apps catch their
stalls and errors the same way. `main/diagnostics.ts` `startDiagnostics` wires
it in one call; its main deps include **`diagLogDir`** (`<userData>\logs`), and
**a host without it logs nothing** (the page's bridge still answers, so Prism
is unchanged until it passes one). Call it before any IPC is registered (it
times every call by wrapping `ipcMain` itself), `watchWindow(win)` once the
window exists, `stop()` on the quit that goes ahead, and add `withStackPolicy`
in the session's `onHeadersReceived` for `mainFrame` responses (without that
Document-Policy the page stack never comes). Optional: `longWaitChannels`
(the host's channels that wait on the user or a download, never `ipc-slow`),
`powerMonitor` (a getter, so a sleep is not a lag), and `log.flushSync()` in
the window's `session-end`, where no quit comes. The bridge is `DGCH` in
`shared/channels.ts`, `preload/diagApi.ts` and `main/diagIpc.ts`; the page
calls `startDiag(bridge)` and anything may call `crumb()`. The Settings page
is `settings/sections/DiagnosticsPage.tsx` (props only), its rows
`diagnosticsOptions.ts`. Read it with `npm run diag` (`tools/diag.mjs`): it writes
`%APPDATA%\Prism\logs\diag.jsonl`; kinds include `page-stall`, `main-lag`, `ipc-slow`, `agent-hook`, `mark`.

**THE TAB MARKS (#143)** were Prism Terminal's strip and were dropped from the core (2026-10-23): `tabMark`, `markColours`, `markPalette`, `nameInk`, `switchKnob`, `TabMark`, `AgentIcon`, `marks.css`, the Ring indicator, the rainbow finish and `TermHostConfig.tabMarks`. The indicator choices are Off, Minimal (Bar) and Full.

**THE QUESTION FOLLOWER (Sonara #323, core 0.41.0)** tells Sonara, the
text-to-speech reader for Claude Code, which question of an AskUserQuestion
the user is on, which Claude Code itself tells no plugin.
`renderer/questionWidget.ts` reads the question off the screen rows, the last
tab row being the live widget (pure,
tested on measured screens), `renderer/questionWatch.ts` watches a session
after output settles and reports a change once, `term:question` carries it,
and `main/sonaraLink.ts` posts it to the Sonara on 127.0.0.1 named by its
`runtime.json`, naming the tab by its shell's `PRISM_TAB_ID` (`ptyEnv`, one
random token per shell, warm or not; Sonara's hook reads the same variable).
No Sonara: nothing is sent. `termQuestion` is optional on `TermApi`; a host on
`createTermApi` and `registerTermIpc` (both apps) gets it with nothing to add.

## Rules for code in here (lint-enforced in Prism's `eslint.config.js`, the `packages/term-core` block)

- **Relative imports only.** No `@shared` / `@renderer` / `@core` aliases: a
  consumer's bundler resolves an alias against ITS OWN tree. Measured: the core
  silently ran Prism's copy of a file, with no error anywhere.
- **Never `window.prism`.** Reach main through `termApi()`.
- **Never import from a host's `src/`**, never import `electron`.
- **Carry the superset.** A capability one host needs and another does not
  (`cdTerm`, `decideFollow`, following the host style) lives here and the
  other host simply does not call it. Deleting it here takes it from every host.
- **Components outside the terminal take PROPS ONLY.** The update chip and its
  dialog never reach for a bridge, not even `termApi()`: a host hands the hook
  the three preload members it needs (`UpdateBridge`).
- CSS: the core uses Tailwind utilities and the `--p-*` tokens Prism defines,
  plus the class `.p-scroll` and the `.xterm` rules in `index.css`. A new token or class needed
  here must be added there.
- A main-side file obeys "main never waits on the disk": a `*Sync` call is marked
  `// sync-ok: <reason>` (`src/main/syncCalls.test.ts`).

## How Prism consumes it

Root `package.json` has `"workspaces": ["packages/*"]` and the devDependency `"prism-term-core": "*"`, which npm
links as `node_modules/prism-term-core` to this folder. A DEV dependency on purpose: electron-vite bundles dev
dependencies into the app and externalises production ones, so the core is compiled in and nothing extra ships.
Prism's build needs these lines, all measured:

```ts
// electron.vite.config.ts, renderer: a linked package otherwise brings a second React
resolve: { dedupe: ['react', 'react-dom'] }, optimizeDeps: { exclude: ['prism-term-core'] }
```
```css
/* src/renderer/src/index.css: Tailwind generates nothing from a folder outside the renderer until told to look */
@source '../../../packages/term-core';
```

Plain `.ts` settings modules that the package `exports` do not reach (`coreIndex`, `sectionIds`,
`layout/icons`) are resolved by exact specifier through `CORE_TS` in `electron.vite.config.ts` and
`vitest.config.ts`, and the paths in `tsconfig.web.json`.

**A worktree must relink the package.** A copied `node_modules` still links to main's folder; run `npm install`
in the worktree. `tools/check-core-link.mjs` fails `test`, `typecheck`, `build`, `e2e` and `package` otherwise.

`react`, `node-pty` and `@xterm/*` versions are Prism's. `node-pty` is pinned to EXACTLY `1.2.0-beta.15`
(1.1.0's quit crash, #127/#159; `src/main/nodePtyPin.test.ts`). The core's peer names that build
(`^1.1.0 || 1.2.0-beta.15`): a bare `^1.1.0` matches no prerelease, so npm refused the pin.

## Changing the core

There is no core release. A terminal change is a Prism PR with Prism's version bumped as usual, gated by
`npm run e2e:terminal` (`terminal-gate.yml`, which triggers on `packages/term-core/**`). A bug becomes a failing
scenario or unit test FIRST, then the fix. XTVERSION reports Prism's version (`shared/termVersion.ts`, defined from
the root `package.json` by the build); `XTERM_VERSION` moves with xterm (`termVersion.test.ts` fails otherwise).
Keep the gate runner-safe: nothing in those scenarios may assume one particular machine.
## One copy of each rule (2026-10-12, core 0.34.0)

An audit for duplicated code (`Documents\Claude\research\prism-terminal\2026-10-12-duplication-audit.md`)
moved every rule both apps had written twice into one place here. A host uses these and never
re-types what they decide:

- `components/Modal.tsx`: every dialog's frame (scrim, Escape, a plain Tab kept inside, `no-drag`,
  focus back on close). A test holds that no other file declares `aria-modal`.
- `components/layers.ts`: `LAYER`, the overlay z-order, bottom to top.
- `lib/prefStore.ts`: `enumPref`, `boolPref`, `readPref`, `writePref`; a blocked store loses the
  choice, never the app. Keys stay byte for byte.
- `lib/termCells.ts`: also `logicalLine`, `bufferRowCells`, `charAtCell` (rule 11), and `byHand`: a
  row a program broke at the edge itself (Claude Code), where PATHS are read across the break.
- `lib/termKeys.ts`: what a key over a shell does, in order. `components/termReplyHandlers.ts`: what
  a program asks the terminal about itself.
- `lib/oklab.ts`, `colour.ts`'s `canonicalStored` and `clamp`, `termAnsi.ts`'s `towardRoom`.
- `shared/ground.ts` (`DEFAULT_GROUND`, `LIGHT_GROUND`, `ON_DARK_INK`), `shared/psQuote.ts`,
  `shared/webUrl.ts` (`isWebUrl`), `shared/folderNames.ts`, `shared/types.ts`'s `RESUMABLE_AGENTS`
  and `isResumable`, `main/atomicWrite.ts`, `preload/api.ts`'s `subscribe`.
- `lib/termLook.ts`'s `AGENT_COLOUR_STATES`: the three mark colours as one table.
