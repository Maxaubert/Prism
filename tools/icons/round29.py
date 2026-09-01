"""Round 29: TWELVE WAYS TO SET THE EXTENSION, each a whole composition.

Round 28 asked how big the banner should be and answered its own question
badly: past about 115% the chip lands on the fold or eats the glyph, because
the icon is a fixed frame and a bigger label has to take the room from
something. Scaling one part of a composition is not a design choice, it is a
collision waiting to happen.

So this round changes the STYLE instead, and every candidate is laid out as a
whole: when the label moves, THE GLYPH MOVES WITH IT. A footer band comes with
a glyph box raised out of its way, a header band with one dropped below it, a
spine with one narrowed beside it. Nothing here overlaps anything, at any size,
and that is the entry requirement rather than a bonus - a candidate that needs
the viewer to squint past a collision has already failed.

Everything else is held at what ships: the page silhouette, its colours, the
fold, the mark itself. Only the treatment of the extension moves.

THE LENGTH IS STILL THE TEST. Every card carries PY, MP3, WEBM and OPUS at
16px. Two characters and three keep their size and four steps down, so a style
judged on MP3 alone is judged on its easiest case - and a style whose room runs
out at four characters is a style that only works for the extensions it was
tried on.

    python round29.py <outdir>
"""
import base64
import pathlib
import sys
from io import BytesIO

from PIL import Image, ImageDraw

from final_icons import COLOURS, PAGE_GLYPHS
from icons import S
from round12 import CHIP, CUT, INK, PX0, PX1, PY0, PY1, draw_page, font, page_mask
from round5 import g

SIZES = (16, 24, 32, 48)
ZOOM = 96

# One kind for the whole round: the banner is identical on every icon, so
# asking seven times would be asking once and printing it seven ways. AUDIO -
# the shared grey page, and a mark distinctive enough that the label is clearly
# sitting on an ICON rather than on a rectangle.
PAGE = COLOURS["audio"][1]
GLYPH = PAGE_GLYPHS["audio"]
PAPER = (247, 248, 251)

LENGTHS = ("PY", "MP3", "WEBM", "OPUS")

INK_A = tuple(INK) + (255,)
PAGE_A = tuple(PAGE) + (255,)
PAPER_A = PAPER + (255,)

CH = CHIP[3] - CHIP[1]        # the shipped chip's height, 4.38 units
LEFT = CHIP[0]                # where its overhang reaches, 0.8

# The page's usable interior, inset from the silhouette by the same margin the
# shipped glyph box uses. Every candidate's layout is expressed against these
# rather than against absolute grid units, so the whole round moves together if
# the page is ever resized again.
IX0, IX1 = 3.88, 13.12
ITOP, IBOT = 2.05, 14.85


def fitted(n, text, box, height, fill):
    """The largest font that fits `text` into `box`, shrinking as the set does."""
    fh = (box[3] - box[1]) * height
    room = g(n, (box[2] - box[0]) * fill)
    f = font(g(n, fh))
    while f.getlength(text) > room and fh > 0.6:
        fh *= 0.92
        f = font(g(n, fh))
    return f


def put(d, n, text, box, colour, height=0.62, fill=0.86):
    """Set `text` centred in `box`, at the biggest size that fits."""
    f = fitted(n, text, box, height, fill)
    d.text((g(n, (box[0] + box[2]) / 2), g(n, (box[1] + box[3]) / 2)),
           text, font=f, fill=colour, anchor="mm")


def base(n, glyph_box):
    """Page, fold and mark. Every candidate starts here and adds its label."""
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw_page(img, n, PAGE, INK)
    mark = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    GLYPH(ImageDraw.Draw(mark), n, glyph_box, INK_A, PAGE)
    img.alpha_composite(Image.composite(
        mark, Image.new("RGBA", (n, n), (0, 0, 0, 0)), page_mask(n)))
    return img


def clipped(img, layer, n):
    """Lay `layer` on `img` through the page's own silhouette.

    Anything that belongs INSIDE the page goes through here, so a band picks up
    the rounded corners and the fold's diagonal instead of squaring them off.
    """
    img.alpha_composite(Image.composite(
        layer, Image.new("RGBA", (n, n), (0, 0, 0, 0)), page_mask(n)))


# --------------------------------------------------------------- the styles
# Each takes (img, n, text) and draws its own label. The glyph box that goes
# with it is declared beside it in STYLES, because the two are one decision.

def tab(img, n, text):
    """What ships: a near-black tab overhanging the page's top-left corner."""
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), fill=INK_A)
    put(d, n, text, CHIP, PAGE_A)


def header(img, n, text):
    """A band across the top of the page, stopping short of the fold.

    Full width would run under the dog-ear and cut its diagonal in half, which
    is the collision round 28's header band showed; ending at the cut is what
    makes the same idea work.
    """
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    box = (PX0, PY0, PX1 - CUT, PY0 + CH)
    ImageDraw.Draw(layer).rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                                    fill=INK_A)
    clipped(img, layer, n)
    put(ImageDraw.Draw(img), n, text, box, PAGE_A)


def footer(img, n, text):
    """A band across the foot of the page - reference one's own treatment."""
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    box = (PX0, PY1 - CH, PX1, PY1)
    ImageDraw.Draw(layer).rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                                    fill=INK_A)
    clipped(img, layer, n)
    put(ImageDraw.Draw(img), n, text, box, PAGE_A)


def ribbon(img, n, text):
    """A banner running past BOTH edges of the page rather than one.

    It sits BELOW the fold rather than across the top: a band wide enough to
    leave the page on both sides is wide enough to cut the dog-ear in half, and
    the dog-ear is what says the shape is a page at all.
    """
    d = ImageDraw.Draw(img)
    box = (LEFT, PY0 + CUT, 16 - LEFT, PY0 + CUT + CH)
    d.rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])], fill=INK_A)
    put(d, n, text, box, PAGE_A)


def bookmark(img, n, text):
    """The tab with a notched tail, so it reads as a marker rather than a box."""
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = CHIP
    notch = (y1 - y0) * 0.42
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1 - notch), g(n, y1)],
                        radius=g(n, 0.7), fill=INK_A)
    d.polygon([(g(n, x1 - notch - 0.4), g(n, y0)), (g(n, x1), g(n, y0)),
               (g(n, x1 - notch), g(n, (y0 + y1) / 2)), (g(n, x1), g(n, y1)),
               (g(n, x1 - notch - 0.4), g(n, y1))], fill=INK_A)
    put(d, n, text, (x0, y0, x1 - notch, y1), PAGE_A)


def inverted(img, n, text):
    """A PAPER tab with ink letters: the same shape, the other way round."""
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), fill=PAPER_A)
    put(d, n, text, CHIP, INK_A)


def outline(img, n, text):
    """A keyline tab: the letters and the rule in ink, the page showing through."""
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([g(n, CHIP[0]), g(n, CHIP[1]), g(n, CHIP[2]), g(n, CHIP[3])],
                        radius=g(n, 0.7), outline=INK_A, width=max(1, int(g(n, 0.4))))
    put(d, n, text, CHIP, INK_A, height=0.52, fill=0.78)


def bare(img, n, text):
    """No container at all: the extension set on the paper, in ink.

    Its measure stops at the fold, not at the page's edge. With nothing behind
    the letters there is nothing to keep them off the dog-ear, and a W landing
    on that diagonal reads as damage rather than as a serif.
    """
    put(ImageDraw.Draw(img), n, text, (IX0, ITOP, PX1 - CUT, ITOP + CH), INK_A,
        height=0.74, fill=0.92)


def ruled(img, n, text):
    """Bare type with a rule under it, which is what gives it an edge to sit on."""
    d = ImageDraw.Draw(img)
    # The type stops at the fold for the same reason `bare` does; the RULE runs
    # the full measure, since a rule under the dog-ear is a rule, not damage.
    box = (IX0, ITOP, PX1 - CUT, ITOP + CH * 0.86)
    put(d, n, text, box, INK_A, height=0.78, fill=0.92)
    d.rectangle([g(n, IX0), g(n, box[3]), g(n, IX1), g(n, box[3] + 0.38)], fill=INK_A)


def foot_tab(img, n, text):
    """A tab at the BOTTOM-left, overhanging, the way a folder's does."""
    d = ImageDraw.Draw(img)
    box = (LEFT, PY1 - CH - 0.6, LEFT + (CHIP[2] - CHIP[0]), PY1 - 0.6)
    d.rounded_rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                        radius=g(n, 0.7), fill=INK_A)
    put(d, n, text, box, PAGE_A)


def spine(img, n, text):
    """A strip down the page's left edge, the letters turned with it."""
    box = (PX0, PY0, PX0 + CH * 0.92, PY1)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                                    fill=INK_A)
    clipped(img, layer, n)

    # Drawn FLAT into a tile the strip's own shape, then turned - the same face
    # and the same shrink-to-fit as every other candidate, rather than a second
    # way of setting type that could differ from them by accident.
    x0, y0, x1, y1 = (g(n, v) for v in box)
    w, h = max(1, int(round(x1 - x0))), max(1, int(round(y1 - y0)))
    tile = Image.new("RGBA", (h, w), (0, 0, 0, 0))
    fh = w * 0.60
    f = font(fh)
    while f.getlength(text) > h * 0.80 and fh > 2:
        fh *= 0.92
        f = font(fh)
    ImageDraw.Draw(tile).text((h / 2, w / 2), text, font=f, fill=PAGE_A, anchor="mm")
    img.alpha_composite(tile.rotate(90, expand=True), (int(round(x0)), int(round(y0))))


def corner(img, n, text):
    """A square badge tucked into the page's top-left, no overhang at all."""
    d = ImageDraw.Draw(img)
    box = (IX0 - 0.5, ITOP - 0.5, IX0 - 0.5 + CH * 1.55, ITOP - 0.5 + CH)
    d.rounded_rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                        radius=g(n, 0.7), fill=INK_A)
    put(d, n, text, box, PAGE_A, height=0.58, fill=0.88)


# The glyph box that belongs with each style. THE POINT OF THE ROUND: a label
# that takes room gives the mark somewhere else to be, rather than sitting on
# top of it.
LOW = (IX0, 6.77, IX1, IBOT)          # what ships: the mark under a top tab
HIGH = (IX0, 3.10, IX1, 10.60)        # a footer band takes the bottom
NARROW = (IX0 + CH * 0.92, 5.20, IX1, IBOT - 0.8)   # a spine takes the left
BELOW = (IX0, 9.20, IX1, IBOT)        # a ribbon sits lower than a tab does

STYLES = [
    ("tab", "The tab|what ships - a near-black tab overhanging the top-left", tab, LOW),
    ("header", "Header band|across the top, stopping at the fold", header, LOW),
    ("footer", "Footer band|across the foot, the mark raised out of its way",
     footer, HIGH),
    ("ribbon", "Ribbon|a banner past BOTH edges rather than one", ribbon, BELOW),
    ("bookmark", "Bookmark|the tab with a notched tail", bookmark, LOW),
    # Kept with its weakness named rather than left to be discovered: the part
    # of the tab that OVERHANGS has no page behind it, so on Explorer's light
    # ground it is white on near-white and the overhang simply stops existing.
    ("inverted", "Paper tab|ink on white - but the overhang vanishes on a light ground",
     inverted, LOW),
    ("outline", "Keyline tab|an outline - and past the page's edge it is the DESKTOP showing through",
     outline, LOW),
    ("bare", "No container|set straight on the paper, in ink", bare, LOW),
    ("ruled", "Type on a rule|bare, with an edge to sit on", ruled, LOW),
    ("foot_tab", "Foot tab|the same tab, at the bottom-left", foot_tab, HIGH),
    ("spine", "Spine|a strip down the left edge, the letters turned", spine, NARROW),
    ("corner", "Corner badge|tucked inside the page, no overhang", corner, LOW),
]


def icon(size, text, style, glyph_box):
    n = size * S
    img = base(n, glyph_box)
    style(img, n, text)
    return img.resize((size, size), Image.LANCZOS)


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


HEAD = """<meta charset="utf-8"><title>Prism icon labels, round 29</title>
<style>
 :root{color-scheme:dark;--bg:#141519;--panel:#1b1d22;--line:#2b2e36;--text:#e9edf7;
       --dim:#8b90a0;--accent:#7c7cf0}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--text);
      font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
 header{padding:28px 32px 4px}
 h1{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
 header p{margin:0 0 6px;color:var(--dim);max-width:76ch}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));
       gap:14px;padding:14px 32px 8px}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
       padding:14px 16px 16px}
 .name{display:flex;align-items:baseline;gap:9px;margin-bottom:11px}
 .num{display:grid;place-items:center;width:22px;height:22px;flex:0 0 auto;
      border-radius:6px;background:var(--accent);color:#0d0f16;
      font-size:12px;font-weight:750;font-variant-numeric:tabular-nums}
 .what{font-weight:600;line-height:1.32}
 .what small{display:block;font-weight:400;color:var(--dim);font-size:12.5px}
 .grounds{display:flex;gap:10px}
 .ground{flex:1;border:1px solid var(--line);border-radius:9px;padding:11px 12px}
 .dark{background:#202020}
 .light{background:#f7f7f7;border-color:#dcdcdc}
 .sizes{display:flex;align-items:flex-end;gap:13px;min-height:52px}
 .zooms{display:flex;gap:10px;margin-top:10px}
 .zooms > div{flex:1;border:1px solid var(--line);border-radius:9px;padding:8px}
 .row{display:flex;align-items:center;gap:7px;margin-top:10px;
      font:12px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
 .dark .row{color:#e6e6e6}.light .row{color:#1b1b1b}
 img{display:block}
 .zoom{image-rendering:pixelated}
 .lens{margin-top:11px;padding-top:10px;border-top:1px solid var(--line)}
 .lens .cap{color:var(--dim);font-size:11.5px;margin-bottom:6px}
 .lens .strip{display:flex;gap:14px;background:#202020;padding:8px 10px;
              border-radius:7px;flex-wrap:wrap}
 .lens .one{display:flex;align-items:center;gap:6px;
            font:12px "Segoe UI",system-ui;color:#e6e6e6}
 footer{color:var(--dim);padding:22px 32px 46px;max-width:78ch}
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for i, (key, label, style, box) in enumerate(STYLES, 1):
        made = {s: _png(icon(s, "MP3", style, box)) for s in SIZES}
        sizes = "".join(f'<img src="{made[s]}" width="{s}" height="{s}" alt="">'
                        for s in SIZES)
        grounds = "".join(
            f'<div class="ground {mode}"><div class="sizes">{sizes}</div>'
            f'<div class="row"><img src="{made[16]}" width="16" height="16" alt="">'
            f'interlude.mp3</div></div>' for mode in ("dark", "light"))
        zooms = "".join(
            f'<div class="{mode}"><img class="zoom" src="{made[16]}" '
            f'width="{ZOOM}" height="{ZOOM}" alt=""></div>' for mode in ("dark", "light"))
        strip = "".join(
            f'<span class="one"><img src="{_png(icon(16, t, style, box))}" '
            f'width="16" height="16" alt="">{t.lower()}</span>' for t in LENGTHS)
        head, sub = label.split("|")
        cards.append(f"""  <div class="card">
    <div class="name"><span class="num">{i}</span>
      <span class="what">{head}<small>{sub}</small></span></div>
    <div class="grounds">{grounds}</div>
    <div class="zooms">{zooms}</div>
    <div class="lens">
      <div class="cap">Two, three and four characters at 16px - the test it exists to pass</div>
      <div class="strip">{strip}</div>
    </div>
  </div>""")

    parts = [HEAD, """<header>
  <h1>Twelve ways to set the extension, round 29</h1>
  <p>Not twelve sizes of the same banner. Round 28 showed what that costs: past about
  115% the chip lands on the fold or eats the mark, because the icon is a fixed frame
  and a bigger label has to take the room from something.</p>
  <p>So each of these is laid out as a WHOLE composition - when the label moves, the mark
  moves with it. A footer band comes with the mark raised out of its way, a spine with the
  mark narrowed beside it. Nothing here overlaps anything at any size; that is the entry
  requirement, not a bonus.</p>
  <p>Judge it on the strip at the bottom of each card. PY, MP3, WEBM and OPUS at 16px is
  the real test, since two characters and three keep their size and four steps down. Pick
  by number.</p>
</header>""", '<div class="grid">', *cards, "</div>", """<footer>Everything but the label
  is held at what ships - the page, the fold, the colours and the mark itself. Every size
  is drawn at that size, never downsampled from one big render; the magnified frame is
  the real 16px one at 6x.</footer>"""]
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
