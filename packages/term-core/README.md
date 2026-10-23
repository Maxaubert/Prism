# prism-term-core

What **Prism Terminal** and **Prism** share. One copy, two apps.

This folder is the terminal, and since 2026-09-19 (#28) the few other things the
two apps must show identically: today that is the update chip and the window it
opens. Prism Terminal is an app built around it; Prism is a media viewer that
embeds it. Both compile this same TypeScript source, so a feature or fix in here
is written once and reaches both.

## Why it exists

Prism Terminal began (2026-09-18) as a COPY of Prism's built-in terminal. A copy
drifts from the first commit: within a day, links highlighting, a painting fix,
a themed indicator and a paste rule each existed in only one of the two apps.
The owner's rule (2026-09-19, issue #15): *"this terminal app is just an
extraction of the main Prism app and should therefore be reflected in both
apps... all should be synced, unless it conflicts with one app, then you need to
ask me."* And: *"why can't this repo be the core?"* It can, and this is it.

## The contract

1. **What is the terminal lives here, once.** The pty and shells, the prompt
   bootstrap, agent detection / poll / resume, the panel, find, link painting,
   the agent indicator's rules and colours, the close question, the paste rule,
   the theme and look stores, **and the terminal's SETTINGS UI** (`renderer/settings`):
   the owner's rule is that the two apps' terminal settings are the same
   settings, "the setting names, types, how they function", while the personal
   VALUES stay per app (each has its own storage; nothing is shared).
2. **What is an app's shell stays in the app.** Prism: roots and the wall, the
   sidebar, the split dock, several shells per tab, app styles. Prism Terminal:
   folder tabs, the start screen, window chrome from the theme, the lifecycle.
   Dictation (#13) is in here too, whole: the key, the microphone, the engine,
   the model store, the pill, the tab mark and its Settings page. A host wires
   it with four lines: `registerDictationIpc` in main, `createDictationApi` in
   the preload, the `dictation` field of its host config, and
   `useDictationArm` + `<DictationPill>` where its terminal is drawn. It also
   runs `core/tools/fetch-whisper.mjs <dir>` at build time and ships that folder
   as `resources/bin/whisper`, and grants its own window the `media` permission
   (audio only).
   **One dictation for every app** (2026-10-17, spec
   `docs/superpowers/specs/2026-10-17-dictation-all-apps.md`): a Prism Terminal
   runs it for every app on the PC, over an authenticated local pipe
   (`main/dictationLink.ts`). Another app joins with `startDictationClient`
   (`main/dictationClient.ts`): the pipe and key from `linkPipe(linkKey(...))`,
   its name ("Prism"), and a host giving its tabs, `agentUnder`, `writeTerm`
   and a paste into its front tab (`pasteIntoFront`). While connected its page
   turns its own key reading off (`setDictationPageKeys(false)`). The checked
   typing (`typeChecked`, the rule 2 exception) is the core's, for every app.
   Optional for a host: `parakeetHost` on `registerDictationIpc` keeps Parakeet
   loaded (`dictation-host/parakeetHost.ps1`), `idleMs` keeps the engine up.
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
   **The orchestrator** (beta, 2026-10-16): the status plugin's turn hooks
   (`UserPromptSubmit`, `Stop`) add `session=<Claude session id>` to the signal
   (`AgentSignal.session`, a lower-case UUID or nothing). A SECOND plugin,
   `claude-plugin-orchestrator` (the `catch-up` and `orchestrator` skills, the
   role hook), is opt-in: `orchestratorOn()` (off by default) and
   `pluginChoice()` go to `termSpawn`/`termPrewarm` as `{ status, orchestrator }`
   (a plain boolean still means the status plugin), and a host ships the
   folder and passes it as `orchestratorPluginDir` to `registerTermIpc`. A
   host that keeps a session list calls `setSessionsFile(path)`
   (`main/terminal.ts`), and every shell then gets `PRISM_SESSIONS_FILE` (an
   inherited one is always dropped). Prism Terminal's ledger and the
   promoted tab are app code (`src/main/sessionLedger.ts`, `sessionsWire.ts`);
   a host without them passes no folder, and nothing changes there.
   **The bell and OSC 52** (#177, #176) ride the bridge, not `TermHostConfig`.
   A program's OSC 52 copy needs nothing from a host: `createTermApi` and
   `registerTermIpc` carry `clipboard:term-write` (write-only, 1 MB). The bell
   needs ONE line: a host wires it by passing `attention` to `registerTermIpc`
   (Prism Terminal flashes its taskbar button while the window is unfocused,
   `src/main/bellFlash.ts`); a host that passes none stays silent.
   **AND WHAT THE TWO APPS MUST SHOW IDENTICALLY, TERMINAL OR NOT** (#28, owner,
   2026-09-19). This WIDENS the core, on purpose, from "the terminal" to "what
   the two apps share". Asked to build the update window (*"when you click the
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
   **COMMAND HELP (#12)** is the second thing in here that is not terminal, under
   the same bar: `shared/help/` (the catalogue, six files of curated entries; its
   pure offline search; `catalogue.test.ts`, the gate for content),
   `renderer/lib/helpPrefs.ts`, `renderer/components/HelpPanel.tsx` and
   `renderer/settings/sections/HelpSection.tsx` + `helpOptions.ts`. A host wires it with:
   `helpEnabled()` / `useHelpEnabled()` to decide whether its way in exists at
   all (on by default; off means no button and no key); ONE `<HelpPanel>`, a
   side panel since 0.38.0 (#199), mounted INSIDE the terminal's column (it is
   absolutely placed on its right, under the title bar) from its first opening
   on and handed `open`, so it slides out as well as in; lazy-loaded since it
   brings the catalogue with it, handed `shell`
   (`shellOfShellId` of the shell in front, from the light `shared/help/shells.ts`),
   `monoFont` (`termFontStack()`), `onCopy` (the bridge's `writeClipboard`, which
   goes through main because `navigator.clipboard` refuses an unfocused
   document; Prism Terminal passes `copyTextQuietly`, since the row's check says
   it), `onPickShell` and `onClose`; its key in `ownsKey`, tested against
   `helpEnabled()`, so xterm yields it exactly when the host takes it (Prism
   Terminal uses a bare F1); and `<HelpSection>` on its settings
   page. As with the update window, a
   host that raises a question of its own while the panel is out must PUT IT
   AWAY first and must not open it over one. It is NOT a dialog: it may stay
   out across a tab switch (the shell beside it gets the keyboard); a find bar,
   which sits where it does, puts it away. Two rules
   travel with it. **It never inserts and never runs**: the component has no
   session id and no bridge, only `onCopy`, and a host must not give it more.
   **Copy is exact**: the text on screen, which since 0.38.0 drops a TRAILING
   placeholder (`blankless`: `Set-Location ` for `Set-Location FOLDER`) and
   keeps every other one.
3. **A difference between the apps is DECLARED, never forked.** Every place the
   two legitimately differ is a field of `TermHostConfig` in
   [`renderer/host.ts`](renderer/host.ts): the default each untouched setting
   reads as, whether there is a host style to follow, who paints the ground,
   what an unpicked indicator colour resolves to, what "acrylic" means as a
   terminal setting, which chords the app owns, which tab marks its strip draws
   (`tabMarks`, #143), whether a right-click reaches a program that reads the
   mouse (`rightClickReports`, Flare #49; absent, xterm forwards it as before), the dictation key a user who
   never picked one gets (`dictation.defaultHotkey`; absent, Ctrl+Win; Prism
   declares Right Alt). If a difference is not on that page, it is a fork,
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
there is no Opacity row and no `termOpacity`/`setTermOpacity`: where
`acrylic.kind` is 'window' the theme Background's alpha is the window's
see-through (`termGroundAlpha`, `withGroundAlpha`, `legacyTermOpacity` for a
host's one-time migration); `TERMINAL_OPTIONS` is the same list in every host.
Since 0.31.0 (#156) the switch alone makes such a window see-through: an
opaque ground in force under it paints Prism's default levels
(`seeThroughAlpha`, 0xb9 dark / 0xd1 light, `lib/seeThrough.ts`) through
`paintsAlpha`, the one rule `termGroundAlpha` and Save changes' dirty check
share. The switch is read as stored (`termAcrylic`): the rule that held High
Contrast solid went with the theme (owner, 2026-10-11). The
row is named by `acrylicLabel()` ("See-through window" there, the list's label
in Prism) and drawn right under the wall, before `afterTheme`.
Since 0.36.0 (owner, 2026-10-13) that row is a SLIDER where `acrylic.kind` is
'window': `termSeeThrough`/`setTermSeeThrough`/`useTermSeeThrough`, 0 to
`SEE_THROUGH_TOP` (70), `termAcrylic()` is `level > 0` and `termGroundAlpha()`
is `1 - level/100`, never a colour's alpha. The level is a theme extra (reset
on a pick, saved as `CustomTermTheme.seeThrough`, applied with Custom); the
Background pickers carry no alpha and `withGroundAlpha` saves the ground
opaque. `paintsAlpha` and `LEGACY_ACRYLIC_KEY`/`SEE_THROUGH_STORE_KEY` are for
the host's one-time move. Where it is 'style' (Prism) nothing changed: the
switch, `setTermAcrylic`. The settings field is `Slider` in `fields.tsx`.
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
  and light together, `theme/useTermSetup.ts`), `HelpSection`, `DictationPage`.
  WHICH PAGE holds a section is the host's; `coreSettingsIndex({ pageOf,
  nvidia, help })` gives the host the core's rows for its index.
- The lists (`options.ts`, `dictationOptions.ts`, `helpOptions.ts`) carry each
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
  `ShellSetting`, `HelpSetting`, `DictationSettings`, and the colour fields'
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
`diagnosticsOptions.ts`. Schema and how to read it: Prism Terminal's
`docs/diagnostics.md`.

**THE TAB MARKS (#143, 2026-10-10)** are the sixth: how a tab says its agent
is working, finished, asking or failed. `renderer/lib/tabMark.ts`
(`resolveTabMark`, the one rule: which mark, in which colour role, with which
motion, for Off, Minimal, Ring and Full on a flat or a Powerline tab),
`markColours.ts` (the icon's rainbow, `floorMark` to 3:1 on every ground),
`nameInk.ts` (Full's name: the theme's text unless under 2:1 on the fill),
`markPalette.ts` (every colour a strip's marks wear, pure),
`components/TabMark.tsx` (a flat tab's run, line, ring and fill, props only;
Ring is one mono glyph per state in the name's ink since #162)
and `styles/marks.css`, the motion, which a host IMPORTS
(`prism-term-core/renderer/styles/marks.css`; without it the marks stand still).
**`tabMarks`** on `TermHostConfig` declares what the host's strip draws: the
indicator choices (`hostIndicators()`; a stored value outside them reads as the
host's default, `readIndicator`) and whether it draws the rainbow
(`hostRainbow()`, which also decides whether `AgentMarksSection` draws the
"Rainbow finished mark" row). Absent: Off, Minimal and Full, Full being the
host's own filled tab, and no rainbow row, so a host that has not adopted the
marks sees no change. That row's list is `settings/markOptions.ts`, NOT
`TERMINAL_OPTIONS`; `coreSettingsIndex({ marks: true })` indexes it. Its
switch is `agentRainbow()` (`prism.term.agentRainbow`, on; no theme resets it).
Since #154 Full's working fill on a flat tab carries Minimal's run on top
(`overlay`, in the name's ink; a Powerline fill has no overlay) and finished is
the rainbow across the whole tab (`rainbowInk` picks its name's ink).

**THE ON SWITCH'S KNOB (#154)** is `--p-switch-knob` where the host defines it
(`lib/switchKnob.ts`: the theme's black or white, flipped only under 2:1 on
the track), else `--p-on-accent` as before. Prism has not defined it.

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

## Rules for code in here (lint-enforced in Prism Terminal's `eslint.config.js`)

- **Relative imports only.** No `@shared` / `@renderer` / `@core` aliases: a
  consumer's bundler resolves an alias against ITS OWN tree. Measured: the core
  silently ran Prism's copy of a file, with no error anywhere.
- **Never `window.prism`.** Reach main through `termApi()`.
- **Never import from a host's `src/`**, never import `electron`, never import
  Prism Terminal's `chromeTheme` (inside Prism it would overwrite the app's
  styles).
- **Carry the superset.** If one app needs a capability the other does not
  (`cdTerm`, `decideFollow`, following the host style), it lives here and the
  other app simply does not call it. Deleting it here takes it from both.
- **Components outside the terminal take PROPS ONLY.** The update chip and its
  dialog never reach for a bridge, not even `termApi()`: a host hands the hook
  the three preload members it needs (`UpdateBridge`), so the same components
  drop into a host whose terminal is not even mounted.
- CSS: the core uses Tailwind utilities and the `--p-*` tokens both apps define,
  plus the class `.p-scroll` and the `.xterm` rules in each app's `index.css`. A
  new token or class needed here must be added to BOTH. The marks' classes
  (`.p-agent-run`, `.p-mark-*`) live in the core's own `styles/marks.css` since
  #143, which each host imports.

## How each app consumes it

**Prism Terminal** (this repo): directly, through the app-side alias `@core`,
plus ONE line in `src/renderer/src/index.css`: `@source '../../../core';`. Tailwind
scans from the renderer root down and `core/` is outside it, so without the line
a utility used only in here is never generated, silently (#20: it took the whole
Settings page apart, with every functional test green).
The app's tests, lint and the e2e scenarios are the core's gate.

**Prism**: as a dev dependency pinned to a tag of the `core-dist` branch, which
is this folder on its own (`git subtree split --prefix=core`), so the package is
small, has no install scripts and carries no app files:

```jsonc
// Prism/package.json
"devDependencies": { "prism-term-core": "github:Maxaubert/PrismTerminal#core-v0.1.0" }
```

A DEV dependency on purpose: electron-vite bundles dev dependencies into the app
and externalises production ones, so the core is compiled in and nothing extra
ships. Prism's build needs three lines, all measured:

```ts
// electron.vite.config.ts, renderer: a linked checkout otherwise brings a second React
resolve: { dedupe: ['react', 'react-dom'] }, optimizeDeps: { exclude: ['prism-term-core'] }
```
```css
/* src/renderer/src/index.css: Tailwind generates nothing from a dependency until told to look */
@source '../../../node_modules/prism-term-core';
```

`react`, `node-pty` and `@xterm/*` must stay at compatible versions in both apps
so npm keeps ONE copy of each; the core is verified against Prism Terminal's
lockfile but ships against Prism's. Both apps pin `node-pty` to EXACTLY
`1.2.0-beta.15` (1.1.0's quit crash, #127/#159). The core's peer names that
build (`^1.1.0 || 1.2.0-beta.15`): a bare `^1.1.0` matches no prerelease, so npm
refused the pin in Prism.

## Releasing the core

Nobody does, by hand (PrismTerminal #23; owner, 2026-09-19: "that compiled copy
needs to be auto bumped when a new Prism Terminal release or merge to main
happens"). Land the change through a PR in Prism Terminal, WITH a bump of
`core/package.json`'s version (CI fails the PR otherwise: a released tag is never
moved). Bump `core/shared/termVersion.ts` (`TERM_CORE_VERSION`, what XTVERSION
reports, #171) with `core/package.json`, and `XTERM_VERSION` with xterm:
`termVersion.test.ts` fails otherwise. On merge, `.github/workflows/core-release.yml`:

1. re-splits this folder into `core-dist` and tags `core-v<version>`. Tags are
   `core-v*` for the core and `v*` for the app, since this repo is both;
2. opens a PR in Prism bumping the pin and Prism's own version;
3. waits for that PR's checks, which include Prism's TERMINAL GATE on a GitHub
   runner (`terminal-gate.yml` there): the built app driven through every
   scenario the terminal can break, real dictation included. Prism has the larger
   footprint and so more ways to break, which is why the proof runs there;
4. merges it, if the owner has set the repo variable `PRISM_AUTO_MERGE` to
   `true`, and Prism releases itself; otherwise the green PR waits for a person.
   A red check never merges.

The one thing still cut by hand is a RELEASE CANDIDATE for an open PR
(`core-v0.2.0-rc.N`, split from the PR's branch), so Prism's half can be built
and tested before the core's half merges. The core's lint and unit tests run
only here; Prism's gate on it is its compiler, its unit suite and that e2e.
**Keep Prism's gate runner-safe:** nothing in those scenarios may assume one
particular machine.

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

## Status (2026-09-19)

Prism Terminal runs entirely on this core. Prism's adoption is written and
waiting on the owner's review as three stacked draft PRs (Prism #155, #156 and
the step-3 PR): identical files, then the panel / look stores / bridge, then the
settings, the indicator's rules and the close question. Until this branch merges
Prism pins a release candidate (`core-v0.1.0-rc.N`); the first real tag,
`core-v0.1.0`, is cut from `main` after the merge and Prism is repointed at it.
Issue #15 holds the decisions and what is left.
