# New themes: 18 themes on one theme wall, no Colour mode (#298)

Spec and implementation plan together, for one approval.

## Owner decisions (2026-10-06)

- Not happy with the current themes "except maybe Void, Frost and Aurora"; asked for many new ones,
  dark and light, mocked up first. Acrylic themes must be see-through everywhere (title bar, tabs,
  settings rail, sidebar, preview pane).
- Of the 42 mocked, picked 15, plus the three suggested extras Sage, Blush and Pearl: 18 themes.
- High contrast themes are MONOCHROME (accent, ring, selection, folder and file kinds in greys with
  white or black).
- ONE picker, no light/dark switch: one theme wall, like Prism Terminal's. Each theme is dark or
  light by itself.
- Card style B: the mini Explorer preview with the name on a band inside it; chosen is the accent
  ring and a check in the band; the theme's description is the tooltip. "Suggested" is not shown in
  the app: all 18 are simply themes.
- Header row "Themes", subtext "Choose your look."
- The wall is collapsed to the row that holds the current theme, with an animated "Show all 18
  themes" / "Show fewer".
- HC before see-through, in each half.
- Approved: "perfect, go ahead and build".

Source of truth: `C:\Users\Admin\Documents\Claude\research\prism\2026-10-06-new-themes\` (approved
mockup `index.html`, data `themes.json`, checks `check-themes.mjs`, rationale `themes.md`, screenshots
`shots\b-*.png`). Colours are exactly those of `themes.json`.

## The set, in wall order

| # | Theme | Mode | Material | Ground | Panel | Text | Accent (line) | Folder | Corners | Edges |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Aurora | dark | solid | #0b0d12 | #121419 | #f2f4f8 | #4682fb | #99bbff | 8 | faint |
| 2 | Void | dark | oled | #000000 | #070707 | #e8eaf0 | #6366f1 (fill #5f62e7) | #8688fd | 2 | faint |
| 3 | Carbon | dark | solid | #1a1918 | #201f1e | #efebe6 | #e0a245 | #d6b27a | 8 | faint |
| 4 | Obsidian | dark | oled | #050505 | #0c0c0c | #ededed | #10b981 | #5fd4a8 | 2 | hairline |
| 5 | Ember | dark | solid | #0f0d0c | #161413 | #f3ece6 | #ec9448 | #f0a868 | 8 | faint |
| 6 | Volt | dark | oled | #050706 | #0c0e0d | #eef3ea | #d8ff26 | #d8ff26 | 2 | hairline |
| 7 | Midnight HC | dark | oled | #000000 | #080808 | #ffffff | #ffffff | #d6d6d6 | 2 | strong, line #999999 |
| 8 | Glacier | dark | acrylic 72% | #0c1620 | #131d26 | #eaf2f8 | #7dd3fc | #a5def8 | 14 | faint |
| 9 | Lagoon | dark | acrylic 72% | #081f1d | #0f2523 | #e3f3ef | #34d399 | #7fe0bd | 14 | faint |
| 10 | Frost | light | solid | #f4f8fb | #ecf0f4 | #152029 | #0f766e | #4d8f89 | 14 | faint |
| 11 | Paper | light | solid | #fbfbfc | #f3f3f4 | #1b1d21 | #2f6fed | #5a8aea | 8 | faint |
| 12 | Sand | light | solid | #f5efe3 | #eee8dc | #2a2118 | #c2410c | #bf7044 | 8 | faint |
| 13 | Sage | light | solid | #f1f5ef | #eaeee8 | #1c261e | #3f7d4e | #63906c | 14 | faint |
| 14 | Blush | light | solid | #fbf2f3 | #f4eaec | #2b1a1f | #be185d | #cc6289 | 14 | faint |
| 15 | Chalk | light | solid | #ffffff | #f7f7f7 | #111113 | #18181b | #71717a | 2 | hairline |
| 16 | Daylight HC | light | solid | #ffffff | #f6f6f6 | #000000 | #000000 | #3a3a3a | 2 | strong, line #666666 |
| 17 | Orchid | light | acrylic 82% | #f5f1fb | #eee9f4 | #211a2d | #6d28d9 | #9670d8 | 14 | faint |
| 18 | Pearl | light | acrylic 82% | #faf7f4 | #f2efec | #231c16 | #b45309 | #b27a41 | 14 | faint |

Every other value (raised, line, dim, faint, on-accent, selection, kinds, ten code roles, active
line) is taken from `themes.json` as is. `themes.json` lists Glacier and Lagoon before Midnight HC;
the approved wall (and `index.html`) puts HC first, which is the order above and the order shipped.
Every shipped theme sets in the system face and 12.5 px (the 2026-09-20 rule stands).

## What the code is today (read end to end, 2026-10-06, origin/main 7b0d688, v0.89.0)

- `lib/theme.ts` (1802 lines) holds the model (`Style`), 10 shipped styles (dark: Aurora, Onyx
  `default`, Void `new-void`, Terminal, Driftwood, Ruby `acrylic-red`; light: Paper, Frost, Linen,
  Orchid), the derivation (`derive`, `variablesFor`), the draft and presets, and the store.
- ONE-SURFACE RULE: the panel, title bar and tab bar derive from `bg` unless the style marks its own
  colour (`sideOwn`, `titleOwn`, `tabsOwn`), which a saved style may already do.
- Storage: `prism.style` (the id in use), `prism.mode` ('dark' or 'light'), `prism.style.draft`
  (the unsaved edits), `prism.style.presets` (own copies). All synced across windows by
  `lib/windowPreferences.ts`.
- COLOUR MODE IS A FILTER, NOT A MEMORY. `setMode(m)` stores the mode and calls `setStyle` on the
  FIRST style of that mode; `StyleWall` and onboarding list `stylesFor(mode)`. There is no second
  remembered style: the row's subtext "Dark and light each keep their own style." was never true
  of the code. So "the two remembered styles collapse to the one in use" is simply: keep
  `prism.style`, drop `prism.mode` as a setting.
- Readers of the mode: `AppearancePage` (the Colour mode row), `StyleWall` (filter), `Onboarding`
  (the Dark / Light step, and the Style step's list), `deletePreset` (fallback), `renderApp.tsx`
  (`--demo` hook `setMode`), `main.tsx` (boot screen colours from `prism.mode`), the `switchStyle`
  e2e helper. `style.mode` (each style's own) is read by `derive`/`variablesFor`, `paint`
  (`data-mode`, `setWindowMaterial`), `Settings.tsx` (`colorScheme`), `StyleMini`.
- Code colours: `--p-code-*` are FIXED in `index.css`, one set on `:root` and one on
  `:root[data-mode='light']`; `codeContrast.test.ts` reads the CSS. Not part of a style.
- Menus and pills paint `--p-side-flat` (opaque). Nothing paints a "raised" step.
- File kinds: `--p-kind-*` (from `KIND_TINTS`) are read by `StyleMini` only; the tree's file icons
  are monochrome (`fileIconOf`).
- The terminal follows the style through the core (`followsHostStyle`, theme id `'style'`): the core
  reads `--p-bg`, `--p-text`, `--p-accent-hi`, `--p-side-flat` off `:root` and watches `:root`'s
  style. `setStyle` resets the terminal to follow the style (`setTermThemeId('style')`,
  `resetTermExtras()`).
- Own copies: `savePreset` stores `edited(base)` as `Custom theme N` with `custom: true` and
  `base` (the shipped id it grew from); `deletePreset` lands on `base`, else the first style of
  the mode.
- See-through: Primary's alpha is the old Acrylic level (#249): stored as the draft's `acrylic` or a
  preset's `glass`, painted at `paintedAlpha = 1 - (1 - 0.75 glass)^3`. #295 (open) fixes double
  coats on the title bar, tab strip, address row, preview pane and the Settings frame, and adds the
  `seeThrough` e2e on Onyx.

## 1. The theme data model

### 1.1 One Style, plus a theme table

`Style` stays the model (own copies and the draft keep working unchanged). A shipped theme is a
`Style` whose inputs are the editable roles, plus an optional `table`: the values the theme was
designed with that Prism would otherwise derive.

```ts
interface ThemeTable {
  raised: string          // menus, popovers
  line: string            // the always-on list hairline; HC: every edge
  dim: string             // themes.json textDim
  faint: string           // themes.json textFaint
  accentFill: string      // themes.json accent: the text-bearing fill at alpha 1
  onAccent: string        // its ink
  kinds: Record<'image' | 'video' | 'audio' | 'pdf' | 'text', string>
  code: Record<'keyword' | 'string' | 'number' | 'function' | 'type' | 'tag' | 'attribute'
    | 'constant' | 'comment' | 'punctuation' | 'activeLine', string>
}
interface Style { ...; hc?: boolean; table?: ThemeTable }
```

THE TABLE HOLDS ONLY WHILE ITS INPUTS DO. `edited(s)` prunes it against the draft, so an edit never
paints a value designed for colours that are no longer on screen:

| Draft edits | Table entries dropped (Prism derives them again) |
|---|---|
| `bg` or `text` | `raised`, `line`, `dim`, `faint`, `kinds`, `code` |
| `accent` or `accentAlpha` | `accentFill`, `onAccent` |
| `borders` | `line`'s use as the edge (HC) |
| `acrylic`, `side`/`title`/`tabs`, `selection`, `folderIcon`, `font`, `corners` | nothing |

`savePreset` saves what `edited()` returns, pruned table included, so an own copy is exactly what was
on screen. A style without a table (every existing own copy) takes today's derivation, byte for byte.

### 1.2 How themes.json maps onto Prism

| themes.json | Style | Token(s) |
|---|---|---|
| `ground` | `bg` | `--p-bg` (at the glass alpha on a see-through theme) |
| `panel` | `side`, `title`, `tabs` with `sideOwn`, `titleOwn`, `tabsOwn` (six digits, so they follow the glass) | `--p-side`, `--p-title`, `--p-tabs`, `--p-tab-active`, `--p-side-flat`, `--p-tabs-flat` |
| `raised` | `table.raised` | `--p-raised` (NEW) |
| `line` | `table.line` | `--p-line`; HC also `--p-divider` and `--p-edge` |
| `text` | `text` | `--p-text` (`--p-text-soft` stays derived) |
| `textDim`, `textFaint` | `table.dim`, `table.faint` | `--p-dim`, `--p-dim2` |
| `accentSolid` | `accent` (hex) | `--p-accent-solid`; `--p-accent-hi` stays derived (equal to it on all 18, tested) |
| `accent` | `table.accentFill` | `--p-accent`, `--p-sel-bg`, `--p-sel-seen` and the knockouts at accent alpha 1 |
| `onAccent` | `table.onAccent` | `--p-on-accent` |
| `selection` | `selection` | `--p-sel-tint`; `--p-sel-tint-seen` stays derived (equals `selectionSeen` within 1/255) |
| `folder` | `folderIcon` | `--p-tree-folder`, `--p-tree-zip` (the zip follows the folder, 2026-09-20 rule) |
| `kinds.*` | `table.kinds` | `--p-kind-image/video/audio/pdf/text` (the card preview; `archive` is the folder's) |
| `code.*` | `table.code` | `--p-code-*`, see 1.3 |
| `groundAlpha` | `material: 'acrylic'`, `glass = glassFor(alpha)` | painted at exactly 184/255 (dark) or 209/255 (light) |
| `material`, `corners`, `edges` | `material`, `corners`, `borders` | as today |
| `blurb` | `blurb` | the card's tooltip |
| `highContrast` | `hc: true` | hides the see-through row (3.2) |
| `groundPainted`, `panelPainted` | (computed) | tested equal to what `variablesFor` paints |
| `raisedPainted` | not used | menus stay opaque (#295's rule: "Opaque on purpose: menus, dialogs, pills") |
| `suggested`, `why`, `keptFromCurrent` | not shipped | |

`glassFor(a) = (1 - cbrt(1 - a)) / 0.75`, the inverse of `paintedAlpha`: 0.4627 for 184/255, 0.5800
for 209/255. The Primary picker then shows 72% and 82%, inside its 53% to 95% range.

THE ONE-SURFACE RULE IS NARROWED, NOT REVERSED: a shipped theme now carries its panel as its own
colour (a 3 to 3.5% step off the ground, the approved look), through the `sideOwn` route the rule
already allowed. Own copies without one keep the one surface.

### 1.3 New tokens, and where they are used

- `--p-raised` (opaque): `ContextMenu`, `SortMenu`, `PlayerMenu` and the title bar's More menu
  (they paint `--p-side-flat` today). Pills, find bars and the search popup keep `--p-side-flat`.
  A style without a table: `--p-raised` = `--p-side-flat`, so nothing changes for own copies.
- Code colours become STYLE TOKENS, published by `variablesFor`, and leave `index.css` (the light
  block keeps only the checkerboard). Mapping in `codeTheme.ts`:

| Highlight tags | Token | themes.json role |
|---|---|---|
| keywords | `--p-code-keyword` | keyword |
| strings, regexp, attribute values | `--p-code-string` | string |
| numbers | `--p-code-number` | number |
| function names, links | `--p-code-fn` | function |
| types, classes, namespaces | `--p-code-type` | type |
| `tagName`, `angleBracket` | `--p-code-tag` (NEW; was keyword) | tag |
| `attributeName` | `--p-code-attr` (NEW; was `--p-text-soft`) | attribute |
| `meta`, annotations | `--p-code-meta` | attribute |
| constants, null, booleans | `--p-code-const` | constant |
| comments | `--p-code-comment` | comment |
| operators, punctuation | `--p-code-op` | punctuation |
| active line | `--p-code-active-line` | activeLine |

  `--p-code-invalid`, `--p-code-sel` and `--p-code-match` stay per mode (today's values, moved into
  `theme.ts`), the invalid red floored to 4.5:1 on the theme's ground; it stays red on the HC themes
  (an error is a state, not decoration). A style without a table gets today's dark or light set,
  byte for byte, so an own copy's editor does not change.

## 2. Colour mode goes; what replaces each use

| Today | After |
|---|---|
| Appearance's Colour mode row (`mode`, `Segmented`) | gone; the wall lists all themes |
| `StyleWall` lists `stylesFor(mode)` | `ThemeWall` lists the 18, then own copies |
| `setMode`, `useMode`, `stylesFor`, `useStyles(m)` | removed; `useThemes()` lists all |
| `deletePreset` falls back to the mode's first | falls back to `base` (mapped, 4), else Aurora |
| Onboarding's Dark / Light step and its mode-filtered Style step | one theme step (5) |
| `renderApp.tsx` `--demo` `setMode` | removed (`setStyle` stays) |
| `main.tsx` boot colours read `prism.mode` | still read `prism.mode`, which is now a MIRROR: `paint()` writes the painted theme's mode there, nothing else writes it, nothing but the boot screen reads it (and an older build after a downgrade finds a sane value) |
| `data-mode`, `colorScheme`, `setWindowMaterial(material, mode)` | unchanged: they read the theme's own `mode` |
| `index.css` `:root[data-mode='light']` code colours | gone (1.3); the checkerboard stays |
| e2e `switchStyle(win, id, mode)` | `switchStyle(win, id)` |

## 3. Settings > Appearance

Order: the Themes card, This theme, Colours of <theme>, Text, Window (Text and Window as today).

### 3.1 The Themes card

- First row is the HEADER ROW: icon, label "Themes", subtext "Choose your look.", no control. The
  card has no section heading above it (`APP_SECTIONS['style-theme'] = ''`).
- Then the wall (`components/settings/ThemeWall.tsx`, replacing `StyleWall.tsx`): 18 cards, then the
  own copies, 6 across (3 across when the wall is narrower than six 124 px cards; 18 is 6 x 3 and
  3 x 6, so the halves keep their rows), gap 20 px by 16 px, 10 px padding.
- Card style B (`components/ThemeCard.tsx`, built on `StyleMini`): the mini Explorer (104 px, as
  today, every colour off `derive` so an edited theme's card follows the edit) with a 28 px band at
  its foot in the theme's own panel colour and text, its edge a hairline of the text (HC: its
  `line`); on a see-through theme the band is the painted panel over the frost backdrop. The band
  holds the name (ellipsis) and, on the chosen card only, a check in the theme's `--p-accent-solid`.
  Chosen: a 2 px accent ring 2 px outside the preview (`--p-accent-solid` of the window, a selection
  mark, #202). `title` = the blurb. No "Suggested" anywhere. Own copies carry the existing hover
  delete control (`tabIndex -1`), and Delete on a focused own copy does the same.
- The preview's own 1 px edge sits on top of it (`inset` shadow, text at 11% dark / 13% light, HC
  55%), stronger on hover (24% / 26%, HC 80%), so a light card on a light page still has an edge.
- ACCESSIBILITY: `role="radiogroup"` labelled by the header row; each card `role="radio"`,
  `aria-checked`, `aria-label` the name. Focus is #272's: no ring, no outline; a focused card wears
  the hover fill (the base layer already covers `[role='radio']`) and its preview edge goes to the
  hover strength. A polite `role="status"` line says "Aurora kept" / "Back to Aurora".
- COLLAPSED (the default each time Settings opens, not remembered): only the row holding the current
  theme is shown, so the chosen card is always in view. Under it, centred, a 28 px text button
  "Show all 18 themes" (the count is the wall's total, own copies included) with a chevron;
  expanded it reads "Show fewer" and the chevron is turned 180 degrees. `aria-expanded`,
  `aria-controls`. A neutral control (#202): grey text, hover fill, never the accent.
- MOTION (ported from the mockup, `hooks/useWallMotion.ts`, Web Animations):
  - Opening: the wall's height eases from its collapsed to its full height in 270 ms,
    `cubic-bezier(.33,1,.68,1)`; the row that was in view slides to its place (FLIP); every other
    card fades in and rises 6 px, 220 ms, delay `30 + min(d, 2) * 45` ms where `d` is its row's
    distance from the kept row minus one.
  - Closing: 220 ms, the same curve; the other rows fade out in 130 ms (`ease-out`) while the chosen
    row slides to the top and the height shuts.
  - The chevron turns over 270 ms on the same curve.
  - A press mid-way starts from where the wall IS (its measured height), never from a jump.
  - `overflow: hidden` only while moving (`data-moving`), so nothing is clipped at rest.
  - Reduced motion (`prefers-reduced-motion: reduce`): the layout simply changes, no animation.
  - END STATES are exact: no running animations (`getAnimations()` empty), no inline transform,
    opacity or height left on any card or the wall, the right cards shown.
- KEYS (one focus stop, roving `tabIndex` on the chosen card):
  - Arrows move AND apply live. Left and Right wrap through the whole list; Down and Up go a row,
    wrapping by column; Home and End go to the first and last.
  - Moving past the visible row EXPANDS the wall (animated), so the arrows walk all of them.
  - Enter or Space KEEPS the theme on screen. Escape goes back to the theme the wall had when the
    focus came in, and keeps the focus on its card; with nothing to undo, Escape is left to
    Settings (it closes the page, as today).
  - LIVE IS A PREVIEW UNTIL KEPT: an arrow repaints the window (`previewStyle(id)`: `paint` only,
    the draft hidden but not dropped, nothing written to storage, the terminal's theme untouched).
    The theme is COMMITTED (`setStyle`) by Enter or Space, by a click, and when the focus leaves the
    wall on a previewed theme. Escape repaints the kept theme and the draft as they were. So a
    browse that ends in Escape costs no unsaved edit and no terminal preset, and a closed window
    never stores a preview. A terminal that follows the style follows the preview live, since it
    watches `:root`.
- A click commits at once (as today, dropping unsaved edits to another theme's card; the current
  card while edited does nothing, as today).
- A theme that was retired by the migration (4) puts ONE quiet line under the header row until the
  next theme pick: "Your theme Onyx was retired, Void is the closest." (plain words, comma and dot).

### 3.2 This theme

A section titled "This theme" with two rows:
- "See-through window", subtext "The desktop shows behind every surface.", a switch. On a
  see-through theme it is on; off is an edit to solid (draft `acrylic: 0`). On a solid theme on is
  an edit to the see-through level of its mode (level 70 dark, 49 light: the alpha Glacier and
  Orchid paint). It is the same draft value as Primary's alpha, so the two always agree. Not shown on
  the HC themes ("where it applies"): high contrast is measured on a solid ground and glass would put
  an unmeasurable desktop under the text.
- "Edits to this theme", subtext "Saved as your own copy.", the existing `SaveButton` (accent, the
  only accented control, #202), dirty while `isEdited()`. Saving makes `Custom theme N` at the end
  of the wall, as today.

### 3.3 Colours of <theme>

As today (`StyleColoursSection`), titled "Colours of Aurora", rows Background, Sidebar and tab bar
colour, Accent colour, Selection colour, Text colour, Folder icon colour, each the core picker with
alpha. Two label changes from the mockup: `c-bg` becomes "Background", subtext "Behind lists, files
and settings." (it is the ground of all of those now). The mockup's Accent subtext "Chosen page,
rings and progress." is NOT taken: the chosen rail page is grey since #292; the current subtext
stays.

### 3.4 Options and search

`appOptions.ts`: `mode` removed; `style-theme` becomes label "Themes", subtext "Choose your look.",
keywords from the 18 names plus "dark light mode style look"; NEW `see-through` (section
`this-theme`, store the draft) and `theme-edits` (section `this-theme`, store the draft and
`prism.style.presets`); `APP_SECTIONS` gains `'this-theme': 'This theme'`. `settingsIndex.ts`'s order
follows. The `appOptions.test.ts` key snapshot changes on purpose (one key retired as a setting,
`prism.mode`). `settingsCopy.test.ts` holds the new copy to its rules.

## 4. Migration of saved state

Runs ONCE, synchronously, at `theme.ts`'s import, before the first paint (`lib/themes/migrate.ts`,
a pure function over a storage snapshot, applied by `theme.ts`). Marker `prism.style.v = '2'`
(synced to other windows like any preference; a second window finds it done). Nobody lands on the
default silently: every id maps deliberately.

| Saved `prism.style` | Was | Becomes | Why |
|---|---|---|---|
| `aurora` | Aurora | Aurora | kept |
| `new-void` | Void | Void (id kept) | kept |
| `frost` | Frost | Frost | kept |
| `paper` | Paper | Paper (id kept) | same name, same character (white, Prism blue) |
| `orchid` | Orchid, tinted lilac | Orchid (id kept), lilac glass | same name and hue; it becomes see-through |
| `default` | Onyx, glass over true black | Void, WITH ITS GLASS: a draft `acrylic` of Onyx's level (55) unless the draft already has one | black ground and indigo are Void's; the see-through is kept, not silently taken away |
| `terminal` | Terminal, green and square | Obsidian | near-black, emerald, square |
| `driftwood` | Driftwood, warm tinted dark, copper | Carbon | warm charcoal, amber |
| `acrylic-red` | Ruby, near-black and red | Ember | near-black, the warm accent nearest red |
| `linen` | Linen, warm paper, bronze | Sand | beige, terracotta |
| an own copy's id | | unchanged | |
| an unknown id | | Aurora | as today (`byId`'s fallback) |

- The DRAFT (unsaved edits) is kept as it is and now sits on the mapped theme.
- `prism.mode` stops being a setting: the one in use is `prism.style`, which is kept (there is no
  second remembered style, see "What the code is today"). The key is rewritten as the boot mirror.
- OWN COPIES are kept intact, every field (they render through the legacy derivation, byte for
  byte), and are shown at the end of the wall in saved order whatever their mode. Their `base` is
  mapped through the table above, so deleting one lands on a theme that exists.
- If the saved id was RETIRED (Onyx, Terminal, Driftwood, Ruby, Linen), `prism.style.retired`
  stores the old NAME for the one-time line in 3.1; the first theme pick removes it.
- The visualizer and progress bar colours are the user's (`prism.viz.*`) and are not touched.
- The terminal's theme is not touched (the migration writes ids, it never calls `setStyle`).
- The retired styles' definitions move to `lib/themes/retired.ts`: the migration reads Onyx's glass
  from there, and the legacy-derivation tests use them as fixtures. They are never offered.

## 5. Onboarding

The Dark / Light step and the Style step become ONE step, the first: kicker "Appearance", heading
"Choose your look.", body "Every theme is dark or light by itself. Settings has the rest." It shows
the same `ThemeWall` (6 across, the card preview 72 px high so three rows fit a 698 px window, the
whole page width: the window itself is the preview, so `StyleArt` goes), collapsed to the current
row with the same Show all. Steps become three: Appearance, The sidebar, One last thing (dots 3).
A pick that changes dark to light or back plays the existing sweep (`Sweep`, held 1.38 s) on a
click or Enter; arrow previews repaint without it. `ModeCards` and `ModePreview` go. `finish` keeps
saving an edit as an own copy, as today.

## 6. The terminal's follow-style link

No core change. The core reads `--p-bg`, `--p-text`, `--p-accent-hi` and `--p-side-flat` and watches
`:root`; all four are still published. One meaning shifts: `--p-side-flat` is now the PANEL on a
shipped theme (it equalled the ground under the one-surface rule), and the core derives the ANSI
sixteen against it. On every one of the 18 the panel sits between the ground and the text, so
anything that clears its floor on the panel clears it on the ground too (dark: the ground is
darker; light: the ground is lighter). Tested: the derived sixteen hold 3:1 on `--p-bg` for all 18.
`TermHostConfig` (`termHost.ts`) is unchanged. A theme commit still resets the terminal to follow
the style (`setStyle`), a preview does not.

## 7. See-through surfaces (#295)

#295 keeps its rule: one coat of ground per pixel; menus, dialogs, pills and the address field stay
opaque. Coordination:
- If #295 lands first: this branch rebases on it, and its `seeThrough` scenario switches from Onyx
  (retired) to Glacier and Orchid (one dark, one light).
- If this lands first: #295 makes the same switch when it rebases (its scenario names `default`).
- No overlapping hunks: #295 edits `App.tsx`, `TabStrip.tsx`, `browse.css` and the Settings frame
  rules in `index.css`; this branch edits `index.css` only in the code-colour blocks, and
  `run.mjs` in the new scenarios and `switchStyle`.
- The 4 see-through themes paint the panel at the ground's alpha (six-digit own colours follow the
  glass), which is exactly `panelPainted` in `themes.json`.

## 8. Tests

### Unit (vitest)

- `themes/catalogue.test.ts`: exactly 18, in the approved order and names; ids (Void is
  `new-void`); 9 dark then 9 light; HC before see-through in each half; system face; every value
  equal to the approved `themes.json` (a copy of the approved values, minus the suggestion fields,
  lives in the repo as `lib/themes/catalogue.json`; the research file is the source it came from).
- `themes/contrast.test.ts`, on what Prism PAINTS (`variablesFor`), all 18: text 4.5:1 on ground,
  panel and raised; `--p-dim` 4.5:1 and `--p-dim2` 3.2:1 on the panel; on-accent 4.5:1 on
  `--p-accent`; `--p-accent-solid` 3:1 on ground and panel; text 4.5:1 and dim 3.2:1 on the
  selection as seen (the selection's own floors, so `--p-sel-tint` equals `themes.json` exactly,
  never stepped down); selection visible (1.12) against the ground; folder 3:1 on the panel; ten
  code roles 4.5:1 on ground and panel, eight on the active line; `--p-code-invalid` 4.5:1; see-through:
  text 4.5:1 over the glass composited on white and on black; painted alpha 184 or 209; HC: accent,
  selection and folder pure grey, kinds and code near grey.
- `themes/table.test.ts`: `edited()` prunes the table per 1.1; an own copy saved after a `bg` edit
  carries no `dim`; a style with no table derives exactly as before (snapshot of all 10 retired
  styles' `variablesFor`, taken on main BEFORE the change).
- `themes/migrate.test.ts`: every row of the table in 4; Onyx gets level 55 unless the draft has
  `acrylic`; the draft kept; presets kept field for field and their `base` mapped; `prism.mode`
  is not read for the choice; the marker; idempotent; junk storage; the retired name recorded.
- `themes/wall.test.ts` (pure helpers): `rowOf`, visible indices collapsed and open, `wallTarget`
  for every key and wrap, at 6 and 3 columns, own copies included; the stagger delays.
- Changed: `theme.test.ts` ("one surface" holds for styles without a table; the 2026-09-20 pins of
  Aurora and Ruby: Aurora's stays, Ruby's retires with Ruby, by this decision), `theme.selection*`
  and `theme.alpha` (fixtures from `retired.ts` where they meant a retired style),
  `codeContrast.test.ts` (reads the tokens off each theme and the legacy sets, no longer the CSS),
  `appOptions.test.ts` (snapshot), `settingsCopy.test.ts` (new copy).

### e2e (`tools/e2e/run.mjs`, headless runner only)

- NEW `themeWall`: the header row and its subtext; collapsed shows exactly the current row (6
  cards); the chosen card's ring is `--p-accent-solid` and its check is drawn; tooltips are the
  blurbs; no "Suggested" text; Show all: during the animation the wall's height sampled every 25 ms
  only grows, then all cards shown in the approved order, "Show fewer", `aria-expanded`, chevron at
  180 degrees, no animations left, no inline styles left; Show fewer: height only shrinks, ends on
  the current row; a second press 100 ms in reverses from the measured height; reduced motion
  (`emulateMedia`): the end state in the same frame, no animation. Keys: Tab lands on the chosen
  card and the next Tab leaves the wall; Right previews (the `--p-bg` changes, `prism.style` does
  not); Enter keeps (`prism.style` written); Down past the row expands; Home and End; Escape goes
  back (tokens and storage as before, the draft intact); focus shows the fill and no outline,
  focused against unfocused (#272). Screenshots `.e2e/shots/theme-wall-*.png`.
- NEW `themeMigration`: two seeded profiles (Onyx with a draft and two own copies, one dark and one
  light, `base: 'default'`; Driftwood with `prism.mode = 'light'`): after launch `prism.style` is
  Void / Carbon, Onyx's glass is a draft level 55, the own copies are the last cards, unchanged,
  the one-time line names the old theme, nothing reset to Aurora, the marker is set; a theme pick
  removes the line.
- NEW `onboardingTheme`: a profile without `prism.onboarded`: three dots, the wall on step one,
  picking Paper from Aurora plays the sweep and lands light, Start stores the theme.
- `seeThrough` (from #295): on Glacier and Orchid (see 7).
- Changed: `switchStyle` drops the mode; `settingsLook` uses Void (2 px gives 5 px) and Glacier
  (14 px gives 17 px) where it used Onyx and Ruby; `addressField`, `markTint`, `panelsAlign`,
  `updateWindow` keep their ids (aurora, paper, new-void exist). `settingsLook` is in
  `e2e:terminal`, so that gate runs too.

## 9. Version

Minor: 0.89.0 to 0.90.0 (0.90.0 also if #295 lands first as 0.89.1).

## 10. Risks

- PEOPLE ON A RETIRED THEME SEE A DIFFERENT WINDOW after the update. Mitigated by the deliberate
  map, Onyx's glass carried over, own copies untouched, and the one-time line. A user who wants the
  old look exactly has no way back (the old styles are not offered); an own copy saved before the
  update is the only way to keep one.
- ORCHID BECOMES SEE-THROUGH for whoever had it. Same name and hue, a different material; the
  see-through switch turns it solid in one click.
- `--p-side-flat` MEANS THE PANEL NOW on shipped themes; the core's comment calls it the flat twin
  of `--p-bg`. Harmless for its maths (6), but worth a core comment fix.
- The mockup's active tab takes the ground colour; Prism's recorded rule (2026-09-03, and #295) is
  that the tab strip is one surface and the active tab is told by its ink. Not adopted here; the
  approved mockup was about themes, not the tab strip. Ask if it was meant.
- The mockup's "faint" edge (9% of the text) is stronger than Prism's Faint (2.2%). Prism's Edges
  scale stays (it is a setting with recorded numbers); the theme's `line` is the always-on list
  hairline, where it matches Prism's 9% already.
- `codeContrast` moves from reading CSS to reading tokens: the editor's colours are now per theme,
  which is a visible change in every code file.
- Menus move to `--p-raised`: a small visible step on every shipped theme.
- Arrow previews repaint the whole window at key-repeat speed. `paint` writes about 70 custom
  properties; measured in the e2e by holding Right across all 18 (no frame over 50 ms).
- Two windows: the migration runs in whichever loads first and the marker syncs; a second window
  reads the migrated keys.

## Implementation plan

Branch `feat/298-new-themes` (worktree `.claude/worktrees/themes`). TDD where pure. Commits
`type(scope): subject` with the trailers. Gate before the PR: typecheck, lint, unit, the new and
changed e2e scenarios while iterating, then the whole e2e and `npm run e2e:terminal`.

1. **Snapshot first.** `themes/table.test.ts`'s legacy snapshot: `variablesFor` of all 10 current
   styles, taken on the untouched code, so the move cannot change an own copy.
2. **Data.** `lib/themes/catalogue.json` (the approved values in wall order, Void's id `new-void`,
   suggestion fields dropped), `lib/themes/catalogue.ts` (maps it to `Style` with `table`, `hc`,
   `glassFor`), `lib/themes/retired.ts` (the 10 old definitions and the id map). Tests:
   `catalogue.test.ts`.
3. **Derivation.** `theme.ts`: `ThemeTable`, `hc`; `derive`/`variablesFor` read the table; `edited()`
   prunes it; `--p-raised`, the code tokens (with the legacy dark and light sets as fallback),
   `--p-code-tag`, `--p-code-attr`; HC line on `--p-divider`/`--p-edge`; `STYLES` becomes the 18.
   `codeTheme.ts` remaps tags and attributes. `index.css` loses the code-colour blocks. Tests:
   `contrast.test.ts`, `table.test.ts`, rewritten `codeContrast.test.ts`, changed theme tests.
4. **Mode out.** Remove `setMode`, `useMode`, `stylesFor`, `useStyles(m)`; `useThemes()`; `paint`
   writes the `prism.mode` mirror; `deletePreset`'s fallback; `renderApp.tsx`'s demo hook.
5. **Migration.** `lib/themes/migrate.ts` + `migrate.test.ts`; called at the top of `theme.ts`'s
   store, before `load()`; the storage listener re-reads as today.
6. **Preview.** `previewStyle(id | null)` in `theme.ts` (paint only; null repaints what is stored).
7. **Wall.** `lib/themes/wall.ts` (+ test), `hooks/useWallMotion.ts`, `components/ThemeCard.tsx`
   (StyleMini plus band; StyleMini takes a `height`), `components/settings/ThemeWall.tsx`; delete
   `StyleWall.tsx`. Menus to `--p-raised` (`ContextMenu`, `SortMenu`, `PlayerMenu`, More).
8. **Appearance page.** Themes card with header row, This theme section (see-through switch, Save),
   Colours of (Background label), retired-theme line; `appOptions.ts`, `settingsIndex.ts`, tests.
9. **Onboarding.** One theme step, three steps, sweep on a mode-changing pick.
10. **e2e.** `switchStyle`, `settingsLook` ids; new `themeWall`, `themeMigration`,
    `onboardingTheme`; `seeThrough` per 7 once #295 is in. Look at every screenshot.
11. **Docs.** CLAUDE.md: replace "THE SHIPPED STYLES" with the 18-theme section (the owner's words,
    the map, the table rule, no Colour mode, the wall's motion and keys), narrow the one-surface
    note, drop the `colorScheme`/mode lines that no longer hold; link this spec and the research
    folder.
12. **Version** 0.90.0 in `package.json` and the lock.
13. **Verify**: full gate, `npm run package`, silent install, launch, report the version; hands-on
    list for the owner (see-through themes on a real desktop, the animation at 100% and 225%, an
    old profile with Onyx).
14. **PR** "feat(style): 18 themes on one theme wall, no Colour mode (#298)", body with the
    owner's choices, the map, screenshots, the gate; stop and ask "merge?".
