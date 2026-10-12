import { useId, type JSX } from 'react'
import type { FileKind } from '@shared/types'
import { ROW_ICON } from '../../lib/prefs/treePrefs'
import {
  ACCENT_LED,
  ICON_COLOURS,
  COMIC_ART,
  COMIC_PAGE,
  COMIC_WORD,
  ICON_ALWAYS_COLOUR,
  ICON_FULL_COLOUR,
  ICON_GLINT,
  ICON_PATHS,
  IDENT_BY_EXT,
  LANG_BY_EXT,
  LANG_BY_NAME,
  LANG_PATHS,
  type IconIdentity
} from '../../lib/iconPaths'
import { useIconScheme } from '../../lib/theme'
import { FolderFill } from './Icon'

// The file and folder icons every list draws: the tree, the Explorer, search,
// the archive panel. Moved out of TreeRows (structure cleanup, 2026-10-12).

/** Folders wear the folder token, files the file token - both pickers in
 *  Settings, both derived per style by theme.ts against its own ground, with a
 *  4.5:1 floor. That derivation is why the icons need no light/dark switch of
 *  their own: a light style resolves the same token to dark ink. */
// eslint-disable-next-line react-refresh/only-export-components -- the colour rule, beside the icons it colours
export function iconColour(kind: FileKind | 'folder'): string {
  // FOLDERS keep their own colour: they are not one of the file kinds and the
  // tint is what lets you scan containers from contents at a glance.
  if (kind === 'folder') return 'var(--p-tree-folder)'
  // Every FILE kind is the same ink. The per-kind tints retired 2026-08-21 and
  // the archive's own colour went with the drawn icons (2026-08-31): the kind
  // lives in the SHAPE, and tinting it as well read as a colour chart.
  return 'var(--p-tree-file)'
}

/**
 * Prism's own icon for a file kind, monochrome (2026-08-31).
 *
 * The nine FileKinds map onto the SEVEN icons the .ico set ships, and the map
 * is Explorer's own: `assoc.nsh` points Prism.Text at the code icon and
 * Prism.Document at the document one, so a .ts in the sidebar and the same .ts
 * on the desktop are the same picture. 'other' is not registered with Windows
 * at all and takes the plain page.
 *
 * `bg` IS THE BACKGROUND ACTUALLY BEHIND THE ROW, and the fold and the chip
 * are painted in it. Passing the panel token instead looks perfect in every
 * screenshot of an unselected tree and is wrong the moment somebody clicks a
 * row: the icon then carries a rectangle of panel colour across the accent
 * fill. Both surfaces that draw these rows sit on --p-side-flat, which is why
 * that is the default.
 *
 * Exported for the search results and the archive panel, which draw the same
 * rows outside the tree.
 */
const KIND_ICON: Record<FileKind, keyof typeof ICON_PATHS> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  comic: 'comic',
  archive: 'archive',
  pdf: 'document',
  doc: 'document',
  text: 'code',
  other: 'document'
}

/**
 * Which language mark a file gets, if any.
 *
 * By EXTENSION first, then by whole NAME - and the name half is the app doing
 * something Explorer cannot. Windows associates on extension, so `Dockerfile`
 * and `.gitignore` can never carry a mark on the desktop however well drawn;
 * here they can, and do. Expect that asymmetry rather than reading it as a bug.
 */
function langFor(kind: FileKind, name?: string, ext?: string): keyof typeof LANG_PATHS | null {
  if (kind !== 'text' || !name) return null
  const e = (ext ?? '').replace(/^\./, '').toLowerCase()
  if (e && e in LANG_BY_EXT) return LANG_BY_EXT[e]
  const n = name.toLowerCase()
  return n in LANG_BY_NAME ? LANG_BY_NAME[n] : null
}

/**
 * Which COLOUR IDENTITY a file has, which is finer than which icon it draws.
 *
 * `.md` draws the code kind's stepped bars because it has no mark of its own,
 * and `.docx` draws the same page as `.pdf` because both are the document kind.
 * Colouring by kind therefore painted a README as source and a Word file as a
 * PDF. The shape is still the kind's; only the colour is resolved here.
 *
 * A language mark wins first - it is the most specific thing known about the
 * file - then the special extensions, then the kind. That order is what keeps a
 * `.csv` prose rather than a spreadsheet.
 */
function identityFor(
  key: keyof typeof ICON_PATHS,
  lang: keyof typeof LANG_PATHS | null,
  ext?: string
): IconIdentity {
  if (lang) return lang
  const e = (ext ?? '').replace(/^\./, '').toLowerCase()
  return IDENT_BY_EXT[e] ?? key
}

/**
 * THE LABEL IS DRAWN AT EVERY SIZE (owner instruction, 2026-09-01: "they should
 * be the same icons everywhere").
 *
 * It was briefly dropped below 30px on the arithmetic: the label is 4.08 units
 * in a 24-unit viewBox, so at the tree's 14px its cap height is 2.4px, and no
 * typeface is legible at 2.4px. That measurement still stands and the band is
 * still a smudge in a tree row - but the icon being ONE icon everywhere is
 * worth more than the two pixels, and it is the owner's call to make.
 *
 * What actually caused the complaint was not the label at all. `.log` was
 * getting the CODE mark, an indent guide, and a vertical spine with rungs
 * hanging off it is not a picture of structure at 14px - it is two letterforms,
 * read as "PT". Prose has no indentation to draw, so it draws lines now.
 */
export function KindIcon({
  kind,
  color,
  ext,
  name,
  size = ROW_ICON,
  bg = 'var(--p-side-flat)',
  selected = false
}: {
  kind: FileKind
  color: string
  /** The file's own extension, with or without the dot. Drawn on the band. */
  ext?: string
  /** The file's whole name, for the marks Windows cannot register. */
  name?: string
  /** How big it is drawn. Everything scales with it, the label included. */
  size?: number
  bg?: string
  /** The row is filled with the accent. Forces MONOCHROME - see below. */
  selected?: boolean
}): JSX.Element {
  // body, then ko, then hi. Any other order and the detail vanishes: `hi` is
  // punched back OVER ko in the ink, which is what keeps the clapperboard's
  // stripes, the splat's core and a mark's own holes from filling in solid.
  // THE DISC (owner, 2026-09-03, round 33): a .iso is an archive by kind and
  // wears the container in Explorer, but in the tree it is a disc - the one
  // extension whose SHAPE is not its kind's.
  const isDisc = (ext ?? '').replace(/^\./, '').toLowerCase() === 'iso'
  const key: keyof typeof ICON_PATHS = isDisc ? 'iso' : (KIND_ICON[kind] ?? 'document')
  const g = ICON_PATHS[key]
  // COLOURED ignores `color` and `bg` entirely. Nothing is knocked out to the
  // row's background there - every layer is a colour of its own - which is also
  // why a coloured icon is unmoved by landing on a selected row, where the
  // monochrome one has to repaint its fold and band in the accent fill.
  const lang = langFor(kind, name, ext)
  const ident = identityFor(key, lang, ext)
  const c = ICON_COLOURS[ident]
  // `selected` MEANS A ROW FILLED SOLID, and such a row falls back to
  // monochrome (owner instruction, 2026-09-01): the fill and the icon colour are
  // picked by different people and will eventually collide (a blue video icon
  // on a blue fill is an invisible icon), while monochrome measures its ink
  // against whatever is behind it. Since #257 a MARKED file is a light tint and
  // keeps its colours, so callers pass it only for the right-click row's grey
  // fill; the rule stays for any solid fill that comes back.
  // THE COMIC WEARS ITS EXPLORER ARTWORK, always and in colour: a keylined
  // sunburst under a halftone under a splat. It never falls back on a selected
  // row the way a flat page does, because five colours cannot all collide with
  // one accent - there is nothing for it to disappear into.
  const artwork = ident === 'comic'
  // AND THE ZIP KEEPS ITS COLOUR even while the scheme is monochrome (owner,
  // 2026-09-01). It does fall back when selected, because it IS a flat page and
  // an indigo one on an indigo accent is the collision the fallback exists for.
  // Hoisted: a hook behind a `||` is a hook that does not always run, and the
  // order has to be identical on every render.
  const scheme = useIconScheme()
  const colour =
    !artwork &&
    !selected &&
    (ICON_ALWAYS_COLOUR.includes(ident) ||
      (scheme === 'colour' && ICON_FULL_COLOUR.includes(ident)))
  const body = colour ? c.page : color
  // THE CONTAINER IS THE STYLE'S (owner, 2026-09-20; see --p-tree-zip in
  // theme.ts). In the monochrome scheme a zip and a disc take the FOLDER
  // colour and the ink that reads on it, instead of the coloured set's indigo.
  // The COLOURED scheme is left exactly as it is: there every kind is a colour
  // of its own, matching the .ico Explorer draws, and that parity is its point.
  // The band stays black under both, so the extension on it is unaffected.
  const accentLed = colour && scheme !== 'colour' && ACCENT_LED.includes(ident)
  const pageFill = accentLed ? 'var(--p-tree-zip)' : c.page
  const markFill = accentLed ? 'var(--p-tree-zip-ink)' : c.mark
  // One mask id per instance. A shared id works right up until the element
  // that defines it unmounts and takes every other icon's silhouette with it.
  const uid = useId()
  const maskId = `pi-m${uid}`
  const glintId = `pi-g${uid}`
  const mark = lang ? LANG_PATHS[lang] : null
  const markPath = mark ? mark.ko : g.mark
  const hiPath = mark ? mark.hi : g.hi
  const label = (ext ?? '').replace(/^\./, '').toUpperCase()
  const L = g.label
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden>
      {/* COLOURED DRAWS THROUGH A MASK OF ITS OWN SILHOUETTE, and that is not a
          flourish - it is the only arrangement measured to have no edge
          artefact at all. Painting the band OVER the page leaves a hairline of
          page colour around the outside, because the two share a curved outer
          edge and the page's own partial coverage survives underneath. Painting
          them as ABUTTING regions leaves a seam instead, because two
          antialiased edges meeting at 50% each composite to 75% rather than
          100% - measured at 239 pixels of seam per icon on a 256px render.
          `bleed` is the fold and band as plain rectangles overrunning the page
          on every side, so the silhouette is stated exactly once and everything
          inside it is opaque.
          A MASK, NOT A CLIP PATH, and the difference is measurable: Chromium
          applies clip-path to each child and then composites them, so two
          children that both reach the outline double-composite there and the
          edge comes out at 75% where the path itself gives 50%. A mask applies
          to the group's finished result. MEASURED against the bare silhouette:
          mask 0 pixels different, clip-path 79, clip-path inside an opacity
          layer 39.
          Monochrome needs none of this. Its knockouts are painted in the row's
          own background, so both artefacts are background-coloured and have
          never been visible. */}
      {artwork ? (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <path d={g.body} fill="#fff" />
          </mask>
          <g mask={`url(#${maskId})`}>
            <rect x="0" y="0" width="24" height="24" fill={COMIC_PAGE} />
            {COMIC_ART.map((l) => (
              <path key={l.d.slice(0, 24)} d={l.d} fill={l.fill} fillOpacity={l.opacity} />
            ))}
            <text
              x={COMIC_WORD.x}
              y={COMIC_WORD.y}
              fontSize={COMIC_WORD.size}
              fill={COMIC_WORD.fill}
              stroke={COMIC_WORD.stroke}
              strokeWidth={COMIC_WORD.width}
              paintOrder="stroke"
              fontWeight={800}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {COMIC_WORD.text}
            </text>
            <path d={g.bleed} fill={c.band} />
          </g>
        </>
      ) : colour ? (
        <>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <path d={g.body} fill="#fff" />
          </mask>
          {/* The GLINT: a highlight rolling off into a shaded corner, so the
              page reads as something with a surface rather than a flat fill.
              It sits over the page and UNDER the band, because a sheen across
              the extension is the one place it costs legibility. */}
          <defs>
            <linearGradient id={glintId} x1="0.08" y1="0" x2="0.82" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity={0.5 * ICON_GLINT} />
              <stop offset="0.3" stopColor="#ffffff" stopOpacity={0.13 * ICON_GLINT} />
              <stop offset="0.34" stopColor="#ffffff" stopOpacity={0.03 * ICON_GLINT} />
              <stop offset="0.66" stopColor="#000000" stopOpacity={0} />
              <stop offset="1" stopColor="#000000" stopOpacity={0.26 * ICON_GLINT} />
            </linearGradient>
          </defs>
          <g mask={`url(#${maskId})`}>
            <rect x="0" y="0" width="24" height="24" fill={pageFill} />
            <rect x="0" y="0" width="24" height="24" fill={`url(#${glintId})`} />
            {/* THE BAND GOES ON LAST, which is the order the .ico composites in
                and not a detail. The ARCHIVE's mark is the zip seam and pull,
                and it runs the whole height of the container - straight through
                the band and the extension set in it. A page kind's glyph box
                stops at 10.46 where the band starts at 11.62, so nothing there
                ever reaches it and the wrong order looks perfectly fine on six
                of the seven. */}
            {markPath ? <path d={markPath} fill={markFill} /> : null}
            {hiPath ? <path d={hiPath} fill={pageFill} /> : null}
            <path d={g.bleed} fill={c.band} />
          </g>
        </>
      ) : (
        <>
          <path d={g.body} fill={body} />
          {/* A language mark REPLACES the kind's own, so the fold and band come
              from the KIND with the mark swapped in - not both marks on one
              page. `koBand` is ko without its mark, stated by the emitter. */}
          <path d={mark ? `${g.koBand} ${mark.ko}` : g.ko} fill={bg} />
        </>
      )}
      {/* `hi` is the knockout INSIDE the mark, painted back in the ink. The
          coloured branch draws its own inside the mask; the ARTWORK branch has
          no mark at all - its splat is part of the picture - and drawing the
          old comic mark's knockout over it put a white star through the middle
          of the splat. */}
      {!colour && !artwork && hiPath ? <path d={hiPath} fill={body} /> : null}
      {label ? (
        <text
          x={L.x}
          y={L.y}
          // Keyed by CHARACTER COUNT, not scaled: two and three characters keep
          // the full size and only WEBM-length ones step down, which is what
          // stops a long extension running out of the band.
          fontSize={L.sizes[Math.min(label.length, 6) as keyof typeof L.sizes]}
          // THE LABEL FLIPS WITH THE BAND. Monochrome sets it in the ink inside
          // a band painted in the row's background; coloured sets it in `text`
          // inside a coloured band. Leave it on the ink for both and the
          // coloured icons get ink on ink.
          fill={colour || artwork ? c.text : color}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {label}
        </text>
      ) : null}
    </svg>
  )
}

export function FolderIcon({ color }: { color: string }): JSX.Element {
  return <FolderFill size={ROW_ICON} color={color} />
}
