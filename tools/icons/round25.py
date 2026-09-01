"""Round twenty-five: code, told apart from document by SYNTAX COLOUR rather than by shape.

Round twenty-four tried to break the silhouette. This tries the other axis, and
it is the better one: colour the bars the way an editor colours source, and the
two icons stop being the same picture even when their shapes are identical.

The palette is PRISM'S OWN TWO by instruction - the indigo accent and the ink -
rather than an editor's purple, green and orange. Those were borrowed from
somebody else's theme and looked it. Two colours alternating is a rhythm rather
than a rainbow, and it still does the whole job, because what tells code from
document at 16px is that one of them has more than one hue in it at all.

Why it beats a shape change. At 16px a three-bar glyph and a three-bar glyph are
the same smudge whatever their rhythm - which is exactly what round
twenty-four's zigzag and nested candidates proved. But a MULTI-COLOURED smudge
and a single-colour smudge are still telling apart, because hue survives
downsampling where geometry does not. It is also the only differentiator here
that says something true: source IS coloured, and prose is not.

The cost, stated plainly: code becomes the SECOND exception to the one page
colour the other five share, after comic. That is the owner's call, not mine,
so the sheet includes the cheapest versions of the idea as well as the fullest -
candidate `one` changes a single bar and nothing else.

It also costs the in-app icon, which is monochrome by construction: syntax
colour cannot survive being painted in one ink, so in-app code would keep a
single-colour glyph and would need one of round twenty-four's shapes to stay
distinct there. Worth knowing before picking a colour-only answer.

    python round25.py <outdir>
"""
import pathlib
import sys

from round12 import INK, Kind, _spec, build
from round12 import lines as doc_lines
from round14 import GLYPHS as R14
from round24 import guide_bars, spine_tokens, tokens, zigzag
from round5 import g

from final_icons import BOX, COLOURS

PAGE = COLOURS["code"][1]          # the shared page colour, (170, 178, 192)
DARK_PAGE = (30, 33, 40)           # an editor window rather than a page

# PRISM'S OWN TWO, by instruction: the indigo accent and the ink. An editor's
# purple-green-orange was borrowed from somebody else's theme and looked it -
# these belong to the app, and two colours is a rhythm rather than a rainbow.
BLUE = (91, 91, 214)
BLACK = tuple(INK)
LIGHT_SET = [BLUE, BLACK, BLUE, BLACK]
ALT_SET = [BLACK, BLUE, BLACK, BLUE]
# On a dark page the ink disappears, so its partner there is the paper white.
DARK_SET = [BLUE, (233, 237, 247), BLUE, (233, 237, 247)]

INK_A = tuple(INK)
SHIPPED = dict((k, f) for k, _l, f in R14["code"][2])["bars"]


def _rows(d, n, box, rows, palette, radius=0.07):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i, (a, b) in enumerate(rows):
        y = y0 + i * h * (0.37 if len(rows) <= 3 else 0.265)
        hh = h * (0.26 if len(rows) <= 3 else 0.185)
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + hh)],
                            radius=g(n, h * radius), fill=palette[i % len(palette)])


def bars_syntax(palette):
    """The shipped stepped bars, each row its own colour."""
    def fn(d, n, box, col, hole=None):
        _rows(d, n, box, ((0.00, 0.74), (0.22, 1.00), (0.00, 0.56)), palette)
    return fn


def bars_one(d, n, box, col, hole=None):
    """The cheapest version: one bar indigo, the rest ink.

    Here because it is the smallest possible break from the one-colour rule -
    if this reads, nothing louder is needed.
    """
    _rows(d, n, box, ((0.00, 0.74), (0.22, 1.00), (0.00, 0.56)),
          [BLACK, BLUE, BLACK])


def bars_two(d, n, box, col, hole=None):
    """Indigo on the outside, ink in the middle."""
    _rows(d, n, box, ((0.00, 0.74), (0.22, 1.00), (0.00, 0.56)),
          [BLUE, BLACK, BLUE])


def tokens_syntax(palette):
    """Rows broken into tokens, each token its own colour: the fullest version."""
    def fn(d, n, box, col, hole=None):
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        rows = (((0.00, 0.30), (0.40, 0.74)),
                ((0.18, 0.52), (0.62, 1.00)),
                ((0.00, 0.22), (0.32, 0.60)))
        k = 0
        for i, row in enumerate(rows):
            y = y0 + i * h * 0.37
            for a, b in row:
                d.rounded_rectangle([g(n, x0 + w * a), g(n, y),
                                     g(n, x0 + w * b), g(n, y + h * 0.26)],
                                    radius=g(n, h * 0.07), fill=palette[k % len(palette)])
                k += 1
    return fn


def spine_syntax(d, n, box, col, hole=None):
    """An ink indent guide with coloured rungs: shape AND colour."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + w * 0.13), g(n, y1)],
                        radius=g(n, w * 0.065), fill=INK_A)
    for i, wide in enumerate((0.62, 0.86, 0.48)):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * 0.28), g(n, y),
                             g(n, x0 + w * (0.28 + wide * 0.72)), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=(BLUE, BLACK, BLUE)[i])


def nested_syntax(d, n, box, col, hole=None):
    """Four rows in and back out, coloured: a block of source."""
    _rows(d, n, box, ((0.00, 0.56), (0.26, 0.86), (0.26, 0.68), (0.00, 0.40)),
          [BLUE, BLACK, BLACK, BLUE], radius=0.05)


def _render(colour, glyph, ext="PY", size=48):
    obj = Kind("code", ext, colour, colour, "", glyph, glyph)
    spec = _spec(page=colour, fold=INK, band=INK, band_at="chip", glyph_col=INK,
                 glyph_box=BOX, text=ext, text_col=colour, sprocket=colour)
    return build(size, obj, spec)


CANDS = [
    ("shipped", "What ships now, monochrome", PAGE, SHIPPED),
    ("one", "One bar coloured, the rest ink", PAGE, bars_one),
    ("two", "Two coloured, one ink", PAGE, bars_two),
    ("bars", "Bars alternating indigo and ink", PAGE, bars_syntax(LIGHT_SET)),
    ("barsalt", "The same, starting on ink", PAGE, bars_syntax(ALT_SET)),
    ("tokens", "Broken rows, indigo and ink", PAGE, tokens_syntax(LIGHT_SET)),
    ("tokensalt", "Broken rows, starting on ink", PAGE, tokens_syntax(ALT_SET)),
    ("spine", "Ink guide, coloured rungs", PAGE, spine_syntax),
    ("nested", "Four rows, coloured", PAGE, nested_syntax),
    ("editor", "Dark page, indigo and paper", DARK_PAGE, bars_syntax(DARK_SET)),
    ("editortokens", "Dark page, broken rows", DARK_PAGE, tokens_syntax(DARK_SET)),
    ("shape", "Round 24's guide, monochrome (shape answer)", PAGE, guide_bars),
]

SIZES = (16, 20, 24, 32, 48)
HERO = 96
CANDIDATES = {
    "code": [(k, l, (lambda s, C=c, F=f: _render(C, F, "PY", s))) for k, l, c, f in CANDS],
    "document": [("document", "Document, for comparison",
                  lambda s: _render(PAGE, doc_lines, "DOCX", s))],
}
FILENAMES = {"code": "server.py", "document": "contract.docx"}
SECTIONS = {
    "code": "Syntax colour instead of a shape change. Candidate 1 is today's "
            "collision; 2 and 3 are the cheapest possible break from the shared "
            "page colour; 10 and 11 make the page itself an editor window. The "
            "last one is round twenty-four's shape answer, monochrome, for the "
            "direct comparison.",
    "document": "Unchanged, and here only as the thing to differ from.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round25"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} renders -> {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
