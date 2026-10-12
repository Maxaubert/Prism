# The Properties window, per kind

Owner, 2026-10-12: "build the properties pop up window a bit nicer looking ... for the drives we
could show a circle diagram that displays how the drive is divided". Picked through three rounds of
mockups (`Documents\Claude\research\prism\mockups\2026-10-12-properties\`: `index.html` round 1,
`round2/` the drive, `audio/` the default art, `final/` the picks together). Then: "plan then build".

## What each kind shows

One dialog frame for all (Prism's `dialogLook`: 420px box, flat `--p-side-flat`, `--p-radius`).
A header (icon or picture, name, one dim line), facts as label/value rows, optionally under small
group headings, and a footer. **Close is the only button**, except on a drive.

### Drive (round 2, layout 1)

- Header: drive glyph, "Local Disk (C:)", and under it the **drive's own model with underscores
  read as spaces** ("WD BLACK SN850X 8000GB"), the connection ("NVMe SSD") and the file system.
- **A donut** (150px, 20px ring) of the drive's **top-level folders**, sized from the search index,
  with free space as the empty track; the centre says used of total ("3.56 TB of 7.28 TB").
- **The legend beside it lists every top-level folder** (colour dot, name, size, share) **and
  scrolls**, as tall as the donut. No Free row (the centre says it). Its scrollbar is Prism's overlay
  bar, shown **only while it scrolls**.
- **Hovering a slice shows a tooltip** off the pointer's bottom right: the slice's colour dot, the
  folder, its size and share; the matching legend row lights and scrolls into view. A slice or a
  legend row is a click that opens that folder in the Explorer.
- Facts: Drive (model), Connection (bus and media, "NVMe SSD, internal" / "USB"), File system,
  Capacity.
- Footer: **Disk Cleanup** (left; launches Windows' own `cleanmgr.exe /d C`), Open, Close.
- Colours: the seven biggest folders take `--p-accent`, the kind colours and the archive colour in
  order; the rest are `--p-kind-text`. A slice under 0.15% of the drive is not drawn (it stays in
  the legend). No index answer: the donut is used against free only, and the legend says
  "Folder sizes need the search index".

### Folder (round 1, A without the newest file)

- Header: folder glyph in the folder colour, name, the full path, a copy-path button.
- Facts: Size, Contents (and Coverage, as today), **Created, Modified, Opened** (last access).
- Close only. No newest file, no Open, no Open as project.

### Photo (round 1, A without Show on map)

- **The picture across the top** (178px tall, cover-fit), then the name and a line
  "1448 × 1086 · 1.6 MP · 2.3 MB".
- Group **Camera**: Camera, Lens, Exposure, Taken. Group **Place**: Location (coordinates as
  text), Colour. A group with no facts is left out. **No map button.**

### Video (round 1, A)

- **A frame of the film across the top** with its length in a badge, then the name and size.
- Facts: Resolution ("3840 × 2160 (4K)"), Frame rate, Video (codec, profile, bit depth, HDR),
  Bitrate. Group **Audio tracks**: number, language or title, codec and channels. Group
  **Subtitles**: the embedded ones by language, "None" when there are none.

### Audio (round 1, A; the default art from `audio/`, D)

- **The file's own cover art** (104px square) beside the title (big), the artist and
  "7:37 · 47.5 MB". **A song with no cover gets sound bars** in the audio colour on a dark tile,
  same size.
- Facts: Artist, Album (year), Track ("17 of 17"), Genre, Format ("FLAC, 16-bit, 44.1 kHz,
  stereo"), Bitrate.

### Code and text (round 1, A; for every text file)

- Facts: **Language** (with its dot), **Encoding** ("UTF-8, no BOM", "UTF-16 LE", "Windows-1252"),
  **Line endings** ("LF (Unix)", "CRLF (Windows)", "Mixed"), Lines, Words, Characters, Size,
  Modified.

### Checksum (round 1, A; on every file)

- A **SHA-256** row with a Compute button. Computing streams the file in main: the row becomes a
  thin bar with a percentage and Stop; done, it shows the hash shortened in the middle with a copy
  button that turns into a tick once copied.

### Everything else

Archives, PDFs, documents and other files keep today's rows in the new frame, plus Checksum.

## Where the facts come from

| Fact | Source |
|---|---|
| Drive model, bus, media, file system | `Get-Disk` / `Get-PhysicalDisk` / `Get-Volume`, spawned from a worker thread like `driveUsage.readLabels` (#351), cached 10 min |
| Top-level folder sizes | `listDir` of the drive root, then `getIndexedFolderSizes` (Everything) |
| Created, Opened | `file:stat` gains `birthtimeMs` and `atimeMs` |
| Photo facts | `photoInfo` (exifr), plus megapixels from the dimensions |
| Video and audio facts, tags | a new `props:media` probe: ffprobe `-show_format -show_streams`, read by a pure parser |
| Video frame, cover art | a new `props:picture`: ffmpeg writes one JPEG (a frame at 10% in, or the attached picture) to stdout, answered as a `data:` URL, so nothing new crosses the root wall |
| Encoding, BOM, line endings | a new `props:text`: the first 64 KB's bytes, read by a pure detector |
| Language | `codeLang.langFor` |
| SHA-256 | a new `file:hash` streamed in main, progress as events, cancellable |
| Disk Cleanup | a new `drive:cleanup` that spawns `cleanmgr.exe /d <letter>` |

Every new main handler keeps the wall: `insideDesktop(p)` or an extracted member, as `file:stat`.

## Not in this

The newest file of a folder, Show on map, Open as project in Properties, a map, editing tags, any
cleaner of Prism's own.

## Tests

Pure parts in unit tests: donut slices and colours, the model name, the media parser (video
streams, tracks, subtitles, music tags), the text detector, the hash stream. One e2e scenario,
`propertiesWindow`, opens Properties on a text file, a folder, a picture, a video and a song
(fixtures made with the bundled ffmpeg) and a drive from the places panel, and checks the header,
the rows, the single Close, the checksum against Node's own SHA-256, the drive's donut, scrolling
legend and slice tooltip.
