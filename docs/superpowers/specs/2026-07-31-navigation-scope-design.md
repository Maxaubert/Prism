# Navigation scope — design

**Date:** 2026-07-31
**Issue:** [#1](https://github.com/Maxaubert/Prism/issues/1)

## Problem

Opening a file lists every viewable sibling in the folder, so arrowing through a
photo folder that also holds a PDF and a few `.txt` notes drops you into a text
dump between two images. The two things people actually do — flick through
pictures and clips, or page through documents — get mixed into one list.

## Solution

One setting, **Navigation scope**, with three modes. It decides which siblings
join the navigation list, based on the kind of file you opened.

| Mode | Opening `photo.jpg` lists | Opening `report.pdf` lists |
| --- | --- | --- |
| **All in one** | every viewable file | every viewable file |
| **Group** *(default)* | images + video + audio | PDF + text |
| **Per file type** | images only | PDFs only |

**Groups:** `Media` = image, video, audio. `Documents` = pdf, text.
**Per file type** uses the existing `FileKind` verbatim, so `.heic` and `.jpg` are
both "image", `.md` and `.json` are both "text".

Two rules keep the setting from surprising anyone:

1. **The opened file is always in the list.** Whatever the scope says, the file
   you actually double-clicked is never filtered away.
2. **Changing the scope keeps the current file selected.** The list re-derives
   around the file on screen; the position indicator updates, the viewer does not
   reload.

Files of kind `other` stay excluded everywhere, exactly as today.

## Architecture

The filter lives in the **renderer**, not the main process.

`buildPayload` in `src/main/index.ts` keeps sending the full viewable sibling
list. That leaves the IPC shape, the `OpenPayload` type, and the future
`prism-core` seam untouched, and it avoids inventing a main-process settings
store: every Prism setting today lives in renderer `localStorage`, and this one
joins them. The cost is a slightly larger payload (path + name + ext + kind +
size per file), which is noise next to the `readdirSync` + `statSync` walk that
produced it.

### New: `src/renderer/src/lib/navScope.ts`

One file, one responsibility: what does the navigation list contain.

- `NavScope` — `'all' | 'group' | 'type'`.
- `NAV_SCOPES` — the three modes with display name and description, so Settings
  renders from data rather than a hand-written switch.
- `scopeFiles(files, index, scope)` — pure. Returns `{ files, index }`: the
  filtered list and the position of the same file within it. No React, no
  storage, trivially testable.
- A persisted store mirroring `vizStore`'s shape (`useSyncExternalStore` +
  `localStorage` key `prism.nav.scope`), so Settings and `App` read one source of
  truth and a change repaints immediately.

### Changed: `src/renderer/src/App.tsx`

`App` holds the **raw** payload plus the raw index of the current file. The
visible list is derived:

```ts
const view = useMemo(
  () => (raw ? scopeFiles(raw.files, rawIndex, scope) : null),
  [raw, rawIndex, scope]
)
```

`go(delta)` steps within `view.files`, then maps the target file back to its raw
index. Everything downstream — the `n / total` indicator, the hover arrows,
neighbour preloading — reads `view` and is otherwise unchanged. Because the raw
index anchors on a file rather than a position, flipping the scope re-derives the
list around the file already on screen for free.

### Changed: `src/renderer/src/components/Settings.tsx`

A **General** tab in the existing rail, above Progress bar, holding a "Folder
navigation" section and using the same `Section` / `Tile` / `TileFooter` shell as
the other pickers: three tiles, each a small schematic of what the list holds
under that mode, with a one-line description. General is where later app-wide
behaviour settings land; scope is simply its first entry.

## Testing

`vitest.config.ts` (new — the repo has none, so `@shared` would not resolve in
tests) wires the `@shared` / `@renderer` aliases and points at `src`.

`navScope.test.ts` covers `scopeFiles`:

- `all` returns the list untouched.
- `group` from an image keeps image/video/audio, drops pdf/text; from a PDF, the
  reverse.
- `type` from an image keeps only images.
- The returned index still points at the originally opened file in every mode.
- The opened file survives a scope that would otherwise exclude it.
- Empty list, single file, and an out-of-range index are handled without throwing.

## Out of scope

Per-kind tick boxes, per-folder overrides, sort order, and recursion into
subfolders. Three modes cover the request; more knobs can follow if a real folder
proves them necessary.
