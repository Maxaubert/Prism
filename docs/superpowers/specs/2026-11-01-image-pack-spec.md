# Image pack (#78): spec and plan

2026-11-01. Prism at 0.127.0, main `9846b2d1`. One approval covers the spec and the plan.

**Approved** by the owner, 2026-11-01: "Approve as recommended" (every decision D1-D13 as recommended below). D12 is filed as issue #474, not built. What was built, and where it differs, is recorded in `docs/features.md` ("The I key's photo info card").

## The short version

Two of the three items are already built. One is not.

| Item | What exists | What is missing |
|---|---|---|
| 1. Checkerboard behind alpha | Built (2026-09-03). `.p-checker` in `src/renderer/src/index.css` sits on the picture's own layer in `ImageView.tsx`. It shows in the viewer and in the Explorer's preview pane. It is off in fullscreen by the owner's 2026-08-28 rule (a fullscreen stage is black). | Nothing needed. Two small loose ends, both the owner's call (D1, D2). |
| 2. I key photo info | The data is built: `src/main/photoInfo.ts` (exifr, main-only, HEIC through `heifExif.ts`) gives camera, lens, exposure (shutter, aperture, ISO, focal length), date taken, colour space, GPS and dimensions. The Properties window shows it (`properties/PhotoBody.tsx`), but only from an Explorer row (menu or Alt+Enter). | No I key. No way to see it from the viewer itself: the picture's menu has no Properties row. Colour space only ever says "sRGB", so an iPhone photo (Display P3) shows no colour row. |
| 3. Save a copy as PNG/JPEG | Built. The picture's right-click menu has Save a copy > PNG / JPEG (`menus/viewers/image.tsx`). The renderer encodes from the decoded picture (`lib/copyImage.ts` `encodeCopy`, so HEIC and RAW work, JPEG gets a white ground), main shows a parented save dialog and writes (`src/main/ipc/files.ts` `registerSaveCopyIpc`). | A failed write says nothing. The dialog opens in whatever folder was used last, not the photo's folder. The note says "Saved a copy" with no name. No e2e scenario covers it and `docs/features.md` has no entry for it. |

So the pack is: build the I key info card, tidy Save a copy, and record both.

## 1. Checkerboard: nothing to build

From the user's side it already works: open a transparent PNG and the empty parts show a quiet checker, pale in light themes, dark in dark themes. Fullscreen shows black on purpose.

Only loose ends:

- **D1. The dark checker is very faint** (`#202329` on `#191c21`). It reads as "there is a ground", but barely. Recommendation: leave it. It was chosen to stay out of the picture's way, and the owner has not complained since September.
- **D2. Grid thumbnails** are 320px JPEGs from ffmpeg (`src/main/thumbs.ts`). JPEG has no alpha, so a transparent PNG's tile probably shows whatever colour sits under the transparency (often black). Not verified. Recommendation: not part of this pack. Check it once; if the tiles are black, open its own small issue.

## 2. The I key photo info card

### What the user sees

- Viewing a photo, press **I**. A small card appears in the top-right corner of the stage. Press I again and it goes.
- It shows, in this order, each row only when the file has it:
  - the pixels, megapixels and file size on one line ("4032 × 3024 · 12.2 MP · 2.4 MB")
  - Camera ("iPhone 15 Pro")
  - Lens
  - Exposure ("1/250s  f/1.8  ISO 64  24mm")
  - Taken (date and time)
  - Colour ("sRGB", "Display P3")
  - Location as coordinates, text only, no map and nothing goes online (owner, 2026-10-12)
- A photo with no camera data shows the pixels line and "No camera details in this file".
- The card stays on while you arrow through the folder and updates for each picture. A slow read never blocks the picture: the card fills in when the answer arrives.
- It does not fade with the auto-hiding control bar. You turned it on to read it.
- The picture's right-click menu gains a **Photo info** row with a tick while it is on, so the key can be found.
- It does not edit anything. It only reads.

### Where it does nothing

- Archive members and comic pages: they have no file path of their own (`ViewerSwitch` passes none for members; `ComicView` passes none), so `photoInfo` cannot read them. I does nothing there and the menu row is absent.
- While typing (the same `isTypingTarget` guard as R and F).
- The phone page: out of scope for now.

### How it is built

- **One shaping of the facts for both places.** Pull the row building out of `PhotoBody.tsx` into a pure `lib/photoFacts.ts` (`photoFacts(info, px, size)` returns labelled rows). PhotoBody and the card both use it, so the Properties window and the card can never disagree.
- **The card**: `components/image/PhotoInfoCard.tsx`. Calls `window.prism.photoInfo(path)` (already in preload) keyed by path, ignores a stale answer after you arrow on. Uses the theme's raised panel, line and dim text tokens, no new colours.
- **The toggle**: state in `ImageView.tsx`, `case 'i': case 'I'` in the existing key switch. Remembered across launches in a small `lib/photoInfoPref.ts` (same pattern as `lib/slideshow` seconds), try/catch around storage.
- **The menu row**: `menus/viewers/image.tsx` gets `photoInfo: boolean` and `togglePhotoInfo` in `ImageMenuContext`, shown only when `path` is set. Placed after Rotate.
- **Colour space**: `photoInfo.ts` turns on exifr's `icc: true` and uses the ICC `ProfileDescription` when there is one, falling back to the current EXIF sRGB check. For HEIC, `heifExif.ts` also hands over the `colr` box's ICC profile when it is a `prof` type. `PhotoInfo` in `src/shared/ipcTypes.ts` is unchanged (it already has `colour`).

### Owner decisions for the card

- **D3. A card on the stage, or I opens the Properties window?** Recommendation: the card. Properties is a modal you close before you can arrow on; photo info is something you leave on while paging.
- **D4. Where it sits.** Recommendation: top right, clear of the control bar at the bottom and the zoom readout.
- **D5. Remembered across launches?** Recommendation: yes. Someone who wants camera details wants them on every photo.
- **D6. Shown in fullscreen?** Recommendation: yes when it is on. The fullscreen rule keeps the app's look out of the picture; this is something the user asked for with a key. (Alternative: it hides in fullscreen like the checker.)
- **D7. A Photo info row in the picture's menu?** Recommendation: yes, with a tick, no shortcut hint (the 2026-08-31 menu rule). Without it the I key is undiscoverable.
- **D8. Read the ICC profile name for colour space?** Recommendation: yes. Today every iPhone photo shows no colour row at all. Cost: one more small segment read near the start of the file.
- **D9. A copy button for the coordinates?** Recommendation: no. Keep the card quiet; Properties already has a copy pattern if it is ever wanted.

## 3. Save a copy: tidy what exists

### What the user sees after this

- Right-click the picture, Save a copy > PNG or JPEG, as today.
- The save dialog opens **in the photo's own folder** with the name already filled in ("IMG_0412.jpg").
- After saving, the note says **"Saved IMG_0412.jpg"**.
- If the write fails (folder read-only, disk full), the note says **"Could not save the copy"** instead of nothing.
- Cancel still says nothing.
- It converts, it never edits: the original is never touched, and a copy cannot be saved over the file being viewed (main refuses that path and says so).

### How it is built

- `src/main/ipc/files.ts` `registerSaveCopyIpc`: take the source path (optional), start the dialog at `join(dirname(source), base + ext)` when there is one, refuse a target equal to the source, and return `{ saved: path } | { canceled: true } | { failed: true }` instead of `string | null`.
- `src/main/dialogs.ts`: an E2E-only answer, `PRISM_E2E_SAVE_TO`, in the same shape as `PRISM_E2E_PICK_FILES`, so the e2e never shows a native dialog.
- `src/preload/index.ts` and `src/renderer/src/phone/prismShim.ts`: the new return type.
- `ImageView.tsx` `saveCopy`: pass `path`, show the three notes.

### Owner decisions for Save a copy

- **D10. Keep the photo's EXIF in the copy?** Today the copy carries no metadata: no GPS, no date taken. Recommendation: keep it that way and say so in `docs/features.md`. For the "upload 400 HEICs to a site" case, dropping GPS is a privacy win, and keeping EXIF would need a new EXIF-writing dependency.
- **D11. A keyboard shortcut (Ctrl+Shift+S)?** Recommendation: no. It is a menu verb, like Copy path.
- **D12. Batch: "Save copies as JPEG" on many files in the Explorer.** This is the real fix for "400 iPhone HEICs", and one dialog per photo is its own dead end. It is a new Explorer verb with progress and a target folder, bigger than this pack. Recommendation: not now; open it as its own issue and decide there.
- **D13. JPEG quality.** Fixed at 0.92. Recommendation: keep, no setting.

## Files to change

- `src/main/photoInfo.ts`, `src/main/heifExif.ts`: ICC profile name (D8).
- `src/renderer/src/lib/photoFacts.ts` (new), `src/renderer/src/components/properties/PhotoBody.tsx` (uses it).
- `src/renderer/src/components/image/PhotoInfoCard.tsx` (new).
- `src/renderer/src/lib/photoInfoPref.ts` (new).
- `src/renderer/src/components/ImageView.tsx`: I key, card, menu context, saveCopy notes.
- `src/renderer/src/menus/viewers/image.tsx` and its test: Photo info row.
- `src/main/ipc/files.ts`, `src/main/dialogs.ts`, `src/preload/index.ts`, `src/renderer/src/phone/prismShim.ts`: Save a copy result and folder.
- `docs/features.md`: one entry for the I card, one for Save a copy (neither has one), and a line under the 2026-08-31 picture-menu rule that Photo info joined it. `docs/menus.md`: the new row.
- No new dependency (exifr already does ICC). No new file type. No dialog file (the notes are the existing copy-note pill, not a dialog).

## Tests

Unit (vitest):

- `lib/photoFacts.test.ts`: row order, missing fields dropped, "No camera details" case, coordinates to 5 places.
- `photoInfo.test.ts` (extend): ICC description wins over EXIF ColorSpace; 65535 with no ICC still gives no row.
- `heifExif.test.ts` (extend): a `colr`/`prof` box is found; an `nclx` box is ignored.
- `menus/viewers/image.test.ts` (extend): Photo info present with a path, absent without, ticked when on.
- `lib/photoInfoPref.test.ts`: stored, read back, storage throwing falls back to off.
- Save copy handler test (new, beside the other main IPC tests): default path in the source folder, source path refused, the three results.

E2E (`tools/e2e/run.mjs`, headless, on the hidden desktop):

- `photoInfoKey`: open a fixture JPEG with EXIF; I shows the card with Camera and Exposure; arrow to a PNG with none, the card says "No camera details in this file"; I hides it; the menu row toggles it; an archive member offers no row. Screenshot `photo-info.png` to look at.
- `imageSaveCopy`: with `PRISM_E2E_SAVE_TO`, save a transparent PNG fixture as JPEG and as PNG; the files exist, the JPEG's corner pixel is white, the note names the file; a read-only target gives "Could not save the copy".
- Both added to the full suite. Not to `e2e:ui` (they need fixtures and the viewer).

Then the usual gate: typecheck, lint, unit, the full e2e before the PR, install last.

## Risks

- **The I key in the preview pane.** ImageView's keys listen on the window, so I would also fire while the Explorer list has focus with a photo previewed. Today R and F do the same. Check it in the e2e; if it misfires, gate the key on the full view or stage focus.
- **ICC read cost.** A JPEG's ICC segment is small and near the start, but a PNG's `iCCP` chunk or a big TIFF could cost a longer read. Measure on the fixture set; drop D8 for any format where it costs more than a few chunks.
- **HEIC colour.** Many iPhone HEICs carry `nclx` instead of an ICC `prof`, which would still give no colour row. Acceptable: no row is better than a wrong one.
- **Huge pictures.** Save a copy already refuses past the canvas limit with a note; unchanged.
- **Animated GIF and WebP** save their first frame only. Unchanged; noted in `docs/features.md`.
- **Scope.** The card only reads and Save a copy only converts. No crop, no resize, no metadata editing.
