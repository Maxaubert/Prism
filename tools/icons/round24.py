"""Round twenty-four: code, because it collided with document the moment they shared a colour.

Both glyphs are THREE ROUNDED BARS in the same box. Code steps its middle bar
in and varies the lengths; document shortens its last one. That was a real
difference while the two icons were different colours - slate against teal, and
the colour did the telling. Now that the six share one page colour the
silhouette is all there is, and two sets of three horizontal bars are the same
picture.

So the brief is narrow: keep the style - flat, geometric, knocked out of the
page, no strokes - and break the SILHOUETTE. Three things do that, and the
candidates below are built from them:

  1. A NON-HORIZONTAL element. Chevrons, a caret, a slash, a brace. Anything
     that is not a horizontal bar reads as not-prose instantly, at any size.
  2. A VERTICAL SPINE. Bars hanging off an indent guide read as structure -
     a tree - where bars floating in a column read as text.
  3. TOKENS RATHER THAN LINES. A row broken into two or three short blocks
     with gaps in it is source; an unbroken row is a sentence.

Document is drawn beside every candidate in the sheet, because the question is
not "is this a good code icon" but "is this different enough from that one".

    python round24.py <outdir>
"""
import pathlib
import sys

from final_icons import COLOURS, _page_kind_with
from round12 import lines as doc_lines
from round5 import g

BOX_W, BOX_H = None, None   # taken from the box each glyph is handed


# ------------------------------------------------------------------- glyphs
def chevrons(d, n, box, col, hole=None):
    """Angle brackets. The most literal mark for code, and nothing like prose."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    t = w * 0.13
    for sgn, bx in ((1, x0 + w * 0.04), (-1, x1 - w * 0.04)):
        d.polygon([(g(n, bx), g(n, y0 + h * 0.5)),
                   (g(n, bx + sgn * w * 0.30), g(n, y0 + h * 0.06)),
                   (g(n, bx + sgn * (w * 0.30 + t)), g(n, y0 + h * 0.20)),
                   (g(n, bx + sgn * w * 0.16), g(n, y0 + h * 0.5)),
                   (g(n, bx + sgn * (w * 0.30 + t)), g(n, y0 + h * 0.80)),
                   (g(n, bx + sgn * w * 0.30), g(n, y1 - h * 0.06))], fill=col)


def chevron_slash(d, n, box, col, hole=None):
    """Brackets with a slash between them: the same, said harder."""
    chevrons(d, n, box, col, hole)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.polygon([(g(n, x0 + w * 0.60), g(n, y0)), (g(n, x0 + w * 0.74), g(n, y0)),
               (g(n, x0 + w * 0.40), g(n, y1)), (g(n, x0 + w * 0.26), g(n, y1))], fill=col)


def guide_bars(d, n, box, col, hole=None):
    """A vertical indent guide with rungs: structure, where document is prose."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + w * 0.13), g(n, y1)],
                        radius=g(n, w * 0.065), fill=col)
    for i, wide in enumerate((0.62, 0.86, 0.48)):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * 0.28), g(n, y),
                             g(n, x0 + w * (0.28 + wide * 0.72)), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=col)


def tokens(d, n, box, col, hole=None):
    """Rows broken into blocks. A row with gaps in it is source, not a sentence."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rows = (((0.00, 0.30), (0.40, 0.74)),
            ((0.18, 0.52), (0.62, 1.00)),
            ((0.00, 0.22), (0.32, 0.60)))
    for i, row in enumerate(rows):
        y = y0 + i * h * 0.37
        for a, b in row:
            d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                                radius=g(n, h * 0.07), fill=col)


def zigzag(d, n, box, col, hole=None):
    """The stepping, made unmistakable: a staircase rather than a nudge."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rows = ((0.00, 0.52), (0.34, 1.00), (0.14, 0.66))
    for i, (a, b) in enumerate(rows):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=col)


def nested(d, n, box, col, hole=None):
    """Four rows stepping in and back out: the shape of a block, not a paragraph."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rows = ((0.00, 0.56), (0.26, 0.86), (0.26, 0.68), (0.00, 0.40))
    for i, (a, b) in enumerate(rows):
        y = y0 + i * h * 0.265
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.185)],
                            radius=g(n, h * 0.05), fill=col)


def bars_caret(d, n, box, col, hole=None):
    """The shipped bars with a cursor block: one square breaks the rhythm."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rows = ((0.00, 0.62), (0.22, 0.80), (0.00, 0.44))
    for i, (a, b) in enumerate(rows):
        y = y0 + i * h * 0.37
        d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                            radius=g(n, h * 0.07), fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.88), g(n, y0 + h * 0.37),
                         g(n, x1), g(n, y0 + h * 0.63)], radius=g(n, h * 0.07), fill=col)


def prompt_bar(d, n, box, col, hole=None):
    """A prompt arrow and a line: the shape of a terminal, not a document."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    t = w * 0.15
    d.polygon([(g(n, x0), g(n, y0 + h * 0.10)),
               (g(n, x0 + w * 0.44), g(n, y0 + h * 0.50)),
               (g(n, x0), g(n, y1 - h * 0.10)),
               (g(n, x0), g(n, y1 - h * 0.10 - t * 1.5)),
               (g(n, x0 + w * 0.20), g(n, y0 + h * 0.50)),
               (g(n, x0), g(n, y0 + h * 0.10 + t * 1.5))], fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.56), g(n, y1 - h * 0.26), g(n, x1), g(n, y1)],
                        radius=g(n, h * 0.07), fill=col)


def braces_bars(d, n, box, col, hole=None):
    """A brace holding two lines: a block with its delimiter shown."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    arm, stem = w * 0.30, w * 0.11
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + arm), g(n, y1)],
                        radius=g(n, w * 0.10), fill=col)
    d.rectangle([g(n, x0 + stem), g(n, y0 + h * 0.20), g(n, x0 + arm + w * 0.06),
                 g(n, y1 - h * 0.20)], fill=hole)
    for i, wide in enumerate((0.98, 0.70)):
        y = y0 + h * (0.20 + i * 0.36)
        d.rounded_rectangle([g(n, x0 + w * 0.46), g(n, y),
                             g(n, x0 + w * 0.46 + (x1 - x0 - w * 0.46) * wide), g(n, y + h * 0.24)],
                            radius=g(n, h * 0.07), fill=col)


def bars_chevron(d, n, box, col, hole=None):
    """Two lines with a chevron pair beside them: text AND a mark."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    for i, wide in enumerate((0.56, 0.40)):
        y = y0 + h * (0.06 + i * 0.38)
        d.rounded_rectangle([g(n, x0), g(n, y), g(n, x0 + w * wide), g(n, y + h * 0.24)],
                            radius=g(n, h * 0.07), fill=col)
    t = w * 0.11
    for sgn, bx in ((1, x0 + w * 0.70), (-1, x1)):
        d.polygon([(g(n, bx), g(n, y0 + h * 0.72)),
                   (g(n, bx + sgn * w * 0.20), g(n, y0 + h * 0.42)),
                   (g(n, bx + sgn * (w * 0.20 + t)), g(n, y0 + h * 0.54)),
                   (g(n, bx + sgn * w * 0.10), g(n, y0 + h * 0.72)),
                   (g(n, bx + sgn * (w * 0.20 + t)), g(n, y0 + h * 0.90)),
                   (g(n, bx + sgn * w * 0.20), g(n, y1))], fill=col)


def slash_tokens(d, n, box, col, hole=None):
    """A comment slash over broken rows."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.polygon([(g(n, x0 + w * 0.30), g(n, y0)), (g(n, x0 + w * 0.46), g(n, y0)),
               (g(n, x0 + w * 0.20), g(n, y0 + h * 0.30)), (g(n, x0 + w * 0.04), g(n, y0 + h * 0.30))],
              fill=col)
    d.rounded_rectangle([g(n, x0 + w * 0.54), g(n, y0), g(n, x1), g(n, y0 + h * 0.22)],
                        radius=g(n, h * 0.06), fill=col)
    for i, row in enumerate((((0.00, 0.34), (0.44, 0.78)), ((0.20, 0.58), (0.68, 1.00)))):
        y = y0 + h * (0.42 + i * 0.32)
        for a, b in row:
            d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.22)],
                                radius=g(n, h * 0.06), fill=col)


def spine_tokens(d, n, box, col, hole=None):
    """A guide with broken rows: both differentiators at once."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x0 + w * 0.12), g(n, y1)],
                        radius=g(n, w * 0.06), fill=col)
    rows = (((0.26, 0.56), (0.66, 0.94)), ((0.40, 0.70),), ((0.26, 0.50), (0.60, 1.00)))
    for i, row in enumerate(rows):
        y = y0 + i * h * 0.37
        for a, b in row:
            d.rounded_rectangle([g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                                radius=g(n, h * 0.07), fill=col)


CANDS = [
    ("chevrons", "Angle brackets", chevrons),
    ("chevronslash", "Brackets and a slash", chevron_slash),
    ("guidebars", "Indent guide with rungs", guide_bars),
    ("spinetokens", "Guide with broken rows", spine_tokens),
    ("tokens", "Rows broken into blocks", tokens),
    ("zigzag", "A real staircase", zigzag),
    ("nested", "Four rows, in and back out", nested),
    ("barscaret", "Shipped bars plus a cursor", bars_caret),
    ("promptbar", "Prompt arrow and a line", prompt_bar),
    ("bracesbars", "A brace holding two lines", braces_bars),
    ("barschevron", "Two lines and a chevron pair", bars_chevron),
    ("slashtokens", "Comment slash over broken rows", slash_tokens),
]

SIZES = (16, 20, 24, 32, 48)
HERO = 96
CANDIDATES = {"code": [(k, l, (lambda s, F=fn: _page_kind_with("code", s, F)))
                       for k, l, fn in CANDS]}
CANDIDATES["code"].insert(
    0, ("shipped", "What ships now (the collision)",
        lambda s: _page_kind_with("code", s, __import__("round14").GLYPHS["code"][2][0][2])))
CANDIDATES["document"] = [("document", "Document, for comparison",
                           lambda s: _page_kind_with("document", s, doc_lines))]
FILENAMES = {"code": "server.py", "document": "contract.docx"}
SECTIONS = {
    "code": "Code, against the document icon it now collides with. Both are "
            "three rounded bars in the same box and the same colour, so the "
            "silhouette is all there is to tell them apart. Candidate 1 is what "
            "ships today - look at it beside the document card first.",
    "document": "Unchanged, and here only as the thing to differ from.",
}


def caption(kind, key):
    from round12 import contrast_note
    for k, _l, fn in CANDIDATES[kind]:
        if k == key:
            return contrast_note(fn(16))
    return ""


def main(out_dir):
    out = pathlib.Path(out_dir) / "round24"
    out.mkdir(parents=True, exist_ok=True)
    for kind, cands in CANDIDATES.items():
        for key, _l, fn in cands:
            for s in SIZES + (HERO,):
                fn(s).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(c) for c in CANDIDATES.values())} renders -> {out}")
    print("code colour", COLOURS["code"][1])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
