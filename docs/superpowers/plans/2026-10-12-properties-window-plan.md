# Properties window: implementation plan

Spec: `docs/superpowers/specs/2026-10-12-properties-window-design.md`. Branch
`feat/properties-window`, version 0.106.0. One PR.

## 1. Main: the new facts (pure parsers first, each with a unit test)

1. `src/main/propsMedia.ts`: `readMediaProps(json)` turns ffprobe's `-show_format -show_streams`
   JSON into `{ duration, bitrate, size, video?: { width, height, fps, codec, profile, bitDepth,
   hdr }, audio: [{ language, title, codec, channels, sampleRate, bitDepth }], subtitles:
   [{ language, title }], tags: { title, artist, album, year, track, trackTotal, genre }, cover:
   boolean }`. Test with recorded JSON (a 4K H.264 mp4, a FLAC with tags and attached_pic, an mkv
   with tracks and subtitles).
2. `src/main/textProps.ts`: `detectText(bytes)` gives `{ encoding, bom, eol }` (UTF-8/16 BOMs,
   valid UTF-8, else Windows-1252; LF, CRLF, CR, Mixed). Test.
3. `src/main/driveModel.ts`: a PowerShell command run from a worker thread (the
   `driveUsage.readLabels` pattern), parsed by a pure `parseDriveModels(output)` into
   `{ model, bus, media, fs }` per letter, cached 10 minutes. `prettyModel` replaces `_` with
   spaces. Test the parser and `prettyModel`.
4. `src/main/fileHash.ts`: `hashFile(path, onProgress, signal)` streams SHA-256. Test against
   Node's `createHash` on a temp file, and cancellation.
5. Wire in `index.ts` (all walled like `file:stat`): `props:media`, `props:picture` (ffmpeg, one
   JPEG to stdout, 380px wide, a frame at 10% or the attached picture, as a data URL),
   `props:text`, `drive:details` (model plus `getIndexedFolderSizes` of the root's folders),
   `drive:cleanup`, `file:hash` + `file:hash-cancel` + `file:hash-progress` events. `file:stat`
   gains `birthtimeMs` and `atimeMs`. Preload and `shared/types` get the matching API.

## 2. Renderer: the frame and the kinds

1. `components/properties/`: `PropertiesDialog.tsx` becomes the frame (header, groups, footer),
   choosing a body by kind: `DriveBody`, `FolderBody`, `PhotoBody`, `VideoBody`, `AudioBody`,
   `TextBody`, `OtherBody`. Shared `Facts` (label/value rows, optional group heading, empty groups
   dropped) and `ChecksumRow`.
2. `lib/donut.ts` (pure): slices from sizes (colours, the 0.15% floor, offsets), tested.
   `DriveDonut.tsx`: the SVG, the hover tooltip (bottom right of the pointer, colour dot), the
   legend in a scroll box with the existing `OverlayScrollbar` (scroll-only after the scrollbar
   PR; this branch keeps whatever main has), hover linking slice and row, click opening the folder
   through an `onOpenFolder` prop.
3. `lib/fileProps.ts` keeps the per-kind fact gathering; it gains the new sources and returns
   grouped rows. The audio default tile is the sound-bars glyph.
4. Callers: `App.tsx` (Explorer and places, with `onOpenFolder` navigating the Explorer and the
   drive's Open) and `Sidebar.tsx` (project tree; no drives there).

## 3. Proof

1. Unit tests above, plus a `PropertiesDialog` render test per kind where it is cheap.
2. e2e `propertiesWindow` in `tools/e2e/run.mjs` (headless, reaps its processes): fixtures made
   with the bundled ffmpeg (a short mp4, a FLAC with a cover and one without), a UTF-8 CRLF text
   file, a folder, a PNG; the C: drive from the places panel. Checks per the spec's Tests section.
3. `docs/features.md` entry; `docs/menus.md` unchanged (the menus already open Properties).
4. typecheck, lint, unit tests, the whole e2e, then package, install 0.106.0, PR, merge.
