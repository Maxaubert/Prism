# Prism on your phone, PR 3: documents on the phone

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDFs, markdown, code and text (read-only), office and ebook documents, comics and archive listings open on the phone through the SAME viewers the PC uses, with the verbs a phone cannot honour hidden.

**Architecture:** Five read-only routes (`/api/text`, `/api/doc`, `/api/comic`, `/api/archive`, `/api/archive/extract`) call the converters main already has; each grants the phone the files that answer produces (a markdown's own pictures, a comic's unpacked pages, an extracted member) through a per-phone grant set the media route consults beside the root wall. The shim fills in `readText`, `docHtml`, `comicOpen`, `archiveList`, `archiveExtract`; the viewers get a `readOnly` (CodeView) and consult `window.prism.capabilities` (via `fileVerbs`) to drop Explorer, clipboard and write verbs. `resolveMdUrl` builds media URLs through `window.prism.mediaUrl` instead of a hard-coded `fsmedia://`.

**Tech Stack:** as PR 1 and 2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-06-phone-design.md`

## Global Constraints

- No em-dashes. Branch `feat/106-phone-documents` off `feat/105-phone-transcode`; issue #106; version `0.40.0`.
- NOTHING WRITES from the phone: no `writeText`, no archive writes, no rename, no delete. The shim has none of those members, and the server has no route for them.
- Every route checks `validRoot(phone.root, path)` (or the archive's own path for member routes) before touching anything; a granted file is granted to ONE phone.
- Hex and the terminal are not offered. An unknown kind shows `UnsupportedView` without its hex button (gate it on `capabilities`).
- Commit trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01MGe29Jw7CVa2MjsshPeQPM`.

---

### Task 1: Per-phone grants and the text/doc routes

**Files:**
- Create: `src/main/phone/grants.ts` + test
- Modify: `src/main/phone/server.ts` (+ test), `src/main/index.ts` (deps)

**Interfaces:**
- `grants.ts`:
  ```ts
  export class Grants {
    grant(token: string, path: string): void
    grantDir(token: string, dir: string): void          // everything under it
    has(token: string, path: string): boolean            // case-insensitive, normalised
    drop(token: string): void
  }
  ```
- `PhoneDeps` gains:
  ```ts
  readText: (p: string) => Promise<TextRead>            // main's file:text logic, factored
  docHtml: (p: string) => Promise<string | null>         // convertDoc + sanitizeDoc
  docImages: (p: string, text: string) => string[]       // documentImages
  isMarkdown: (p: string) => boolean
  ```
- Routes: `GET /api/text?path=` -> `TextRead` JSON (a markdown answer also grants the images it names); `GET /api/doc?path=` -> `{ html }` or 404.
- The media route allows `validRoot(root, path) || grants.has(token, path)`.

- [ ] **Step 1: grants test**

```ts
// src/main/phone/grants.test.ts
import { describe, expect, it } from 'vitest'
import { Grants } from './grants'

describe('Grants', () => {
  it('is per phone, case-insensitive, and prefix-aware for directories', () => {
    const g = new Grants()
    g.grant('a', 'C:\\Temp\\x.jpg')
    expect(g.has('a', 'c:\\temp\\X.JPG')).toBe(true)
    expect(g.has('b', 'C:\\Temp\\x.jpg')).toBe(false)
    g.grantDir('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc')
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\p1.jpg')).toBe(true)
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abcd\\p1.jpg')).toBe(false)
    expect(g.has('a', 'C:\\Users\\me\\AppData\\Roaming\\Prism\\comics\\abc\\..\\..\\x')).toBe(false)
    g.drop('a')
    expect(g.has('a', 'C:\\Temp\\x.jpg')).toBe(false)
  })
})
```

Implement with `path.resolve` + lowercase keys; a dir grant matches when `relative(dir, p)` is non-empty, not `..`-led and not absolute (the same test `mediaAllowed`'s `underDir` uses in `index.ts`).

- [ ] **Step 2: Server tests**

Add fake deps in `server.test.ts`: `readText: async (p) => p.endsWith('.md') ? { text: '![x](pic.png)' } : { text: 'hello' }`, `docImages: () => [join(dir, 'pic.png')]`, `isMarkdown: (p) => p.endsWith('.md')`, `docHtml: async () => '<p>doc</p>'`; write `pic.png` OUTSIDE `dir` (in a sibling temp dir) so the grant is what lets it through. Tests:

```ts
  it('reads text and grants a markdown its own pictures to this phone only', async () => {
    const a = await pair()
    const b = await pair()
    const t = await (await fetch(url(`/api/text?path=${encodeURIComponent(join(dir, 'readme.md'))}`), { headers: { authorization: `Bearer ${a}` } })).json()
    expect(t).toEqual({ text: '![x](pic.png)' })
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${a}`))).status).toBe(200)
    expect((await fetch(url(`/m/${encodeURIComponent(picOutside)}?t=${b}`))).status).toBe(403)
  })
  it('converts a document', async () => {
    const a = await pair()
    const d = await (await fetch(url(`/api/doc?path=${encodeURIComponent(join(dir, 'a.docx'))}`), { headers: { authorization: `Bearer ${a}` } })).json()
    expect(d).toEqual({ html: '<p>doc</p>' })
  })
```

(`media` in the test deps must answer 200 for `picOutside`; the wall being tested is the server's, `serveMedia` is faked.)

- [ ] **Step 3: Implement**

`server.ts`: a `grants = new Grants()` member; `forget` of a phone (Task 4 in PR 1 calls `forgetPhone`; add `server.dropGrants(token)` and call it from `phone:forget` in `index.ts`). Routes in `api()`:

```ts
      case 'text': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        const r = await this.deps.readText(path)
        if ('text' in r && this.deps.isMarkdown(path)) for (const img of this.deps.docImages(path, r.text)) this.grants.grant(token, img)
        return void json(res, 200, r)
      }
      case 'doc': {
        if (!inside()) return void json(res, 403, { error: 'outside the folder' })
        const html = await this.deps.docHtml(path)
        return html === null ? void json(res, 404, { error: 'Prism could not convert this document' }) : void json(res, 200, { html })
      }
```

`index.ts`: factor the body of the `file:text` handler into `const readTextWalled = async (p: string): Promise<TextRead>` (the wall check stays in the IPC handler; the phone route has its own) and pass `readText: readTextWalled`, `docHtml: async (p) => { const html = await convertDoc(p); return html === null ? null : sanitizeDoc(html) }` (guard with `docKind(extname(p))` first), `docImages: documentImages`, `isMarkdown: isMarkdownPath`. The markdown route ALSO has to add the images to main's `servable` set (that is what `mediaAllowed` checks inside `serveMedia`); expose a `grantServable(paths)` closure from `index.ts` in the deps and call it beside the phone grant.

- [ ] **Step 4: Tests, typecheck, lint, commit**

```bash
git commit -am "feat(phone): text and document routes, with per-phone grants for a markdown's own pictures (#106)"
```

---

### Task 2: Comics and archives, read-only

**Files:**
- Modify: `src/main/phone/server.ts` (+ test), `src/main/phone/routes.ts` (`api` names with a slash already parse), `src/main/index.ts`

**Interfaces:**
- `PhoneDeps` gains:
  ```ts
  comicOpen: (p: string, password: string) => Promise<ComicOpen | { error: 'password' | 'failed' | 'empty' }>
  comicsDir: () => string
  archiveList: (p: string, password?: string) => Promise<ArchiveListing>
  archiveExtract: (p: string, entry: string, password?: string) => Promise<ExtractResult>
  isArchive: (p: string) => boolean
  isComic: (p: string) => boolean
  ```
- Routes: `GET /api/comic?path=&pw=` -> the `ComicOpen` (pages are paths under `comicsDir`; the phone is granted that comic's page directory); `GET /api/archive?path=&pw=` -> `ArchiveListing`; `GET /api/archive/extract?path=&entry=&pw=` -> `ExtractResult` (the extracted temp path is granted to the phone).

- [ ] **Step 1: Tests**

```ts
  it('opens a comic and grants its pages', async () => {
    const a = await pair()
    const c = await (await fetch(url(`/api/comic?path=${encodeURIComponent(join(dir, 'b.cbz'))}`), { headers: { authorization: `Bearer ${a}` } })).json()
    expect(c.pages).toHaveLength(2)
    expect((await fetch(url(`/m/${encodeURIComponent(c.pages[0])}?t=${a}`))).status).toBe(200)
  })
  it('lists an archive and extracts one member for viewing', async () => {
    const a = await pair()
    const l = await (await fetch(url(`/api/archive?path=${encodeURIComponent(join(dir, 'z.zip'))}`), { headers: { authorization: `Bearer ${a}` } })).json()
    expect(l.ok).toBe(true)
    const x = await (await fetch(url(`/api/archive/extract?path=${encodeURIComponent(join(dir, 'z.zip'))}&entry=inner/pic.png`), { headers: { authorization: `Bearer ${a}` } })).json()
    expect(x.ok).toBe(true)
    expect((await fetch(url(`/m/${encodeURIComponent(x.path)}?t=${a}`))).status).toBe(200)
  })
  it('refuses a comic or archive outside the root', async () => {
    const a = await pair()
    expect((await fetch(url('/api/archive?path=C%3A%5CWindows%5Cx.zip'), { headers: { authorization: `Bearer ${a}` } })).status).toBe(403)
  })
```

Fake deps: `comicOpen` returns two page paths under a temp `comics/<id>` dir the fake creates; `archiveExtract` writes a temp file and returns it.

- [ ] **Step 2: Implement**

Routes `comic`, `archive`, `archive/extract`; `comic` grants `dirname(pages[0])` with `grantDir`; `archive/extract` grants the returned path. `index.ts` passes `openComic` bound to the 7-Zip exe and `comicsDir`, the `archive:list` / `archive:extract` bodies factored into closures `listArchiveWalled` / `extractMemberWalled` that the IPC handlers also call (the wall stays in the handlers; the phone route walls with `validRoot`).

- [ ] **Step 3: Tests, typecheck, lint, commit** (`feat(phone): comic and archive routes, read-only, with per-phone grants (#106)`)

---

### Task 3: The shim fills in, and the viewers learn `capabilities`

**Files:**
- Modify: `src/renderer/src/phone/prismShim.ts` (+ test), `src/renderer/src/lib/fileVerbs.tsx` (+ test if none), `src/renderer/src/lib/mdUrl.ts` (+ test), `src/renderer/src/components/CodeView.tsx`, `src/renderer/src/components/ImageView.tsx`, `src/renderer/src/components/VideoView.tsx`, `src/renderer/src/components/AudioView.tsx`, `src/renderer/src/components/ArchiveView.tsx`, `src/renderer/src/components/UnsupportedView.tsx`, `src/preload/index.ts` (a `capabilities` constant on the real bridge: all true)

**Interfaces:**
- `window.prism.capabilities: { write: boolean; clipboard: boolean; explorer: boolean; drag: boolean }` exists on BOTH bridges (preload: all true). Add it to `PrismApi` so the shim's type is honest.
- `fileVerbs(path)` returns `[]` when `!window.prism.capabilities.explorer` (Copy path is kept: the clipboard API is the browser's own).
- `CodeView` gains `readOnly?: boolean`: `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`, no Ctrl+S, no dirty star, the follow-the-file toggle hidden.
- `resolveMdUrl(url, baseDir, toUrl = (p) => `fsmedia://local/${encodeURIComponent(p)}`)`; `MarkdownView` passes `window.prism.mediaUrl`.
- Shim adds: `readText` (`/api/text`), `docHtml` (`/api/doc`, unwraps `html`), `comicOpen` (`/api/comic`), `archiveList` (`/api/archive`), `archiveExtract` (`/api/archive/extract`), `archiveStat` (answer `{}`-shaped default the panel tolerates; read `ArchiveView` for what it needs), `statFile` (`/api/stat`, add the route: `{ size, mtimeMs, isFolder }` from `fs.stat`), `tailBytes` (resolves null), `startTail` (false), `stopTail` (noop), `writeText` ABSENT.

- [ ] **Step 1: Tests first** for `fileVerbs` (with `window.prism.capabilities.explorer` false -> only Copy path), `resolveMdUrl` (the injected `toUrl` is used for a relative image), and the shim (`readText` hits `/api/text`, `docHtml` unwraps, `archiveExtract` passes `entry`).

- [ ] **Step 2: Implement**, then gate in each viewer: `ImageView`'s Copy image and `saveImageCopy` rows on `capabilities.clipboard`/`write`; `VideoView`'s Copy frame on `clipboard`; `ArchiveView`'s verb row (Extract all/here/to, Add files, Rename, Delete, Copy) on `write`/`clipboard`, keeping View and the folder navigation; the archive's drag-out on `drag` (it already checks `nativeDrag`); `UnsupportedView`'s hex button on `write === true` (a stand-in for "the desktop app"; name the check `capabilities.explorer` instead if that reads better, but pick ONE and comment why).

- [ ] **Step 3: Typecheck, lint, unit. Commit** (`feat(phone): viewers consult capabilities; the shim fills in text, docs, comics and archives (#106)`)

---

### Task 4: The phone shows every kind

**Files:**
- Modify: `src/renderer/src/phone/PhoneViewer.tsx`, `src/renderer/src/phone/Browser.tsx`

- [ ] **Step 1: Mount the viewers**

In `PhoneViewer`'s switch add, with the props `App.tsx:560-620` passes (read them): `pdf` -> `<PdfView url={url} path={file.path} onToggleFullscreen={toggleFullscreen} />`; `doc` -> `<DocView path name />`; `comic` -> `<ComicView path name onToggleFullscreen fullscreen />`; `archive` -> `<ArchiveView file={file} />`; `markdown`/`text`/`code` -> `MarkdownView` for `.md` (with `onOpenLocal={(p) => open the file if it is in the listing, else ignore}`) and `CodeView` with `readOnly onSaved={noop} onBuffer={noop} getPending={() => undefined}` otherwise. Lazy-load the heavy ones the way `App.tsx` does (`React.lazy` + `Suspense`; grep `lazy(` in App and copy the pattern), so a phone that only ever plays films never downloads pdf.js or CodeMirror.

- [ ] **Step 2: Touch pass, measured on the built bundle in the Electron phone window and on a real device when available**

At minimum: the PDF page keys and pinch (pdf.js's canvas pages under `touch-action: pan-y pinch-zoom`), comic page turns by tap on the left/right thirds of the picture (add `onTap` in `ComicView` only if swipe/tap does not already exist; read it first), the archive's rows at a 44px minimum height on `(pointer: coarse)`, CodeView's gutter and wrap on (the `prism.code.wrap` pref honoured; default wrap ON for the phone by writing the pref if unset).

- [ ] **Step 3: E2E `phoneDocs`**

Reuse `pairPhone` and `openPhoneWindow`; open the phone page on the fixtures root and assert: `README.md` renders formatted (an `h1` from the fixture's markdown), `code/greeter.py` shows a read-only editor (`.cm-content[contenteditable="false"]`), a `.pdf` fixture mounts `canvas`, the comic fixture shows an `img` and its page count, the zip fixture lists its members and View on a member shows a picture. Register after `phoneHls`.

- [ ] **Step 4: CLAUDE.md, gates, commit, push, PR against `feat/105-phone-transcode`, package, install 0.40.0**

The CLAUDE.md paragraph: the grant set is per PHONE and per ANSWER (a markdown's pictures, a comic's page directory, an extracted member), which is the wall's only softening on the phone; nothing writes; `capabilities` is how one viewer serves two hosts; `resolveMdUrl` no longer hard-codes the scheme.
