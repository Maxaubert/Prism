"""The settled icon set: one definition per kind, and the only thing build_icons reads.

Every choice here was made by the owner across rounds twelve to twenty-three.
The construction they all share:

    a PAGE silhouette (10 by 13 units, A4's proportion, measured off his own
    reference images), a folded corner, a black CHIP overhanging the top-left
    carrying the file's EXTENSION, and one flat glyph knocked out of the page.

Two colours and no outline. Every mark is drawn ON a solid shape and every
knockout is an ABSENCE of ink rather than a third colour, which is what lets a
mid-tone page carry the contrast on Explorer light and dark alike without the
near-black tile the old set needed. ARCHIVE breaks the page silhouette on
purpose - a zip is a container, not a sheet, so it is a landscape folder with
the chip moved LOW, because a chip over the top hides the tab that says
"folder". COMIC breaks the two-colour rule on purpose - it carries pop-art
artwork, so it is the one kind whose label is drawn rather than knocked out.

EVERYTHING IS BAKED, not layered. The picker sheet composites in the browser
after downsampling because it has to tint live; here the composite happens at
4x and is downsampled once, which is the better of the two and the reason the
shipped file can differ from the picker by a pixel edge.

IMAGE IS PURE WHITE by explicit owner pick, and it measures 1.07:1 against
Explorer's light ground: the page silhouette is invisible there and only the
chip and glyph read. He was shown that number live while choosing and chose it
anyway. Recorded here so it is never "fixed" as a bug by someone who was not in
the room.
"""
from PIL import Image, ImageDraw, ImageFilter

from icons import S
from round5 import g
from round12 import (CHIP, INK, PX0, PX1, PY1, Kind, _spec, build, fold_points,
                     on_page, page_mask)
from round12 import lines as doc_lines
from round13 import clapper
from round14 import GLYPHS as R14
from round15 import _label_at, archive_layers, folder_zip, folder_zip_ink
from round17 import quarter
from round18 import CREAM, art_splat_bam
from round21 import framed
from round23 import bg_warm

import extmap
import langs

# Where a page kind's mark sits, inset from the page. Derived, or every glyph
# would keep its old size inside a bigger page and the set would read emptier
# rather than bigger.
#
# IT SITS HIGHER SINCE THE BAND (2026-09-01): the label used to be a tab in the
# top-left corner and the mark had the rest of the page; now the label is a band
# across the FOOT, so the mark is raised out of its way. That is the whole point
# of the change rather than a consequence of it - a label that takes room has to
# be given room, and the alternative is the collision round 28 was full of.
BOX = on_page((3.8, 3.8, 12.2, 10.2))
INK_A = tuple(INK) + (255,)

# kind -> (extension shown on the chip, page colour)
#
# ONE COLOUR FOR THE SIX (owner pick, 2026-08-31, off `repick.py`'s sheet): the
# page is #aab2c0 for archive, audio, code, document, image and video alike, so
# the KIND lives entirely in the silhouette, the mark and the extension on the
# chip - which is the same call the sidebar's icons already went through. Comic
# keeps its own, being artwork rather than one flat colour.
#
# Measured while choosing: 7.63:1 on Explorer's dark ground, 1.99:1 on its light
# one. The light figure is the one to know - it is quiet there, though well clear
# of the 1.07:1 the white image page used to manage, where the silhouette
# vanished outright and only the chip was left. The chip is near-black and the
# extension is knocked out of it, so the label carries on both grounds whatever
# the page does.
# The footer band the label sits in, the chip's own height at the page's foot.
# Named here because COMIC draws it by hand - it has artwork rather than a flat
# page under the label - while every other kind gets it from round12's
# `band_at="bottom"`.
BAND = (PX0, PY1 - (CHIP[3] - CHIP[1]), PX1, PY1)

PAGE = (170, 178, 192)
PAPER = (255, 255, 255)

# CODE, INVERTED (owner pick, round 27 candidate 13, 2026-09-01). It replaces
# the single indigo bar that had been doing this job: an accent bar told code
# from document, but it did it by adding a hue to one stripe, which is a detail,
# and a dark PAGE is not a detail - it is most of the icon.
#
# A DARK PAGE IS AN INVERSION, NOT A RECOLOUR, and that is the whole of the
# construction below. Three marks are drawn in INK everywhere else in the set:
# the fold, the chip, and the extension knocked out of the chip so the page
# shows through the letters. On a dark page all three vanish at once, and the
# naive recolour is an icon with no fold, no chip and no label. So code's fold
# and chip take the shared grey the other kinds use for their PAGE, and its
# label is drawn in the page colour rather than knocked out.
#
# The bars carry NO ACCENT (the same pick): three plain light stripes. Once the
# page is dark, hue is not what separates code from document any more - the
# ground is - and an indigo bar on top of that was one difference too many.
CODE_PAGE = (43, 48, 59)     # slate, light enough that the chip can sit on it
CODE_BARS = (233, 237, 247)  # brighter than the shared grey: these must carry at 16px
CODE_EDGE = (122, 132, 152)  # see _hairline - a dark page vanishes on a dark ground

COLOURS = {
    "archive": ("ZIP", PAGE),
    "audio": ("MP3", PAGE),
    # A DARK PAGE, because a code file is a dark editor and nothing else in the
    # set is one. It is also what finally separates code from document without
    # either glyph moving: they are the same three rounded bars in the same
    # box, and one being dark paper and the other white paper is a difference
    # that survives being 16 pixels across, where a shape difference does not.
    "code": ("PY", CODE_PAGE),
    "comic": ("CBZ", (210, 96, 58)),
    # PAPER, not the shared grey. A docx, a pdf, an xlsx and a pptx are all
    # sheets of paper, and Word shows one as white on a canvas that is not
    # white - so document is the third exception, after comic and code.
    "document": ("DOCX", PAPER),
    "image": ("JPG", PAGE),
    "video": ("MP4", PAGE),
}


def _code_bars_at(d, n, box, col, hole=None):
    """Stepped indent bars, all three the same, in whatever colour is given.

    It takes `col` rather than reaching for CODE_BARS itself: a glyph that
    ignores its colour argument works right up until something else is drawn in
    the same slot, and then that other thing comes out in the wrong colour with
    nothing to explain why.
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i, (a, b) in enumerate(((0.00, 0.74), (0.22, 1.00), (0.00, 0.56))):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=tuple(col))


PAGE_GLYPHS = {
    "audio": quarter,
    "code": _code_bars_at,
    "document": doc_lines,
    "image": dict((k, f) for k, _l, f in R14["image"][2])["hills"],
    "video": clapper,
}


# The boundary a page has against the canvas it sits on. Pure white measures
# 1.07:1 against Explorer's light ground, which means the SILHOUETTE disappears
# there and only the chip, the fold and the text lines are left floating. The
# hairline is what a page in Word actually has - white paper, a canvas that is
# not white, and an edge between them - and it is a light grey a third of a unit
# wide, not the heavy dark outline the set rejected.
PAPER_EDGE = (196, 201, 210)
EDGE_UNITS = 0.35


def _hairline(base, size, colour=PAPER_EDGE):
    """Lay a hairline along the page's own silhouette, in the given colour.

    Eroded from the page mask rather than drawn as a second shape, so it
    follows the rounded corners and the fold's diagonal exactly and cannot
    drift out of step with them.

    It serves BOTH directions now. White paper measures 1.07:1 on Explorer's
    light ground and needs a grey edge; the dark code page measures 1.23:1 on
    its DARK ground, which is the same failure pointed the other way, and needs
    a light one.
    """
    n = size * S
    m = page_mask(n)
    inner = m.filter(ImageFilter.MinFilter(2 * int(EDGE_UNITS * S) + 1))
    band = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    band.paste(Image.new("RGBA", (n, n), tuple(colour) + (255,)), (0, 0), m)
    band.paste(Image.new("RGBA", (n, n), (0, 0, 0, 0)), (0, 0), inner)
    out = base.copy()
    out.alpha_composite(band.resize((size, size), Image.LANCZOS))
    return out


def _document(kind, size, text=None):
    """A page kind, plus the hairline that keeps white paper visible on white."""
    return _hairline(_page_kind_with(kind, size, PAGE_GLYPHS[kind], text=text), size)


def _page_kind_with(kind, size, glyph, fold=INK, band=INK, label=None, mark=INK,
                    text=None):
    """A page kind rendered with an arbitrary glyph.

    Exists so a mockup round can try alternative marks through the REAL
    construction - this page, this band, this label, this colour - rather than
    through a copy of it that can drift. `_page_kind` is this with the kind's
    own settled glyph.

    THE LABEL IS A FOOTER BAND (owner pick, round 30, 2026-09-01), not the
    overhanging corner tab it was. `band_at="bottom"` is round12's own path and
    reference one's own treatment, so this is the composition coming back to
    where it started rather than a new one: the band is clipped to the page, so
    it takes the rounded bottom corners, and the extension is drawn across it.
    ARCHIVE keeps its low chip and is not a page kind; COMIC keeps its own,
    having artwork rather than paper under the label.

    `fold`, `band`, `label` and `mark` default to the set's rule - everything
    that is not the page in ink, the letters in the page colour - and exist for
    CODE, whose dark page would swallow all four.
    """
    ext, colour = COLOURS[kind]
    ext = ext.upper() if text is None else text.upper()
    obj = Kind(kind, ext, colour, colour, "", glyph, glyph)
    spec = _spec(page=colour, fold=fold, band=band, band_at="bottom", glyph_col=mark,
                 glyph_box=BOX, text=ext, text_col=label or colour, sprocket=colour)
    return build(size, obj, spec)


def _code(kind, size, text=None):
    """The dark page: light fold, light chip, the label drawn rather than cut.

    PAGE is the shared grey the other kinds wear, used here for the MARKS -
    which is the inversion in one line.
    """
    base = _page_kind_with(kind, size, PAGE_GLYPHS[kind], fold=PAGE, band=PAGE,
                           label=CODE_PAGE, mark=CODE_BARS, text=text)
    return _hairline(base, size, CODE_EDGE)


def _page_kind(kind, size, text=None):
    """The five that are a page, a band and one knocked-out glyph."""
    return _page_kind_with(kind, size, PAGE_GLYPHS[kind], text=text)


def _archive(kind, size, text=None):
    """A container, not a page, with the chip low so the folder tab shows."""
    ext, colour = COLOURS[kind]
    body, ink = archive_layers(size, folder_zip, folder_zip_ink,
                               ext.upper() if text is None else text.upper())
    out = Image.new("RGBA", body.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", body.size, tuple(colour) + (255,)), (0, 0), body)
    out.alpha_composite(ink)
    return out


def _comic(kind, size, text=None):
    """Pop-art sunburst ground, BAM lettered into a splat, baked at 4x.

    Deliberately not the layered path the picker uses: compositing before the
    downsample rather than after avoids the edge fringing that resizing
    non-premultiplied alpha produces, and this file is the one that ships.
    """
    ext, colour = COLOURS[kind]
    ext = ext.upper() if text is None else text.upper()
    n = size * S
    m = page_mask(n)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (n, n), tuple(colour) + (255,)), (0, 0), m)

    art = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    framed(bg_warm, art_splat_bam)(ImageDraw.Draw(art), n)
    out.alpha_composite(Image.composite(art, Image.new("RGBA", (n, n), (0, 0, 0, 0)), m))

    d = ImageDraw.Draw(out)
    d.polygon([(g(n, x), g(n, y)) for x, y in fold_points()], fill=INK_A)

    # The FOOTER BAND, like every other kind (2026-09-01). Comic kept the
    # top-left chip when the rest of the set moved, and it was the only icon
    # left wearing one - a set where six labels are at the foot and the seventh
    # is in the corner reads as an oversight rather than as an exception.
    # Clipped to the page, so it takes the rounded bottom corners the artwork
    # already has.
    band = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(band).rectangle(
        [g(n, BAND[0]), g(n, BAND[1]), g(n, BAND[2]), g(n, BAND[3])], fill=INK_A)
    out.alpha_composite(Image.composite(band, Image.new("RGBA", (n, n), (0, 0, 0, 0)), m))

    (tx, ty), f = _label_at(n, ext, BAND)
    # Drawn, not knocked out: there is ARTWORK behind the band rather than one
    # flat colour, so a hole would show the sunburst through the letters.
    d.text((tx, ty), ext, font=f, fill=CREAM + (255,), anchor="mm")
    return out.resize((size, size), Image.LANCZOS)


RENDER = {k: _page_kind for k in PAGE_GLYPHS}
RENDER["code"] = _code
RENDER["document"] = _document
RENDER["archive"] = _archive
RENDER["comic"] = _comic

# The seven filenames are load-bearing: the installer's ProgIDs point
# DefaultIcon at resources/icons/prism-<kind>.ico, so these names cannot move
# without src/shared/fileKind.ts and both macros in build/installer/assoc.nsh
# moving with them.
KINDS = sorted(COLOURS)




def render(kind, size, text=None):
    return RENDER[kind](kind, size, text=text)


def legacy(kind, size):
    """A kind icon with an EMPTY band, for the seven old ProgIDs.

    Those classes still exist so that an existing "always open with Prism"
    choice is not orphaned (see gen_assoc.LEGACY), and one of them can be the
    default for any of a hundred extensions - which is the whole reason the
    per-extension set exists. So they carry NO label rather than a wrong one:
    an empty band on a .log is honest, and PY on a .log is not.

    Anybody who re-picks Prism as the default gets the per-extension class and
    its true label; until then the shape is right and nothing lies.
    """
    return RENDER[kind](kind, size, text="")


# extension -> kind, read from fileKind.ts rather than restated. See extmap.
EXT_KIND = extmap.kinds()


def icon_for_ext(ext, size):
    """The icon for ONE extension: its kind's composition, its own label.

    AN .ico CARRIES ONE LABEL, so an icon shared by many extensions prints one
    of their names on all of them - `prism-code.ico` said PY on 130 extensions
    and `prism-image.ico` said JPG on 52, which is what the owner met when he
    asked why his .log files were labelled PY. One icon per extension is the
    only arrangement in which the band tells the truth, and this is it.

    CODE additionally picks up its language's mark where there is one, so a .py
    is snakes and a .rs is a cog; the rest keep the stepped bars, which is most
    of the 160 extensions the code kind covers.
    """
    kind = EXT_KIND[ext]
    if kind == "code":
        mark = langs.MARKS.get(langs.EXTS.get(ext))
        if mark is None:
            return _code(kind, size, text=ext)
        return _hairline(
            _page_kind_with(kind, size, mark, fold=PAGE, band=PAGE,
                            label=CODE_PAGE, mark=CODE_BARS, text=ext),
            size, CODE_EDGE)
    return RENDER[kind](kind, size, text=ext)


#: Every extension that gets its own .ico and its own ProgID.
ALL_EXTS = sorted(EXT_KIND)


if __name__ == "__main__":
    for k in KINDS:
        ext, col = COLOURS[k]
        print(f"{k:10} {ext:5} #{col[0]:02x}{col[1]:02x}{col[2]:02x}")
        _ = render(k, 16)
    print("all seven render")
