"""Round eight: the three kinds that were never picked.

CODE was chosen in round seven and is being replaced. DOCUMENT shipped marked
"provisional: this kind is not settled" and was never actually chosen. COMIC
was drawn when the comic reader landed and nobody picked it either. So all
three get a proper round, six directions each.

Everything is on the 16ths grid, so nothing lands between pixels at 16px, and
every size is DRAWN at that size rather than downsampled from one big render.
16px is the size that decides it: details view is what most people look at all
day, and it is the frame every round is judged on.
"""
from PIL import Image, ImageDraw

from round5 import g
from round7 import TILED, canvas, finish


# ---------------------------------------------------------------- code
def code_braces(d, n, p):
    """{ } - the mark every editor's own icon reaches for."""
    w = int(g(n, 1.7))
    for x0, x1, col in ((5.6, 2.6, p.body), (10.4, 13.4, p.accent)):
        d.line(
            [
                (g(n, x0), g(n, 3.2)),
                (g(n, x1), g(n, 5.4)),
                (g(n, x1), g(n, 7.2)),
                (g(n, x0 + (x1 - x0) * 1.35), g(n, 8)),
                (g(n, x1), g(n, 8.8)),
                (g(n, x1), g(n, 10.6)),
                (g(n, x0), g(n, 12.8)),
            ],
            fill=col,
            width=w,
            joint="curve",
        )


def code_prompt(d, n, p):
    """A shell prompt: the chevron and the cursor under it."""
    w = int(g(n, 2.0))
    d.line(
        [(g(n, 2.4), g(n, 3.6)), (g(n, 7.2), g(n, 7.6)), (g(n, 2.4), g(n, 11.6))],
        fill=p.body,
        width=w,
        joint="curve",
    )
    d.rounded_rectangle(
        [g(n, 8.6), g(n, 10.2), g(n, 14.2), g(n, 12.4)], radius=g(n, 0.5), fill=p.accent
    )


def code_indent(d, n, p):
    """The shape of code itself: nested lines, indented."""
    rows = ((1.6, 9.5, "body"), (4.2, 13.4, "accent"), (4.2, 11.0, "body"), (1.6, 7.4, "body"))
    for i, (x0, x1, which) in enumerate(rows):
        y = g(n, 3.0 + i * 2.8)
        d.rounded_rectangle(
            [g(n, x0), y, g(n, x1), y + g(n, 1.7)],
            radius=g(n, 0.85),
            fill=p.accent if which == "accent" else p.body,
        )


def code_tag(d, n, p):
    """</> - the chevrons with the slash that makes them mean source."""
    w = int(g(n, 1.8))
    d.line(
        [(g(n, 5.6), g(n, 3.8)), (g(n, 1.8), g(n, 8)), (g(n, 5.6), g(n, 12.2))],
        fill=p.body,
        width=w,
        joint="curve",
    )
    d.line(
        [(g(n, 10.4), g(n, 3.8)), (g(n, 14.2), g(n, 8)), (g(n, 10.4), g(n, 12.2))],
        fill=p.body,
        width=w,
        joint="curve",
    )
    d.line([(g(n, 9.3), g(n, 2.8)), (g(n, 6.7), g(n, 13.2))], fill=p.accent, width=w)


def code_page(d, n, p):
    """A page of code: the file, with what is in it."""
    d.rounded_rectangle([g(n, 2.2), g(n, 1.4), g(n, 13.8), g(n, 14.6)], radius=g(n, 1.0), fill=p.body)
    rows = ((3.9, 9.5, False), (5.6, 12.1, True), (5.6, 10.3, False), (3.9, 8.2, False))
    for i, (x0, x1, hot) in enumerate(rows):
        y = g(n, 3.6 + i * 2.3)
        d.rounded_rectangle(
            [g(n, x0), y, g(n, x1), y + g(n, 1.2)],
            radius=g(n, 0.6),
            fill=p.accent if hot else p.ink,
        )


def code_block(d, n, p):
    """A window of code: the frame, a title bar, and lines."""
    d.rounded_rectangle([g(n, 1.2), g(n, 2.6), g(n, 14.8), g(n, 13.4)], radius=g(n, 1.2), fill=p.body)
    d.rectangle([g(n, 1.2), g(n, 4.6), g(n, 14.8), g(n, 5.4)], fill=p.accent)
    d.ellipse([g(n, 2.4), g(n, 3.2), g(n, 3.6), g(n, 4.4)], fill=p.ink)
    for i, (x0, x1) in enumerate(((3.0, 9.0), (5.0, 12.4), (3.0, 7.6))):
        y = g(n, 6.6 + i * 2.2)
        d.rounded_rectangle([g(n, x0), y, g(n, x1), y + g(n, 1.2)], radius=g(n, 0.6), fill=p.ink)


# ------------------------------------------------------------ document
def doc_header(d, n, p):
    """What ships today: a page with a coloured header band."""
    d.rounded_rectangle([g(n, 2.5), g(n, 1.5), g(n, 13.5), g(n, 14.5)], radius=g(n, 0.9), fill=p.body)
    d.rounded_rectangle([g(n, 2.5), g(n, 1.5), g(n, 13.5), g(n, 5)], radius=g(n, 0.9), fill=p.accent)
    d.rectangle([g(n, 2.5), g(n, 4), g(n, 13.5), g(n, 5)], fill=p.accent)
    for i in range(4):
        y = g(n, 6.5 + i * 1.9)
        d.rounded_rectangle([g(n, 4.5), y, g(n, 11.5), y + g(n, 1)], radius=g(n, 0.3), fill=p.ink)


def doc_fold(d, n, p):
    """A page with its corner turned: the oldest document mark there is."""
    d.polygon(
        [
            (g(n, 2.6), g(n, 1.4)),
            (g(n, 10.2), g(n, 1.4)),
            (g(n, 13.4), g(n, 4.9)),
            (g(n, 13.4), g(n, 14.6)),
            (g(n, 2.6), g(n, 14.6)),
        ],
        fill=p.body,
    )
    d.polygon(
        [(g(n, 10.2), g(n, 1.4)), (g(n, 13.4), g(n, 4.9)), (g(n, 10.2), g(n, 4.9))], fill=p.accent
    )
    for i in range(3):
        y = g(n, 7.4 + i * 2.3)
        d.rounded_rectangle([g(n, 4.6), y, g(n, 11.4), y + g(n, 1.2)], radius=g(n, 0.6), fill=p.ink)


def doc_title(d, n, p):
    """A page whose first line is its title, in the accent."""
    d.rounded_rectangle([g(n, 2.6), g(n, 1.4), g(n, 13.4), g(n, 14.6)], radius=g(n, 1.0), fill=p.body)
    d.rounded_rectangle([g(n, 4.4), g(n, 3.8), g(n, 10.4), g(n, 5.4)], radius=g(n, 0.8), fill=p.accent)
    for i in range(3):
        y = g(n, 7.4 + i * 2.3)
        d.rounded_rectangle([g(n, 4.4), y, g(n, 11.6), y + g(n, 1.2)], radius=g(n, 0.6), fill=p.ink)


def doc_stack(d, n, p):
    """Two pages: a document is rarely one sheet."""
    d.rounded_rectangle([g(n, 5.0), g(n, 1.4), g(n, 14.4), g(n, 12.2)], radius=g(n, 1.0), fill=p.accent)
    d.rounded_rectangle([g(n, 1.6), g(n, 3.8), g(n, 11.0), g(n, 14.6)], radius=g(n, 1.0), fill=p.body)
    for i in range(3):
        y = g(n, 6.2 + i * 2.3)
        d.rounded_rectangle([g(n, 3.4), y, g(n, 9.2), y + g(n, 1.2)], radius=g(n, 0.6), fill=p.ink)


def doc_book(d, n, p):
    """An open book: the epub half of this kind, not just the docx half."""
    d.polygon(
        [(g(n, 1.2), g(n, 3.4)), (g(n, 7.6), g(n, 4.8)), (g(n, 7.6), g(n, 14.0)), (g(n, 1.2), g(n, 12.6))],
        fill=p.body,
    )
    d.polygon(
        [(g(n, 14.8), g(n, 3.4)), (g(n, 8.4), g(n, 4.8)), (g(n, 8.4), g(n, 14.0)), (g(n, 14.8), g(n, 12.6))],
        fill=p.accent,
    )
    for i in range(2):
        y = g(n, 7.2 + i * 2.4)
        d.rounded_rectangle([g(n, 2.6), y, g(n, 6.4), y + g(n, 1.1)], radius=g(n, 0.55), fill=p.ink)


def doc_bound(d, n, p):
    """A bound report: the page, with its spine down the left."""
    d.rounded_rectangle([g(n, 2.2), g(n, 1.4), g(n, 13.8), g(n, 14.6)], radius=g(n, 1.0), fill=p.body)
    d.rounded_rectangle([g(n, 2.2), g(n, 1.4), g(n, 5.2), g(n, 14.6)], radius=g(n, 1.0), fill=p.accent)
    d.rectangle([g(n, 4.2), g(n, 1.4), g(n, 5.2), g(n, 14.6)], fill=p.accent)
    for i in range(4):
        y = g(n, 4.0 + i * 2.4)
        d.rounded_rectangle([g(n, 6.6), y, g(n, 12.0), y + g(n, 1.2)], radius=g(n, 0.6), fill=p.ink)


# --------------------------------------------------------------- comic
def comic_stack(d, n, p):
    """What ships today: a page behind, a picture on the front."""
    d.rounded_rectangle([g(n, 4), g(n, 1.5), g(n, 15), g(n, 12.5)], radius=g(n, 0.9), fill=p.accent)
    d.rounded_rectangle([g(n, 1), g(n, 3.5), g(n, 12), g(n, 14.5)], radius=g(n, 0.9), fill=p.body)
    d.ellipse([g(n, 8), g(n, 5.4), g(n, 10.3), g(n, 7.7)], fill=p.accent)
    d.polygon([(g(n, 2.2), g(n, 12.6)), (g(n, 5.4), g(n, 7.4)), (g(n, 8.6), g(n, 12.6))], fill=p.ink)
    d.polygon([(g(n, 6.9), g(n, 12.6)), (g(n, 9.1), g(n, 9.0)), (g(n, 11.0), g(n, 12.6))], fill=p.ink)


def comic_panels(d, n, p):
    """The panel grid: what a comic page actually looks like."""
    d.rounded_rectangle([g(n, 1.4), g(n, 1.4), g(n, 14.6), g(n, 14.6)], radius=g(n, 1.0), fill=p.body)
    d.rectangle([g(n, 3.0), g(n, 3.0), g(n, 13.0), g(n, 6.8)], fill=p.accent)
    d.rectangle([g(n, 3.0), g(n, 8.2), g(n, 7.6), g(n, 13.0)], fill=p.ink)
    d.rectangle([g(n, 8.8), g(n, 8.2), g(n, 13.0), g(n, 13.0)], fill=p.ink)


def comic_bubble(d, n, p):
    """A speech bubble: the one mark nothing else in the app could be."""
    d.rounded_rectangle([g(n, 1.4), g(n, 2.4), g(n, 14.6), g(n, 11.4)], radius=g(n, 2.4), fill=p.body)
    d.polygon(
        [(g(n, 4.4), g(n, 10.4)), (g(n, 4.4), g(n, 15.0)), (g(n, 9.0), g(n, 11.0))], fill=p.body
    )
    for i, (x0, x1) in enumerate(((3.6, 12.4), (3.6, 9.6))):
        y = g(n, 5.0 + i * 2.6)
        d.rounded_rectangle(
            [g(n, x0), y, g(n, x1), y + g(n, 1.4)], radius=g(n, 0.7), fill=p.accent if i == 0 else p.ink
        )


def comic_bubble_page(d, n, p):
    """A page with a bubble on it: a picture that talks."""
    d.rounded_rectangle([g(n, 2.2), g(n, 1.4), g(n, 13.8), g(n, 14.6)], radius=g(n, 1.0), fill=p.body)
    d.rounded_rectangle([g(n, 3.8), g(n, 3.0), g(n, 12.2), g(n, 8.4)], radius=g(n, 1.6), fill=p.accent)
    d.polygon([(g(n, 5.6), g(n, 7.8)), (g(n, 5.6), g(n, 11.0)), (g(n, 8.6), g(n, 8.2))], fill=p.accent)
    d.rounded_rectangle([g(n, 3.8), g(n, 11.4), g(n, 10.4), g(n, 12.8)], radius=g(n, 0.7), fill=p.ink)


def comic_book(d, n, p):
    """A closed book with a picture cover: a comic is a book."""
    d.rounded_rectangle([g(n, 2.0), g(n, 1.6), g(n, 14.2), g(n, 14.4)], radius=g(n, 1.0), fill=p.body)
    d.rounded_rectangle([g(n, 2.0), g(n, 1.6), g(n, 4.4), g(n, 14.4)], radius=g(n, 1.0), fill=p.accent)
    d.rectangle([g(n, 3.4), g(n, 1.6), g(n, 4.4), g(n, 14.4)], fill=p.accent)
    d.ellipse([g(n, 10.4), g(n, 4.0), g(n, 12.6), g(n, 6.2)], fill=p.accent)
    d.polygon([(g(n, 5.6), g(n, 11.6)), (g(n, 8.6), g(n, 6.6)), (g(n, 11.6), g(n, 11.6))], fill=p.ink)
    d.polygon([(g(n, 9.8), g(n, 11.6)), (g(n, 11.6), g(n, 8.8)), (g(n, 13.2), g(n, 11.6))], fill=p.ink)


def comic_strip(d, n, p):
    """Three panels in a row: the newspaper strip, the oldest comic shape."""
    d.rounded_rectangle([g(n, 0.8), g(n, 3.4), g(n, 15.2), g(n, 12.6)], radius=g(n, 1.0), fill=p.body)
    for i, x in enumerate((2.2, 6.4, 10.6)):
        d.rectangle(
            [g(n, x), g(n, 4.8), g(n, x + 3.2), g(n, 11.2)], fill=p.accent if i == 1 else p.ink
        )


def _make(body_fn):
    def fn(size, p):
        img, _, n = canvas(size, p)
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        body_fn(ImageDraw.Draw(layer), n, p)
        return finish(img, size, p, layer)

    return fn


CANDIDATES = {
    "code": [
        ("braces", "{ } braces", _make(code_braces)),
        ("prompt", "shell prompt + cursor", _make(code_prompt)),
        ("indent", "indented lines", _make(code_indent)),
        ("tag", "</> tag", _make(code_tag)),
        ("page", "a page of code", _make(code_page)),
        ("block", "a code window", _make(code_block)),
    ],
    "document": [
        ("header", "header band (ships today)", _make(doc_header)),
        ("fold", "folded corner", _make(doc_fold)),
        ("title", "title line in accent", _make(doc_title)),
        ("stack", "two pages", _make(doc_stack)),
        ("book", "an open book", _make(doc_book)),
        ("bound", "bound down the spine", _make(doc_bound)),
    ],
    "comic": [
        ("stack", "stacked pages (ships today)", _make(comic_stack)),
        ("panels", "panel grid", _make(comic_panels)),
        ("bubble", "speech bubble", _make(comic_bubble)),
        ("bubblepage", "page with a bubble", _make(comic_bubble_page)),
        ("book", "book with a picture cover", _make(comic_book)),
        ("strip", "three-panel strip", _make(comic_strip)),
    ],
}

SIZES = (16, 20, 24, 32, 48)

FILENAMES = {"code": "build-hooks.ps1", "document": "Q3 report.docx", "comic": "American Dreams 01.cbz"}

SECTIONS = {
    "code": "Replacing the chevrons. Note that 5 and 6 are pages, which puts them close to the "
    "document icon two sections down.",
    "document": "Never actually chosen. What shipped was marked <em>provisional</em> in the source.",
    "comic": "Drawn when the comic reader landed and never put to anyone. 1 is what shipped.",
}


def main(out_dir):
    import pathlib

    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for kind, options in CANDIDATES.items():
        for key, _label, fn in options:
            for s in SIZES:
                fn(s, TILED).save(out / f"{kind}-{key}-{s}.png")
    print(f"{sum(len(v) for v in CANDIDATES.values()) * len(SIZES)} frames -> {out}")


if __name__ == "__main__":
    import sys

    main(sys.argv[1] if len(sys.argv) > 1 else "mockups")
