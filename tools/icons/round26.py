"""Round twenty-six: document becomes PAPER - a white sheet, the way Word shows one.

The owner's note: docx, pdf and the other kinds that are really documents should
sit on a paper-like white background rather than the grey the six share, so they
read the way a page reads in Word.

Two things follow from it, and the second is the reason this sheet also carries
the code icon.

WHITE HAS A MEASURED PROBLEM ON EXPLORER LIGHT. Pure #ffffff scores 1.07:1
against #f7f7f7: the page's SILHOUETTE disappears there and only the chip, the
fold and the text lines read. That is not a guess - it is the same measurement
that was put in front of him when he chose white for the image icon, and he took
it knowingly. It is offered here as `white`, and beside it are the ways of
keeping paper while getting the outline back: a warmer or cooler off-white, and
a HAIRLINE EDGE, which is what a sheet of paper in Word actually has (the page
is white, the canvas around it is not, and there is a boundary). The hairline is
a paper edge rather than the heavy dark outline that was rejected for the set -
it is one pixel of light grey, drawn by eroding the page's own mask.

AND IT SETTLES THE CODE COLLISION FOR FREE. Code and document collided because
they are three rounded bars in one shared colour. If document is white paper and
code stays grey, they no longer share the colour, and the collision is gone
without touching either glyph. Every card here shows document beside code so
that can be judged rather than assumed - and if it holds, round twenty-five's
syntax colour becomes a thing to do because it is nice, not because it is
needed.

    python round26.py <outdir>
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter

from icons import S
from round12 import INK, Kind, _spec, build, contrast_note, page_mask
from round12 import lines as doc_lines
from round14 import GLYPHS as R14
from round5 import g

from final_icons import BOX, COLOURS

GREY = COLOURS["document"][1]          # the shared page colour today
WHITE = (255, 255, 255)
WARM = (247, 245, 238)                 # paper with a little age in it
COOL = (244, 246, 249)
EDGE = (196, 201, 210)                 # the boundary a page has against a canvas
SHIPPED_CODE = dict((k, f) for k, _l, f in R14["code"][2])["bars"]


def _paper(colour, edge=None, edge_units=0.35, glyph=doc_lines, ext="DOCX"):
    """A page kind, optionally with a hairline edge eroded from its own mask.

    The edge is drawn by filling the page in the EDGE colour and then laying the
    paper colour through an eroded copy of the same mask, so the border follows
    the silhouette exactly - the rounded corners and the fold's diagonal
    included - rather than being a second shape that has to be kept in step.
    """
    def render(size):
        base = build(size, Kind("document", ext, colour, colour, "", glyph, glyph),
                     _spec(page=colour, fold=INK, band=INK, band_at="chip",
                           glyph_col=INK, glyph_box=BOX, text=ext, text_col=colour,
                           sprocket=colour))
        if edge is None:
            return base
        n = size * S
        m = page_mask(n)
        k = 2 * int(edge_units * S) + 1
        inner = m.filter(ImageFilter.MinFilter(k))
        band = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        band.paste(Image.new("RGBA", (n, n), tuple(edge) + (255,)), (0, 0), m)
        band.paste(Image.new("RGBA", (n, n), (0, 0, 0, 0)), (0, 0), inner)
        out = base.copy()
        out.alpha_composite(band.resize((size, size), Image.LANCZOS))
        return out
    return render


def _code(colour=GREY, glyph=SHIPPED_CODE):
    def render(size):
        return build(size, Kind("code", "PY", colour, colour, "", glyph, glyph),
                     _spec(page=colour, fold=INK, band=INK, band_at="chip",
                           glyph_col=INK, glyph_box=BOX, text="PY", text_col=colour,
                           sprocket=colour))
    return render


CANDS = [
    ("grey", "Grey, what ships now", _paper(GREY)),
    ("white", "Pure white  (1.07:1 on Explorer light)", _paper(WHITE)),
    ("whiteedge", "White with a hairline edge", _paper(WHITE, EDGE)),
    ("whiteedge2", "White, a heavier hairline", _paper(WHITE, EDGE, 0.6)),
    ("warm", "Warm paper, no edge", _paper(WARM)),
    ("warmedge", "Warm paper with a hairline", _paper(WARM, EDGE)),
    ("cool", "Cool paper, no edge", _paper(COOL)),
    ("cooledge", "Cool paper with a hairline", _paper(COOL, EDGE)),
]

SIZES = (16, 20, 24, 32, 48)
HERO = 96
CANDIDATES = {
    "document": [(k, l, fn) for k, l, fn in CANDS],
    "code": [("code", "Code, unchanged and grey - the thing document must differ from",
              _code())],
}
FILENAMES = {"document": "contract.docx", "code": "server.py"}
SECTIONS = {
    "document": "Paper rather than the shared grey. Every card is shown on both "
                "Explorer grounds, because white is exactly where the light one "
                "bites: the footer prints the measured ratio for each. The "
                "hairline versions are what a page in Word actually has - white "
                "paper, a canvas that is not white, and a boundary between them.",
    "code": "Unchanged. If document becomes paper, this stops colliding with it "
            "without either glyph moving.",
}


def caption(kind, key):
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round26"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} renders -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
