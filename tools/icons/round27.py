"""Round 27: CODE on a DARK page, because a code file is a dark editor.

The shipped code icon is the shared grey page with three stepped bars, the
middle one in Prism's indigo - the accent bar being what stops it reading as
document once the six kinds went to one page colour. This round asks the other
question: make the PAGE dark instead, the way every editor on the machine
looks, and let the bars be the light thing.

WHAT A DARK PAGE ACTUALLY COSTS, which is the thing to judge here rather than
the colour. Three marks on this icon are drawn in INK (near-black) and one of
them carries the file's extension:

    the FOLD   a near-black dog-ear, invisible on a near-black page
    the CHIP   a near-black rounded rect, likewise
    the LABEL  knocked out of the chip, so it shows the PAGE through it -
               which on a dark page is dark letters on a dark chip

So a dark page is not a recolour, it is an INVERSION, and every candidate here
has to answer the chip. Three answers are represented: invert it (a light chip
with dark letters), keep it dark and separate it from the page by lightness
alone, or let the accent carry it. A candidate that leaves the chip unreadable
is in the sheet on purpose - it is what the naive recolour looks like.

THE COLLISION TEST IS THE POINT OF THE SHEET. Code exists in its current form
because it and DOCUMENT are the same three rounded bars in the same box, and at
16px the silhouette alone cannot tell them apart. So every candidate is shown
beside the shipped document and audio icons at 16px: a code icon that is
beautiful alone and ambiguous in a folder listing has failed the only test that
matters.

    python round27.py <outdir>
"""
import base64
import pathlib
import sys
from io import BytesIO

from PIL import Image, ImageFilter

from final_icons import BOX, CODE_ACCENT, PAGE, render
from icons import S
from round12 import INK, Kind, _spec, build, page_mask
from round5 import g

SIZES = (16, 24, 32, 48)
ZOOM = 96

# The page darks on offer. Not one dark: an editor ground is a decision in
# itself, and #1b1d22 (Prism's own chrome), a cooler slate and an indigo-tinted
# one read differently at 16px, where a page is mostly one flat area.
NIGHT = (27, 29, 34)        # Prism's own near-black, matching the chip exactly
SLATE = (43, 48, 59)        # a step up, so the chip can still sit on it
DEEP = (34, 38, 56)         # indigo-tinted, the accent's own family
COAL = (24, 24, 27)         # neutral, the colour VS Code's dark+ actually is

LIGHT = PAGE                # the set's shared grey, as the light thing
PAPER = (233, 237, 247)     # brighter, for bars that have to carry at 16px
MINT = (126, 231, 135)      # a syntax green
AMBER = (230, 180, 88)      # a syntax amber


def bars(page, ink, accent, rows=None):
    """The stepped indent bars, with each row's colour given.

    Same geometry as the shipped glyph - this round is about COLOUR, and
    changing the shape at the same time would mean neither could be judged.
    """
    cols = rows or (ink, accent, ink)

    def draw(d, n, box, _col, _hole=None):
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        widths = ((0.00, 0.74), (0.22, 1.00), (0.00, 0.56))
        for i, ((a, b), fill) in enumerate(zip(widths, cols)):
            y = y0 + i * h * 0.37
            d.rounded_rectangle(
                [g(n, x0 + w * a), g(n, y), g(n, x0 + w * b), g(n, y + h * 0.26)],
                radius=g(n, h * 0.07), fill=tuple(fill))

    return draw


EDGE_UNITS = 0.35


def hairline(base, size, colour):
    """Lay a hairline along the page's own silhouette, in the given colour.

    The same trick document uses, pointed the other way. Document is white
    paper that vanishes on Explorer's LIGHT ground, so it carries a grey edge;
    a dark page vanishes on Explorer's DARK one for exactly the same reason,
    and wants a light edge. Eroded from the page mask rather than drawn as a
    second shape, so it follows the rounded corners and the fold's diagonal and
    cannot drift out of step with them.
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


def icon(size, page, glyph, chip, fold, text_col, edge=None):
    """One candidate at one size, drawn at that size."""
    obj = Kind("code", "PY", page, page, "", glyph, glyph)
    spec = _spec(page=page, fold=fold, band=chip, band_at="chip",
                 glyph_col=INK, glyph_box=BOX, text="PY", text_col=text_col,
                 sprocket=page)
    out = build(size, obj, spec)
    return hairline(out, size, edge) if edge else out


# The edge a dark page can carry, mirroring document's. A page at #1b1d22 on
# Explorer's #202020 ground measures 1.03:1 - the silhouette is simply not
# there, and only the bars and the chip are left floating, which is the exact
# failure the white document page had on the light ground.
EDGE = (122, 132, 152)

# (key, label, page, bar colours, chip, fold, label colour, edge or None)
#
# The label colour is what the extension is DRAWN in, and on a dark page it can
# no longer be "the page colour" the way the shipped set has it - that is the
# whole inversion.
CANDIDATES = [
    ("naive", "The naive recolour|dark page, everything else untouched",
     NIGHT, (LIGHT, CODE_ACCENT, LIGHT), INK, INK, NIGHT, None),
    ("inverted", "Inverted chip|light chip, dark letters",
     NIGHT, (LIGHT, CODE_ACCENT, LIGHT), LIGHT, LIGHT, NIGHT, None),
    ("inverted-edge", "Inverted chip, with an edge|the silhouette survives a dark ground",
     NIGHT, (LIGHT, CODE_ACCENT, LIGHT), LIGHT, LIGHT, NIGHT, EDGE),
    ("inverted-slate", "Inverted chip on slate|a page the chip can sit on",
     SLATE, (LIGHT, CODE_ACCENT, LIGHT), LIGHT, LIGHT, SLATE, None),
    ("slate-edge", "Slate, with an edge|the lighter dark, edged",
     SLATE, (LIGHT, CODE_ACCENT, LIGHT), LIGHT, LIGHT, SLATE, EDGE),
    ("accent-chip", "Accent chip|the indigo carries the label",
     NIGHT, (LIGHT, LIGHT, LIGHT), CODE_ACCENT, LIGHT, PAPER, None),
    ("accent-chip-edge", "Accent chip, with an edge|the same, made to hold its shape",
     NIGHT, (LIGHT, LIGHT, LIGHT), CODE_ACCENT, LIGHT, PAPER, EDGE),
    ("deep-accent", "Indigo-tinted page|accent chip, accent family throughout",
     DEEP, (PAPER, CODE_ACCENT, PAPER), CODE_ACCENT, PAPER, PAPER, None),
    ("syntax", "Syntax colours|indigo, green and amber, as an editor shows",
     COAL, (MINT, CODE_ACCENT, AMBER), LIGHT, LIGHT, COAL, None),
    ("syntax-edge", "Syntax colours, with an edge|the editor look, edged",
     COAL, (MINT, CODE_ACCENT, AMBER), LIGHT, LIGHT, COAL, EDGE),
    ("syntax-quiet", "Syntax, quieter|one coloured bar among two light ones",
     COAL, (PAPER, MINT, PAPER), LIGHT, LIGHT, COAL, EDGE),
    ("mono-accent", "All indigo bars|no second hue at all",
     NIGHT, (CODE_ACCENT, CODE_ACCENT, CODE_ACCENT), LIGHT, LIGHT, NIGHT, EDGE),
    ("light-bars", "No accent at all|dark page, plain light bars",
     SLATE, (PAPER, PAPER, PAPER), LIGHT, LIGHT, SLATE, EDGE),
    ("shipped", "What ships today|the light page, for comparison",
     PAGE, (INK, CODE_ACCENT, INK), INK, INK, PAGE, None),
]


def _lum(c):
    v = [x / 255 for x in c]
    v = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in v]
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]


def ratio(a, b):
    x, y = _lum(a), _lum(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


HEAD = """<meta charset="utf-8"><title>Prism code icon, round 27</title>
<style>
 :root{color-scheme:dark;--bg:#141519;--panel:#1b1d22;--line:#2b2e36;--text:#e9edf7;
       --dim:#8b90a0;--accent:#7c7cf0}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--text);
      font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
 header{padding:28px 32px 4px}
 h1{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
 header p{margin:0 0 6px;color:var(--dim);max-width:74ch}
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
 /* The magnified frame gets its OWN row rather than sitting in the ground
    beside the 48px: at 96px it is wider than half a card, and the two grounds
    side by side then overflow the card instead of fitting in it. */
 .zooms{display:flex;gap:10px;margin-top:10px}
 .zooms > div{flex:1;border:1px solid var(--line);border-radius:9px;padding:8px;
              display:flex;align-items:center;gap:10px}
 .zooms .cap{color:var(--dim);font-size:11px;line-height:1.35}
 .row{display:flex;align-items:center;gap:7px;margin-top:10px;
      font:12px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
 .dark .row{color:#e6e6e6}.light .row{color:#1b1b1b}
 img{display:block}
 .zoom{image-rendering:pixelated}
 .measure{margin-top:9px;color:var(--dim);font:11.5px ui-monospace,Consolas,monospace;
          font-variant-numeric:tabular-nums}
 .beside{margin-top:11px;padding-top:10px;border-top:1px solid var(--line)}
 .beside .cap{color:var(--dim);font-size:11.5px;margin-bottom:6px}
 .beside .strip{display:flex;gap:16px}
 .beside .one{display:flex;align-items:center;gap:6px;font:12px "Segoe UI",system-ui;
              color:#e6e6e6}
 .beside .strip{background:#202020;padding:8px 10px;border-radius:7px}
 footer{color:var(--dim);padding:22px 32px 46px;max-width:76ch}
 code{background:#262932;padding:1px 5px;border-radius:4px;font-size:12.5px}
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # The two it has to stay apart from, as they actually ship.
    others = {k: {s: _png(render(k, s)) for s in (16, 24)} for k in ("document", "audio")}

    cards = []
    for i, (key, label, page, rows, chip, fold, text_col, edge) in enumerate(CANDIDATES, 1):
        glyph = bars(page, rows[0], rows[1], rows)
        made = {s: icon(s, page, glyph, chip, fold, text_col, edge) for s in SIZES}
        srcs = {s: _png(made[s]) for s in SIZES}
        sizes = "".join(f'<img src="{srcs[s]}" width="{s}" height="{s}" alt="">' for s in SIZES)
        grounds = "".join(
            f'<div class="ground {mode}"><div class="sizes">{sizes}</div>'
            f'<div class="row"><img src="{srcs[16]}" width="16" height="16" alt="">'
            f'main.py</div></div>'
            for mode in ("dark", "light"))
        zooms = "".join(
            f'<div class="{mode}">'
            f'<img class="zoom" src="{srcs[16]}" width="{ZOOM}" height="{ZOOM}" alt="">'
            f'</div>'
            for mode in ("dark", "light"))
        head, sub = label.split("|")
        # What the PAGE measures against each Explorer ground, printed on the
        # card: the number is the whole reason a dark page is a decision rather
        # than a recolour, and it belongs where the choice is made.
        meas = (f"page #{page[0]:02x}{page[1]:02x}{page[2]:02x} - "
                f"{ratio(page, (32, 32, 32)):.2f}:1 on dark, "
                f"{ratio(page, (247, 247, 247)):.2f}:1 on light"
                + ("  + edge" if edge else ""))
        cards.append(f"""  <div class="card">
    <div class="name"><span class="num">{i}</span>
      <span class="what">{head}<small>{sub}</small></span></div>
    <div class="grounds">{grounds}</div>
    <div class="zooms">{zooms}</div>
    <div class="measure">{meas}</div>
    <div class="beside">
      <div class="cap">Beside document and audio at 16px - the test it exists to pass</div>
      <div class="strip">
        <span class="one"><img src="{srcs[16]}" width="16" height="16" alt="">main.py</span>
        <span class="one"><img src="{others['document'][16]}" width="16" height="16" alt="">notes.docx</span>
        <span class="one"><img src="{others['audio'][16]}" width="16" height="16" alt="">song.mp3</span>
      </div>
    </div>
  </div>""")

    page_html = "\n".join([
        HEAD,
        """<header>
  <h1>The code icon on a dark page, round 27</h1>
  <p>A dark page is not a recolour, it is an inversion: the fold, the chip and the
  extension knocked out of it are all near-black, so on a dark page they vanish. Each
  option answers that differently, and number 1 is deliberately the naive version that
  does not answer it at all.</p>
  <p>Judge at 16px, and judge it in the strip at the bottom of each card. Code is three
  rounded bars in the same box document is, so the only test that matters is whether the
  two are still different in a folder listing. Pick by number.</p>
</header>""",
        '<div class="grid">',
        *cards,
        "</div>",
        """<footer>Every size is drawn at that size, never downsampled from one big render.
  The magnified frame is the real 16px one at 6x, so the pixel landing can be checked.
  The geometry is unchanged from what ships - only colour moves here, because changing
  both at once means neither can be judged.</footer>""",
    ])
    (out / "index.html").write_text(page_html, encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
