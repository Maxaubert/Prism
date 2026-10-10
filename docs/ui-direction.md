# UI direction

The look and its rules (themes, colour picker, panels, toolbar), moved verbatim from `CLAUDE.md` on
2026-10-09. Read it before touching anything visual.

## UI direction

Dark, quiet viewer chrome so the media is the star: near-black frameless window, a single
indigo accent (`#5b5bd6`), minimal controls that fade when not needed. The Prism monogram +
indigo tie it to the Filesmith family without copying its light utility look. Don't add a
light theme or editing tools without an explicit decision. The file-tree sidebar (2026-07-31)
was such a decision: a navigation panel bounded by the folder Prism opened in, not a library.

**18 THEMES ON ONE WALL, NO COLOUR MODE** (#298; owner, 2026-10-06, of 42 mocked: "perfect, go
ahead and build"; spec `docs/superpowers/specs/2026-10-06-new-themes-design.md`, research and the
approved mockup in `Documents/Claude/research/prism/2026-10-06-new-themes/`). The ten old styles
are gone (Aurora, Void and Frost kept, refined). The rules (`lib/theme.ts`, `lib/themes/`):
- **The 18, in wall order**: dark Aurora, Void (`new-void`), Carbon, Crimson, Jade, Volt,
  Midnight HC, Glacier, Lagoon; light Frost, Paper, Sand, Sage, Blush, Chalk, Daylight HC, Orchid,
  Pearl. High contrast before see-through in each half. Colours exactly as `themes/catalogue.json`
  (`catalogue.test.ts`); HC themes are MONOCHROME. Every theme sets in the SYSTEM face at 12.5px
  (owner, 2026-09-20: "update all themes to use the system font by default"). Aurora is solid.
- **ONE picker, no light/dark switch**: each theme is dark or light by itself. `prism.mode` is no
  setting now; `paint` writes it as the boot screen's mirror and nothing else reads it.
- **A theme carries a TABLE of its designed values** (raised, line, dim, faint, accent fill and
  ink, kinds, code colours, HC's edge) and its panel as its own colour (`sideOwn`). `pruneTable`
  drops what an edit makes stale (ground or text: the inks, kinds and code; accent: the fill and
  ink; Edges: HC's edge). A style WITHOUT a table (every own copy saved before) derives byte for
  byte as before: `themes/legacy.snapshot.json`, taken on main, held by `table.test.ts`.
  `contrast.test.ts` holds every floor on what is PAINTED. A designed selection is measured on the
  ground only (Chalk's dim reads 3.08:1 on its tint over the panel, where only names sit).
- **Code colours are theme tokens** (`--p-code-*`, `codeTokens`), with `--p-code-tag` and
  `--p-code-attr`; an own copy keeps the legacy per-mode set. Menus paint `--p-raised`.
- **The wall** (`settings/ThemeWall.tsx`, `ThemeCard.tsx`, `hooks/useWallMotion.ts`,
  `lib/themes/wall.ts`): card style B (name on a band; the band and frame one dark grey for every
  theme, `themes/cardBox.ts`, owner: "give all the same coloured box"; chosen = accent ring and a check, blurb as
  tooltip, no "Suggested"), collapsed to the current theme's row with an animated Show all / Show
  fewer (270ms open, 220ms close, reduced motion instant, nothing left inline at rest). ONE tab
  stop; arrows PREVIEW (`previewStyle`: paint only, nothing stored, the draft hidden and kept, the
  window material sent once the arrows rest); Enter, Space, a click or the focus leaving KEEP;
  Escape goes back. `useStyle` is the KEPT theme: re-rendering its readers on every arrow put a
  held Right over 50ms (MEASURED). This theme: See-through window (not on HC) and Save changes.
- **Retired ids migrate once** (`themes/migrate.ts`, marker `prism.style.v`): Onyx to Void WITH
  its glass as an unsaved edit (level 55), Terminal to Jade (Obsidian until #316), Driftwood to
  Carbon, Ruby to Crimson (Ember until #316), Linen to Sand; own copies kept, their `base` mapped;
  one quiet line names the retired theme until the next pick. Every map target is a current theme
  (`migrate.test.ts`), so a later pass never chains.
- **JADE AND CRIMSON TOOK EMBER'S AND OBSIDIAN'S PLACES** (#316; owner, 2026-10-07, with Volt's
  Colours edited to teal: "this theme should replace Ember. its Volt but with this teal instead of
  the yellow"; then, with them edited to red `#ff2647`: "have this replace obsidian"). Each is Volt
  with one colour for every yellow-green value (accent, selection at Volt's alpha `38`, folder,
  archive, the accent-mixed keyword), built by the research `build-themes.mjs`: Jade `#26ffb2`,
  Crimson `#ff2647` (near-black ink, 5.26:1; its warn orange and error reds held apart in
  `contrast.test.ts`). Marker `4`: `ember` and `obsidian` map to `jade` (`RETIRED_NAMES` names
  them on the quiet line), so a window on `2` moves too; a profile the first pass PLACED on Ember
  for Ruby and that never picked since (its line still says Ruby: `PLACED_MOVES`) goes on to
  Crimson. Onboarding is three steps, the first the same wall.
- Not adopted from the mockup, by recorded rules: the active tab stays told by its ink, not a
  ground fill; the Accent subtext stays (the chosen rail page is grey since #292).
- **A ZIP FOLLOWS THE FOLDER COLOUR**, not a hardcoded indigo (owner, 2026-09-20). `--p-tree-zip`
  IS `--p-tree-folder` and `--p-tree-zip-ink` is the better of white or near-black on it. In the
  app only, and in the MONOCHROME scheme only.

**ONE COLOUR PICKER, ALPHA ON EVERY COLOUR** (#249 rework, owner 2026-10-03: "the colour pickers
should be the same for both apps, i need an input field for a color code and an alpha per colour
on every colour setting"; alpha "should not be a separate opacity setting"). Every Style colour is
prism-term-core's `ColourField` (`renderer/settings/ColourPicker`); there is no local well, no
native `<input type=color>`, no Acrylic or Accent opacity slider. Spec and plan: PrismTerminal
`docs/superpowers/specs/2026-10-03-colour-picker-alpha-design.md` / `-plan.md`. The rules
(`lib/theme.ts`, `theme.alpha.test.ts`, e2e `styleColours` and `accentOpacity`):
- **Primary's alpha IS the old Acrylic level.** Stored as the draft's `acrylic` / a preset's
  `glass`, SHOWN as the alpha it paints (`primaryValue`, about 53% to 95%, 100 is solid). A level is
  written only when the alpha moves (`setPrimary`), so a hue edit never touches the glass, and no
  saved style is converted. A mica style stays mica.
- **Secondary's alpha follows Primary's until moved**: six digits follow, eight are its own (`ff`
  kept: a solid panel on glass).
- **The accent's alpha is stored beside it** (`accentAlpha`, 1/255 steps), never inside a hex: a
  scheme accent keeps its palette for the visualizer. Fills carry it, lines read `--p-accent-solid`.
- **Under glass, text-bearing fills are flattened** (`--p-accent`, `--p-sel-bg` opaque over the flat
  ground) so their label keeps 4.5:1. Not the marked-file tint (`--p-sel-tint`, #257): see there. Text and Folder icons with an alpha are drawn as the core's
  `legibleOn` composite. Tokens are hex or hex8, never `rgba()` for an accent fill.
- Settings' Escape yields to an open `[data-colour-popover]` (it undoes the picker's writes).
- **ONE COAT OF GROUND PER PIXEL** (#294; owner, 2026-10-06: "the top bar and settings sidebar
  don't follow the acrylic ... it should be everywhere", "the preview also isn't acrylic"). A box
  sitting on a box that already paints `--p-bg` / `--p-side` / `--p-tabs` paints NOTHING: two
  see-through coats of Onyx (0.80 each) are 0.96, an opaque slab. Fixed: the active tab, the strip
  inside the one-row bar, the Explorer's address bar row, the preview pane over the folder
  browser, a document's canvas (`.p-doc`), and the core Settings frame (index.css: the frame clear, the rail and pane one coat
  each). The `seeThrough` e2e composites every box under sampled points of each surface.
- **THE EXPLORER'S PLACES PANEL WEARS THE SIDEBAR COLOUR; THE COLOURS ARE HEADED "Colours"** (#302;
  owner, 2026-10-06: "from your mockups i think the sidebar in explorer was supposed to be distinctly
  colored from the main bg right ... in settings the sidebar is distinctly colored correctly", and of
  "Colours of Volt": "dont have this show the theme name, just call that section colours"). The folder
  browser paints no ground; its address row, list, preview slot and status paint `--p-bg`, the places
  panel (and `.browse-viewer-places`) `--p-side`, the Settings rail's and project tree's colour, one
  coat each. Every catalogue theme's panel differs from its ground EXCEPT VOID, which is all black
  (#313; owner, 2026-10-07, of Background #000000 and Sidebar and tab bar colour #070707: "make void
  fully black for both of these"): its panel is #000000, its panels told apart by its faint edges. A
  saved draft colour the theme has since caught up with is dropped at load (`withoutOwn`), so a
  hand-set black on Void shows no Reset and no lit Save changes. The `sidebarGround` e2e holds both.
  **THE ADDRESS ROW WEARS IT TOO** (#306; owner, 2026-10-07, of a mockup with the row in the panel
  colour: "yes make this the same color as the sidebar"): back/forward/up/refresh, the address field,
  preview and search, across the window (`.folder-browser > .browse-toolbar`, and
  `.browse-viewer-toolbar` over an opened file), `--p-side`, its hairline kept, so only the list,
  preview slot and status are `--p-bg`. The address field's fill and edge step off the ROW
  (`--p-side-flat`), not the page: off the page they sat at 1.01:1 on the row on every dark style
  (MEASURED). Near-black is still judged by the page (`nearBlackField(bg, text, row)`).
- **THE TOOLBAR'S BUTTONS ARE NEVER COLOURED; EVERY TAB WEARS AN ICON BY WHAT IT HOLDS** (#308;
  owner, 2026-10-06: "i dont like the look of the buttons being colored ... search is more minor ...
  the preview panel is almost always opened ... an icon that changes based on whether the panel is
  opened or hidden ... default icons per type of page explorer, project and settings"; 2026-10-07, of
  `research/prism/2026-10-06-new-themes/toolbar-options.html`: "A3 and C2"). The preview toggle
  (`PreviewGlyph`) and the search button wear Back's grey and no fill in every state; the preview's
  right column is SOLID while open, empty while hidden; `data-active` on search is a mark, not a
  look. Every tab carries `TabKindIcon` (Explorer a folder, project code brackets, Settings a gear)
  in the tab's own ink, SOLID on the tab you are on and lines on the rest; it replaced the
  folder-coloured glyph only Explorer tabs had. The `toolbarIcons` e2e holds both.
