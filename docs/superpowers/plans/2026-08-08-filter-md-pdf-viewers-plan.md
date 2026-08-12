# Sidebar Filter + Markdown + PDF Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the navigation filter in the sidebar, render markdown for real, and replace Chromium's PDF UI with a first-party pdf.js viewer with its own Ctrl+F.

**Architecture:** All renderer-side except a one-line CSP change and no main-process changes. The filter reuses the existing `navScope` store. Markdown is a new `MarkdownView` on react-markdown with a sanitize-after-raw pipeline and a pure URL-resolution lib. PDF is a `components/pdf/` family on `pdfjs-dist`: canvas pages in a scroll container, pdf.js TextLayer for selection, CSS Custom Highlight API for find matches, pure search lib.

**Tech Stack:** React 19, TypeScript, Tailwind v4, react-markdown + remark-gfm + rehype-raw + rehype-sanitize, pdfjs-dist, vite-plugin-static-copy, vitest, playwright-core.

## Global Constraints

- No em-dashes anywhere (en-dashes, commas, or parentheses).
- Follow Filesmith/Prism conventions: `@shared`/`@renderer` aliases, small focused files, feature-not-layer.
- Dark viewer chrome, single indigo accent `#5b5bd6` via existing `--p-*` CSS vars; no light theme work.
- Sanitized markdown must never execute scripts/handlers/iframes.
- `npm run typecheck && npm run lint && npm test && npm run build` green before the PR.
- Spec: `docs/superpowers/specs/2026-08-08-filter-md-pdf-viewers-design.md`.

---

### Task 1: Dependencies + CSP + static assets

**Files:**
- Modify: `package.json` (deps)
- Modify: `src/renderer/index.html` (CSP)
- Modify: `electron.vite.config.ts` (static copy + worker)

**Steps:**
- [ ] `npm i react-markdown remark-gfm rehype-raw rehype-sanitize pdfjs-dist && npm i -D vite-plugin-static-copy`
- [ ] CSP: `img-src 'self' data: blob: fsmedia: https:`; `media-src 'self' blob: fsmedia: https:`; add `font-src 'self' data: blob:` (pdf.js font blobs).
- [ ] `electron.vite.config.ts` renderer plugins gain `viteStaticCopy({ targets: [{ src: normalizePath(resolve('node_modules/pdfjs-dist/cmaps')) + '/**', dest: 'pdf/cmaps' }, { src: normalizePath(resolve('node_modules/pdfjs-dist/standard_fonts')) + '/**', dest: 'pdf/standard_fonts' }] })`. Verify dev serve exposes `/pdf/cmaps/`.
- [ ] Commit: `chore: markdown + pdf.js dependencies, CSP for remote images`

### Task 2: Sidebar filter button

**Files:**
- Create: `src/renderer/src/components/FilterMenu.tsx`
- Modify: `src/renderer/src/components/Sidebar.tsx` (header row)

**Interfaces:**
- Consumes: `NAV_SCOPES`, `useNavScope()`, `setNavScope()` from `@renderer/lib/navScope`.
- Produces: `<FilterMenu />` self-contained (button + popover), no props.

**Steps:**
- [ ] `FilterMenu`: button with funnel svg (`fill=currentColor` when `scope !== 'all'`, else `fill=none stroke`), `aria-haspopup="menu"`, `aria-expanded`, title `Navigation filter: <name>`. Popover styled like ContextMenu (hairline, `bg-[var(--p-title)]`), rows `role="menuitemradio"` `aria-checked`, name + hint, active row accent. Outside-pointerdown + Escape (stopPropagation, capture) close. Anchored below button via ref rect, right-aligned, clamped.
- [ ] Sidebar header becomes `justify-between`: root name span + `<FilterMenu />` (`no-drag`).
- [ ] Manual check via `npm run dev`; e2e covers it in Task 8.
- [ ] Commit: `feat(sidebar): navigation filter button with scope popover`

### Task 3: mdUrl lib (TDD)

**Files:**
- Create: `src/renderer/src/lib/mdUrl.ts`
- Test: `src/renderer/src/lib/mdUrl.test.ts`

**Interfaces:**
- Produces: `resolveMdUrl(url: string, baseDir: string): string` returning passthrough (`https?:`, `data:image/`, `fsmedia:`, `#anchor`), resolved `fsmedia://local/<enc(abs path)>` for relative paths, `''` for everything else (`javascript:`, `file:`, `vbscript:`, protocol-relative `//`). Also `isExternal(url)`, `isAnchor(url)`, `resolveLocalPath(url, baseDir): string | null` (decoded absolute path for link-opens, null when not a local relative link).
- Mirrors preload's `mediaUrl` shape: `fsmedia://local/` + `encodeURIComponent(path)`.

**Steps:**
- [ ] Failing tests: relative `docs/media/x.webp` + base `C:\Repo` → `fsmedia://local/C%3A%5CRepo%5Cdocs%5Cmedia%5Cx.webp`; `./a.png`, `../up.png` normalization; spaces; `#build-from-source` passthrough; `https://img.shields.io/...` passthrough; `javascript:alert(1)` → `''`; `//evil` → `''`; backslash bases with and without trailing separator.
- [ ] Run: `npx vitest run src/renderer/src/lib/mdUrl.test.ts` → FAIL.
- [ ] Implement with pure string ops (no `path` module in renderer): split on `[\\/]`, handle `.`/`..`, join with `\\`.
- [ ] Tests PASS. Commit: `feat(viewer): markdown url resolution lib`

### Task 4: MarkdownView

**Files:**
- Create: `src/renderer/src/components/MarkdownView.tsx`
- Create: `src/renderer/src/assets/md.css` (imported by MarkdownView; Tailwind v4 `@import` compatible plain CSS scoped under `.p-md`)
- Modify: `src/renderer/src/App.tsx` (route `.md`/`.markdown` to MarkdownView, keep TextViewer otherwise)

**Interfaces:**
- Consumes: `window.prism.readText`, `resolveMdUrl`/`isExternal`/`isAnchor`/`resolveLocalPath`, `window.prism.openWithin`.
- Produces: `<MarkdownView path={string} onOpenLocal={(p: string) => void} />`.

**Steps:**
- [ ] Component: load text via `readText`, render `<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]} urlTransform={(u) => resolveMdUrl(u, baseDir)}>`. Schema = deepmerge of `defaultSchema` allowing: `img[src,srcset,alt,title,width,height,align]`, `picture`, `source[src,srcset,type,media]`, `video[src,poster,controls,loop,muted,playsinline,width,height]`, `audio[src,controls,loop]`, `details[open]`, `summary`, `input[type,checked,disabled]`, `kbd`, `sup`, `sub`, `align` on `div,p,h1..h6,td,th`, `code[className]` restricted to `/^language-./`. Protocols for `src`: `https`, `http`, `fsmedia`, `data`.
- [ ] Click interception on container: external → `window.open(href)` (routed to shell by main's window-open handler) + `preventDefault`; anchor → `querySelector` scrollIntoView; local file → `onOpenLocal(path)`.
- [ ] Container: `overflow-auto h-full w-full`, `tabIndex={-1}`, focused on mount (native PageUp/Down scroll, Task 7). Inner `.p-md` measure `max-width: 74ch; margin-inline: auto; padding: 2.5rem 1.5rem`.
- [ ] `md.css`: headings scale + hairline rule under h1/h2, indigo links (`var(--p-accent-hi)`), code/pre panels (`var(--p-side)` bg, hairline border, mono 13px), tables (collapse, hairline borders, header row tint), blockquote accent bar, `img,video{max-width:100%}`, `[align=center]{text-align:center}`, task-list checkboxes, `hr` hairline, `details>summary` pointer.
- [ ] App: in `Viewer`, `case 'text': return isMarkdown(file.name) ? <MarkdownView path={file.path} onOpenLocal={...openWithin flow} /> : <TextViewer path={file.path} />` with `const isMarkdown = (n: string) => /\.(md|markdown)$/i.test(n)`. Pass an `onOpenLocal` prop threaded from App's `openFromTree`.
- [ ] Verify with the Prism README in `npm run dev`: badges, film picture, headings, code fence, icon image.
- [ ] Commit: `feat(viewer): real markdown rendering`

### Task 5: pdfSearch lib (TDD)

**Files:**
- Create: `src/renderer/src/lib/pdfSearch.ts`
- Test: `src/renderer/src/lib/pdfSearch.test.ts`

**Interfaces:**
- Produces:
  - `type PageText = { items: string[] }` (one string per text-layer node, in order)
  - `type Match = { page: number; item: number; start: number; end: number; parts: Array<{ item: number; start: number; end: number }> }` (a match may span items; `parts` covers all touched items; `item/start/end` = first part)
  - `findMatches(pages: PageText[], query: string): Match[]` case-insensitive, empty query → `[]`, matches never cross page boundaries, item texts are concatenated without injected separators (pdf.js items already carry their own spacing).
  - `stepMatch(current: number, delta: number, total: number): number` wrap-around.

**Steps:**
- [ ] Failing tests: single-item match offsets; match spanning two items (`['Hel','lo world']`, query `hello` → parts across items 0+1); case folding; multiple matches per item; no cross-page match; empty query; `stepMatch(0,-1,5) === 4`, `stepMatch(4,1,5) === 0`, total 0 → -1.
- [ ] Run vitest → FAIL. Implement: per page, build `full = items.join('')` with an offset index; `indexOf` loop over `full.toLowerCase()` for `query.toLowerCase()`; map global offsets back to item parts.
- [ ] Tests PASS. Commit: `feat(viewer): pdf text search lib`

### Task 6: PDF viewer components

**Files:**
- Create: `src/renderer/src/components/pdf/PdfView.tsx`
- Create: `src/renderer/src/components/pdf/PdfPage.tsx`
- Create: `src/renderer/src/components/pdf/PdfFindBar.tsx`
- Create: `src/renderer/src/assets/pdf.css` (text layer + highlight styles)
- Modify: `src/renderer/src/App.tsx` (`case 'pdf'` → `<PdfView url={url} onToggleFullscreen={...} />`)

**Interfaces:**
- Consumes: `pdfjs-dist` (`getDocument`, `GlobalWorkerOptions`, `TextLayer`), worker via `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`, `findMatches`/`stepMatch`, fsmedia URL.
- Produces: `<PdfView url={string} onToggleFullscreen={() => void} />`.

**Steps:**
- [ ] `PdfView`: `getDocument({ url, isEvalSupported: false, cMapUrl: './pdf/cmaps/', cMapPacked: true, standardFontDataUrl: './pdf/standard_fonts/' })`. States: `doc`, `error ('load'|'password'|null)`, `zoomMode ('fit-page'|'fit-width'|'manual')`, `zoom`, `page` (current, from scroll position), find state (`open`, `query`, `matches`, `current`). Scroll container ref; pages laid out vertically, gap, centered. Per-page viewport width computed from container size + mode (ResizeObserver). Keys (window listener): `Ctrl+F` open bar; `+/-/0/f` mirror ImageView; `PageUp/PageDown` jump page (scroll to page top); Escape handled by find bar only. Ctrl+wheel zoom (preventDefault), sets manual mode.
- [ ] Text extraction cache: `getTextContent` per page lazily (promise cache), producing `PageText` aligned 1:1 with the strings handed to the text layer nodes. Find effect: on query change, extract all pages then `findMatches`; current match navigation scrolls its page into view.
- [ ] `PdfPage`: props `{ pdfPage, width, active, matches, currentMatch, onVisible }`. Renders placeholder div sized from viewport aspect until `near` (IntersectionObserver rootMargin ~1.5 viewports); when near: canvas render at `min(devicePixelRatio, 2) × scale`, `TextLayer` into overlay div; when far again: release canvas (keep size). Highlights: build `Range`s over text-layer text nodes from match parts, register `CSS.highlights.set('p-find', ...)`, `'p-find-here'` for current (set registered globally in PdfView from all rendered pages' ranges).
- [ ] `PdfFindBar`: input (autofocus, `stopPropagation` on keydown Escape → close, Enter/F3 next, Shift+Enter prev), `n / m` counter (`0 / 0` empty), prev/next/close buttons, hairline pill styled like `bg-[var(--p-title)]/95`, top-right absolute.
- [ ] `pdf.css`: `.p-textlayer` (absolute inset-0, `span{position:absolute; transform-origin:0 0; white-space:pre; color:transparent}`, selection tint `::selection{background:rgba(91,91,214,.45)}`), `::highlight(p-find){background:rgba(91,91,214,.35)}`, `::highlight(p-find-here){background:rgba(91,91,214,.75); color:#fff}`, canvas `shadow` card look on the page.
- [ ] Controls pill (in PdfView, ImageView styling copied): page input + `/ N`, divider, zoom −/%/+, fit toggle (two-state icon, title `Fit width` / `Fit page`), fullscreen button reusing `IconFull`.
- [ ] Error states per spec. Commit: `feat(viewer): first-party pdf viewer with find`

### Task 7: App key routing + Escape typing guard

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Steps:**
- [ ] `const DOC = new Set(['pdf', 'text'])`; in the app key handler: for `PageDown/PageUp/ArrowDown/ArrowUp`, when `file && DOC.has(file.kind)` do nothing (no preventDefault, no `go`), letting the focused doc container / PdfView handle them. Left/Right unchanged.
- [ ] Escape: add `!typing` guard (`if (e.key === 'Escape' && !typing)`), so an Escape inside the find bar input (or a rename box) never closes the window.
- [ ] TextViewer/MarkdownView containers `tabIndex={-1}` + focus on mount/path change so native scroll keys work immediately.
- [ ] Update the code comment above the handler to describe the doc-keys rule.
- [ ] Commit: `feat(viewer): documents own their vertical keys`

### Task 8: E2E harness + fixtures

**Files:**
- Create: `tools/e2e/fixtures.mjs` (build fixture folder: copy README.md + `docs/media` assets + `build/icon.png` preserving relative layout; write `sample.pdf` (3 pages, known ASCII text incl. repeated token `grape` ×5) via a minimal hand-authored PDF; copy one mp3/png for scope tests)
- Create: `tools/e2e/run.mjs` (launch pattern from `tools/showcase/peek.mjs`: `_electron.launch` with `--user-data-dir` temp profile, seeded `prism.onboarded=1`)
- Modify: `package.json` scripts: `"e2e": "npm run build && node tools/e2e/run.mjs"`

**Steps:**
- [ ] Assertions (playwright): open README fixture → `.p-md h1` text `Prism`, `img[src^="https://img.shields.io"]` present and `naturalWidth > 0` (network on), local `img[src^="fsmedia:"]` with `naturalWidth > 0`, `pre code` present. Open `sample.pdf` → `canvas` count ≥ 1, pill shows `/ 3`; `Ctrl+F` type `grape` → counter `1 / 5`, Enter → `2 / 5`, Escape closes bar and window stays open. Filter: open mixed folder file, click funnel, choose `All in one` → icon outlined (`fill="none"`), choose `Per file type` → filled; position label in TopBar reflects narrowed list; Settings General select shows same value. Screenshots to scratchpad.
- [ ] Run `npm run e2e` → PASS.
- [ ] Commit: `test: e2e coverage for filter, markdown, pdf`

### Task 9: Docs

**Files:**
- Modify: `README.md` (What-it-is bullets: markdown renders formatted; PDF viewer is Prism's own with Ctrl+F; sidebar filter)
- Modify: `CLAUDE.md` (scope bullets: PDF via pdf.js first-party, md rendering; note new runtime deps join prism-core later)
- Modify: `ROADMAP.md` if it tracks these phases

**Steps:**
- [ ] Update, keeping README lean; commit `docs: filter, markdown and pdf viewer`.

### Task 10: Verification + review + PR

**Steps:**
- [ ] `npm run typecheck && npm run lint && npm test && npm run build && npm run e2e` all green (superpowers:verification-before-completion).
- [ ] Workflow fan-out review (correctness, sanitize/security, UX consistency) + adversarial verify; fix confirmed findings; re-run gates.
- [ ] Push branch, `gh pr create` referencing the issue.

## Self-review

- Spec coverage: filter (T2), md (T3-T4 + CSP T1), pdf (T1,T5,T6), key routing + Escape (T7), tests (T3,T5,T8), docs (T9), gates/PR (T10). Covered.
- No placeholders; interfaces named consistently (`resolveMdUrl`, `findMatches`, `stepMatch`, `PdfView url/onToggleFullscreen`).
- Types consistent across tasks 5→6.
