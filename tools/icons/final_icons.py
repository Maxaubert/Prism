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
from PIL import Image, ImageDraw

from icons import S
from round5 import g
from round12 import CHIP, INK, Kind, _spec, build, fold_points, on_page, page_mask
from round12 import lines as doc_lines
from round13 import clapper
from round14 import GLYPHS as R14
from round15 import _label_at, archive_layers, folder_zip, folder_zip_ink
from round17 import quarter
from round18 import CREAM, art_splat_bam
from round21 import framed
from round23 import bg_warm

# Where a page kind's mark sits, inset from the page. Derived, or every glyph
# would keep its old size inside a bigger page and the set would read emptier
# rather than bigger.
BOX = on_page((3.8, 7.0, 12.2, 14.0))
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
PAGE = (170, 178, 192)

COLOURS = {
    "archive": ("ZIP", PAGE),
    "audio": ("MP3", PAGE),
    "code": ("PY", PAGE),
    "comic": ("CBZ", (210, 96, 58)),
    "document": ("DOCX", PAGE),
    "image": ("JPG", PAGE),
    "video": ("MP4", PAGE),
}

# Prism's own accent. CODE is the second exception to the one page colour the
# other kinds share, after comic, and it exists to solve a real collision: code
# and document are both three rounded bars in the same box, so once the six went
# to a single page colour the silhouette was the only thing telling them apart,
# and at 16px that is nothing. One bar in the accent separates them without
# either glyph moving - and colour is the right axis for it, because hue
# survives downsampling where geometry does not.
CODE_ACCENT = (91, 91, 214)


def _code_bars(d, n, box, col, hole=None):
    """Stepped indent bars, the middle one in the accent and the rest in ink."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rows = ((0.00, 0.74, col), (0.22, 1.00, CODE_ACCENT), (0.00, 0.56, col))
    for i, (a, b, fill) in enumerate(rows):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=fill)


PAGE_GLYPHS = {
    "audio": quarter,
    "code": _code_bars,
    "document": doc_lines,
    "image": dict((k, f) for k, _l, f in R14["image"][2])["hills"],
    "video": clapper,
}


def _page_kind_with(kind, size, glyph):
    """A page kind rendered with an arbitrary glyph.

    Exists so a mockup round can try alternative marks through the REAL
    construction - this page, this chip, this label, this colour - rather than
    through a copy of it that can drift. `_page_kind` is this with the kind's
    own settled glyph.
    """
    ext, colour = COLOURS[kind]
    obj = Kind(kind, ext, colour, colour, "", glyph, glyph)
    spec = _spec(page=colour, fold=INK, band=INK, band_at="chip", glyph_col=INK,
                 glyph_box=BOX, text=ext, text_col=colour, sprocket=colour)
    return build(size, obj, spec)


def _page_kind(kind, size):
    """The five that are a page, a chip and one knocked-out glyph."""
    return _page_kind_with(kind, size, PAGE_GLYPHS[kind])


def _archive(kind, size):
    """A container, not a page, with the chip low so the folder tab shows."""
    ext, colour = COLOURS[kind]
    body, ink = archive_layers(size, folder_zip, folder_zip_ink, ext)
    out = Image.new("RGBA", body.size, (0, 0, 0, 0))
    out.paste(Image.new("RGBA", body.size, tuple(colour) + (255,)), (0, 0), body)
    out.alpha_composite(ink)
    return out


def _comic(kind, size):
    """Pop-art sunburst ground, BAM lettered into a splat, baked at 4x.

    Deliberately not the layered path the picker uses: compositing before the
    downsample rather than after avoids the edge fringing that resizing
    non-premultiplied alpha produces, and this file is the one that ships.
    """
    ext, colour = COLOURS[kind]
    n = size * S
    m = page_mask(n)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (n, n), tuple(colour) + (255,)), (0, 0), m)

    art = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    framed(bg_warm, art_splat_bam)(ImageDraw.Draw(art), n)
    out.alpha_composite(Image.composite(art, Image.new("RGBA", (n, n), (0, 0, 0, 0)), m))

    d = ImageDraw.Draw(out)
    d.polygon([(g(n, x), g(n, y)) for x, y in fold_points()], fill=INK_A)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), fill=INK_A)
    (tx, ty), f = _label_at(n, ext, CHIP)
    # Drawn, not knocked out: there is artwork behind the chip rather than one
    # flat colour, and where the chip overhangs the page there is nothing at
    # all, so a hole would read as a rip rather than as a word.
    d.text((tx, ty), ext, font=f, fill=CREAM + (255,), anchor="mm")
    return out.resize((size, size), Image.LANCZOS)


RENDER = {k: _page_kind for k in PAGE_GLYPHS}
RENDER["archive"] = _archive
RENDER["comic"] = _comic

# The seven filenames are load-bearing: the installer's ProgIDs point
# DefaultIcon at resources/icons/prism-<kind>.ico, so these names cannot move
# without src/shared/fileKind.ts and both macros in build/installer/assoc.nsh
# moving with them.
KINDS = sorted(COLOURS)


def render(kind, size):
    return RENDER[kind](kind, size)


if __name__ == "__main__":
    for k in KINDS:
        ext, col = COLOURS[k]
        print(f"{k:10} {ext:5} #{col[0]:02x}{col[1]:02x}{col[2]:02x}")
        _ = render(k, 16)
    print("all seven render")
