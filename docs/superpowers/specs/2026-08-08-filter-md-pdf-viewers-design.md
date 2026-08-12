# Sidebar navigation filter, real Markdown, and a first-party PDF viewer

Date: 2026-08-08. Status: approved for implementation (owner away; end-to-end run authorized).

Three additions to the viewer, one theme: Prism stops delegating. The filter that only lived
in Settings gets a home where navigation happens, markdown stops rendering as raw text, and
the PDF page stops being Chromium's viewer wearing Prism's window.

## 1. Sidebar filter button

**What.** A funnel button in the sidebar header row (right-aligned, opposite the root name).
Clicking it opens a small hairline popover listing the same three options as
Settings → General → Navigation mode: All in one / Media · Documents / Per file type. Picking
one sets the same persisted `navScope` store Settings uses, so the two stay in sync in both
directions, live.

**Icon state.** The funnel is *outlined* when the scope is `all` (no filter, one list) and
*filled* when the scope narrows the list (`group` or `type`). The default scope is `group`,
so a fresh install shows a filled funnel; that is honest, a filter really is applied.

**Popover.** Styled like `ContextMenu` (square, bordered, ruled rows) but with
`role="menu"` / `menuitemradio` rows and `aria-checked` on the active scope; each row shows
the scope name with its one-line hint, active row in the accent colour. Dismiss on outside
press, Escape, or picking. Anchored under the button, clamped to the window.

**Tree rows follow the filter** (owner clarification, 2026-08-08): the same scope also hides
non-matching file rows in the tree, anchored to the open file's kind. Folders always show, the
open file always shows, an unrecognised open file ('other') suspends the filtering (it has no
family), and a folder left with nothing says "nothing matches the filter". Settings and the
funnel stay two handles on one store.

## 2. Markdown viewer

**What.** `.md` / `.markdown` files render as formatted documents; every other text kind
keeps the existing mono `TextViewer`. Target: the Prism README renders the way GitHub shows
it, dark: centered `<div align="center">` header, shields.io badges, `<picture>` AVIF/WebP
film, headings, lists, quotes, tables, task lists, fenced code, inline HTML `<img>`,
`<video>`, `<audio>`, gifs, `<details>`.

**How.** `react-markdown` + `remark-gfm` (tables, strikethrough, task lists, autolinks) +
`rehype-raw` (inline HTML) + `rehype-sanitize` running *after* raw, with a schema extended
from the default to allow: `img` (src/srcset/alt/title/width/height/align), `picture`,
`source` (src/srcset/type/media), `video` (src/poster/controls/loop/muted/playsinline/width/
height), `audio` (src/controls/loop), `details`/`summary`, `align` on block elements, `kbd`,
`sup`, `sub`, task-list checkbox inputs, `className` on code (language tag). Scripts, event
handlers, iframes and styles stay stripped: a downloaded README must not run anything.

**URLs.** A custom `urlTransform` in a small tested lib (`lib/mdUrl.ts`):

- `http(s):` passes through (badges load from the network; offline they fall back to alt text)
- `#anchor` stays an in-page anchor
- `data:` images pass, `javascript:` and everything unknown is dropped
- relative paths (`docs/media/prism.webp`, `./build/icon.png`) resolve against the markdown
  file's own folder to an `fsmedia://` URL, so local images/video/audio in a README play
  through the existing Range-aware protocol

**Links.** Clicks are intercepted: `http(s)` opens in the system browser (via the existing
window-open handler), `#anchor` scrolls within the document, a relative link to a local file
asks main to open it in Prism via `openWithin` (silently ignored outside the session root).

**CSP.** `img-src` and `media-src` gain `https:` so badges and remote images render. Nothing
is added to `script-src` or `connect-src`.

**Look.** A scoped stylesheet (`md.css`, class `p-md`): GitHub-dark proportions on Prism's
palette: readable measure (~72ch, centered), hairline heading rules, indigo links, subtle
code-block panels, hairline tables, accent blockquote bar. Body text uses the UI font, code
uses mono. No syntax highlighting in v1 (no extra dependency; fenced blocks are styled panels).

## 3. First-party PDF viewer

**What.** Replace `<embed type="application/pdf">` (the whole Chromium viewer UI: its toolbar,
sidebar, page chrome) with Prism's own viewer built on `pdfjs-dist`: pages rendered to canvas
in a continuous vertical scroll, Prism-styled controls that appear on hover, text selection,
and a first-party Ctrl+F.

**Structure** (small focused files, `components/pdf/`):

- `PdfView.tsx`: shell. Loads the document from the `fsmedia://` URL (`isEvalSupported:
  false`; worker bundled via Vite `?url`), owns zoom/fit state, scroll container, keys,
  find state, controls.
- `PdfPage.tsx`: one page: canvas render at `devicePixelRatio × zoom`, pdf.js `TextLayer`
  for selection, render-on-approach (IntersectionObserver; placeholder box with the page's
  aspect ratio until near the viewport, canvas released again when far away).
- `PdfFindBar.tsx`: the find UI (top-right overlay): query input, `n / m` match counter,
  prev/next, close.
- `lib/pdfSearch.ts` (pure, unit-tested): page text assembled from `getTextContent` items
  with per-item offsets; case-insensitive substring matching; match → text-item spans that
  the view maps onto text-layer nodes.

**Find.** Ctrl+F opens the bar (focus in the input), Enter/F3 next, Shift+Enter/Shift+F3
previous, Escape closes it. Matches highlight on every rendered page via the CSS Custom
Highlight API (`::highlight(...)` ranges over text-layer nodes; no DOM surgery), the current
match in a stronger accent, and navigation scrolls the match into view (rendering the target
page on demand). Match counting covers the whole document, not just rendered pages.

**Controls.** The image viewer's hover pill, adapted: page `n / N` (the `n` is an input:
type a page, Enter jumps), divider, zoom − / % / +, fit-width ↔ fit-page toggle, fullscreen.
Defaults: fit-page. Zoom range 25%–500%; Ctrl+wheel zooms toward the cursor, plain wheel
scrolls; `+`/`-`/`0` and `F` mirror the image viewer's keys.

**Key routing (App change).** Documents own their vertical keys: when the open file is a
`pdf` or `text` kind, Up/Down/PageUp/PageDown no longer page the folder; the document
scrolls (text/markdown containers take focus so native scrolling works; the PDF viewer
handles PageUp/PageDown as page jumps). Left/Right keep paging the folder everywhere.
Escape gains the existing `typing` guard so closing the find bar (or any focused input)
never closes the window.

**Font fidelity.** pdf.js `cmaps` and `standard_fonts` are copied into the renderer bundle
(static copy at build time) and passed as `cMapUrl` / `standardFontDataUrl`, so CJK and
non-embedded-font PDFs render correctly offline.

**Errors.** Unreadable/corrupt PDFs show the same quiet failure text style as the image
viewer. Password-protected PDFs show "This PDF is password-protected" (no prompt in v1).

## Dependencies

New runtime: `react-markdown`, `remark-gfm`, `rehype-raw`, `rehype-sanitize`, `pdfjs-dist`.
New dev: `vite-plugin-static-copy` (cmaps/standard_fonts). Justification: rendering markdown
and PDF properly are exactly the "with a reason" cases the convention anticipates; all five
are the canonical libraries and become part of `prism-core` when it is extracted.

## Testing

- **Unit (vitest):** `mdUrl` (relative resolution incl. Windows paths, protocol allow/deny,
  anchors), `pdfSearch` (matches across item boundaries, case folding, counts, wrap-around
  next/prev).
- **E2E (playwright-core, same launch pattern as `tools/showcase`):** a script under
  `tools/e2e` builds fixtures (a copy of the README + its local assets, a generated known-text
  multi-page PDF, a mixed media folder), launches the built app in a throwaway profile, and
  asserts: markdown renders (badges, heading, code block, local image), PDF renders (canvas
  pages, page counter), find reports the right match count and steps, the filter button
  changes scope + icon fill and stays in sync with Settings, and arrow navigation respects
  the scope. Screenshots land in the scratchpad for review.
- `npm run typecheck`, `lint`, `test`, `build` all green before the PR.

## Out of scope

Tree-row filtering, md syntax highlighting, PDF password prompt, PDF thumbnails/outline
panel (deliberately: "no pdf built-in sidebar"), printing, and any Filesmith-side changes.
