# Build, test, release and conventions

The full build, test, release and conventions notes, moved verbatim from `CLAUDE.md` on
2026-10-09. `CLAUDE.md` keeps a condensed version of every rule; this file keeps the history and
the reasons behind them (what broke, what was measured).

## Build, test, release

**The root wall covers `fsmedia://` too** (2026-08-28): media is served only from a root, from
an archive member main extracted on request, or from something main made itself (a converted
copy, a synthesised MIDI wav), each registered as it is handed over. The `fsaudio://` sibling
was walled from the start; this one was not, which was an accident of the two handlers being
written a month apart. One softening, because the wall broke something real: a MARKDOWN
DOCUMENT GRANTS ITS OWN PICTURES (`src/main/docImages.ts`). A doc in `docs/` pointing at
`../assets/logo.png` names a file outside the folder Prism opened in, and the wall refused it -
measured, and a regression against the markdown viewer's own relative-path resolver. Main reads
the document it is about to hand over and allows exactly the image files it names, so a page
still cannot ask for a path the document does not mention. The app's OWN asset tree is servable too, and that is not
optional: pdf.js fetches its cmaps, standard fonts, wasm and icc profiles over
`fsmedia://` because `fetch` refuses file: URLs in a packaged build, so walling
them off broke every PDF that does not embed its fonts - and only in the
PACKAGED app, since dev serves the same data over the vite server. Native
dialogs are parented to the window in the same pass - unparented, Windows makes them modeless and a fullscreen picker never
shows at all - and `file:text` is capped (64MB) and awaited, so a read error is caught rather
than escaping as a rejected invoke. It answers with a REASON, never null: the
editor used to seed itself with "(could not read file)" and record that as the
disk contents, so one Ctrl+S wrote the placeholder over a 200MB log. A file
Prism could not read is now shown as unreadable and cannot be saved at all.

**Standing step, every time a new file type is supported:** ask whether this change adds an
extension. If it does, it goes in `src/shared/fileKind.ts` AND
`build/installer/assoc.nsh`, or Windows will never offer Prism for it - Prism will open the
file happily and be missing from its "Open with", which is exactly what happened to 96
extensions when the code viewer landed. `src/shared/fileAssoc.test.ts` enforces the parity and
names the extensions to add, so the answer to "did I remember?" is `npm test`, not a re-read.
It reads BOTH halves of the .nsh since 2026-08-28: the install macro was tested and the
uninstall one was not, so it fell 96 extensions behind and uninstalling left dead "Open with"
entries pointing at a ProgID that no longer existed.
Bare names (`Dockerfile`, `Makefile`) and dotfiles cannot be registered: Windows associates on
extension and they have none.

**A TEST RUN LEAVES NOTHING IN %TEMP%** (2026-09-28): `vitest.global.ts` points the run's TEMP at
one folder and removes it after (94 folders a run leaked before; 40,809 had built up, and with Temp
open in the tree they were the 47,816-row stall of #235). A new test may mkdtemp freely.

**THE E2E STAYS HEADLESS** (owner, 2026-10-03, after a windowed suite flashed the screen and
was deleted): whatever is added to the e2e is added to `tools/e2e/run.mjs` and keeps its nature,
parked offscreen and never taking the focus.

`npm run dev` / `npm test` for the inner loop; `npm run e2e` drives the built app through
Playwright and runs OFFSCREEN (`tools/e2e/run.mjs` `park()`: opacity 0, position -4000,-4000,
off the taskbar) so it never covers what you are doing. Electron has no headless mode, and a
truly hidden window stops answering clicks and screenshots, so parking it is the way.
It also never takes the FOREGROUND (2026-08-28): the suite passes `--e2e`, and main then
creates the window `focusable: false` and `showInactive()`s it, because thirty launches
yanking the caret out of whatever the owner is typing is its own kind of broken. Playwright
drives the page over CDP, which needs no OS focus. MEASURED both ways: without the flag the
new window becomes the foreground window, with it the foreground never changes.
And every scenario REAPS what it leaves behind (same date, same file): the terminal
scenario's app outlived its `app.close()` - five electron processes still up - and since it
holds the single-instance lock, every scenario after it launched, handed its file over and
exited. Fifteen scenarios failed for one leak, and no amount of retrying could have helped;
only the profile path is matched, so the machine's own Prism is never touched.
`npm run e2e -- <name>` runs only the scenarios whose name contains `<name>`,
and each scenario has its OWN try/catch (2026-08-28): they used to share one,
so the first crash skipped every scenario after it and reported a single
failure. The run ends with a pass/fail/duration table.
`npm run package` builds the NSIS installer;
version lives in `package.json`. **Releasing is automated** (2026-08-21):
`.github/workflows/release.yml` builds and publishes on every push to main - a new
`package.json` version creates release `v<version>` with generated notes, a push on an existing
version replaces that release's installer in place. Bump the version when a release should be
NEW; CI gates are typecheck + unit tests only (the e2e needs this machine). Unsigned, per-user,
GitHub Releases.

**Installing is the LAST verification step, every time work is finished** - after typecheck,
lint and the unit tests, and not something to ask about first. They drive the built bundle,
never the shipped app: packaging and installing is what proves the installer still works, that
the associations still register, and that the resident app actually launches.
`npm run package`, then install `dist/Prism-Setup-x64-<version>.exe` silently with `/S`
(per-user, no elevation), closing any running Prism first. Report the installed version.

**THE E2E IS THE PR GATE AND NOTHING ELSE; AN INSTALL RUNS NONE** (owner, 2026-09-02, and again
2026-10-03 after installs that ran suites first: "no e2e, just install, e2e only before pr, as part
of the pipeline ... always with prism"). "Install" means package, silent install, launch, report the
version, with no e2e at all. The e2e runs as the gate before a PR is opened or pushed: the
SCENARIOS THAT COVER THE CHANGE while iterating, the whole suite before pushing. Agents and
workflows follow the same split.

**AND THE INSTALL IS NOT DONE UNTIL THE EXE'S TIMESTAMP MOVES** (2026-09-02). Two ways to be
fooled, both met on the same day. `Start-Process -Wait` on the installer hung for five minutes
and had to be killed. And a second installer started while one was already running, or while
Prism was running, sits waiting for the app to close - burning 30% of a core, writing NOTHING,
with a "Prism Setup" window on screen - so the version string still reads correct while the
build is the previous one. That is how a fix gets reported as shipped and looked at in a binary
that does not contain it. Kill every Prism AND every Prism-Setup first, then POLL
`Prism.exe`'s LastWriteTime until it changes, remembering it goes MISSING part way through
(the uninstall phase) before the new one appears. Launch the app only after the setup process
has gone.

## Conventions

- TypeScript, `sealed`-by-default mindset, small focused files, feature-not-layer organization.
- Follow Filesmith's patterns (aliases `@shared`/`@renderer`, eslint/prettier config, IPC shape,
  frameless TopBar) so `prism-core` drops into both apps cleanly.
- No em-dashes anywhere (use en-dashes, commas, or parentheses).
- No new runtime dependencies beyond React / Electron / `prism-core` without a reason. Current
  reasoned exceptions (all viewer-core, destined for `prism-core`): CodeMirror 6
  (`@codemirror/*` + `@lezer/highlight`, the code viewer: highlighting, folding, search and
  syntax-error squiggles across ~150 languages, which is not a thing to hand-roll),
  `react-markdown` +
  `remark-gfm` + `rehype-raw` + `rehype-sanitize` (markdown), `pdfjs-dist` (PDF),
  `heic-convert` (HEIC decode), `adm-zip` (the archive viewer: reading and rewriting zip
  containers is not a thing to hand-roll; pure JS, no native code), `node-pty` + `@xterm/*` (the terminal: a real ConPTY and
  its renderer, not a thing to hand-roll; node-pty is the app's ONE native module, ships
  N-API prebuilds, and must stay asarUnpacked or Windows cannot load it; `@xterm/*` now
  includes `addon-search`, because searching a terminal means the SCROLLBACK buffer,
  wrapped lines and the alternate screen, none of which a DOM search over the rendered
  rows can see), `exifr` (main-only, the photo's own EXIF). Shells spawn
  with node-pty's bundled conpty.dll (`useConptyDll: true`): the OS conhost FAST-FAILS
  the whole app (0xc0000409, no dialog) when a pty is killed mid-read (crashed 2026-08-21).
