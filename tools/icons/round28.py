"""Round 28: the CHIP and the LABEL - how big the banner is, and the type on it.

Every kind carries the same banner in the same place, so this round asks the
question once, on one icon, rather than seven times. The page shape, the fold,
the glyph and the colours are all held fixed at what ships; only the chip's
size, its placement and the type on it move.

WHY IT IS WORTH ASKING AT ALL. Seven icons cover a hundred-odd extensions
between them, so the chip is what tells a .rar from a .zip and a .flac from an
.mp3 - it is load-bearing rather than decoration, and it is the only part of
the icon carrying information the silhouette cannot. A banner too small to read
at 16px is a black bar; one too large is a label with a picture attached.

THE LENGTH IS THE TEST, not the look. Two characters and three keep the full
size and four steps down, so a chip judged on MP3 alone is a chip judged on its
easiest case. Every card carries the same candidate set as PY, MP3, WEBM and
OPUS at 16px, which is where a banner that only works for the extension it was
tried on gives itself away.

The renderer here is a local copy of `round12.build`'s composition rather than a
call into it, for one reason: `build` reads the module-level CHIP and the fixed
0.86/0.62 label fit, and this round exists to vary exactly those. It composes at
the same supersample and downsamples once, so what is shown is what a .ico frame
would hold.

    python round28.py <outdir>
"""
import base64
import pathlib
import sys
from io import BytesIO

from PIL import Image, ImageDraw

from final_icons import BOX, COLOURS, PAGE_GLYPHS
from icons import S
from round12 import CHIP, INK, PX0, PX1, PY0, PY1, draw_page, fold_points, font, page_mask
from round5 import g

SIZES = (16, 24, 32, 48)
ZOOM = 96

# One kind for the whole round, since the banner is identical on all of them.
# AUDIO: the shared grey page, and a glyph distinctive enough that the chip is
# clearly sitting on an icon rather than floating on a rectangle.
KIND = "audio"
PAGE = COLOURS[KIND][1]
GLYPH = PAGE_GLYPHS[KIND]

# The extensions each card is checked against. Two, three, four and four again -
# WEBM and OPUS both being four, because W and M are the widest glyphs in the
# face and OPUS is what four AVERAGE characters look like.
LENGTHS = ("PY", "MP3", "WEBM", "OPUS")

CW, CH = CHIP[2] - CHIP[0], CHIP[3] - CHIP[1]
CX, CY = (CHIP[0] + CHIP[2]) / 2, (CHIP[1] + CHIP[3]) / 2

# How much of the chip's width the type is allowed, and how tall it starts,
# as the shipped renderer has them.
FILL, HEIGHT = 0.86, 0.62
RADIUS = 0.7


def scaled(k, keep_left=True):
    """The chip at k times its size.

    `keep_left` pins the overhang where it is and grows the chip to the RIGHT,
    which is what a bigger banner has to do: the overhang is a fixed bite out
    of the frame's left margin and scaling it walks the chip off the frame.
    """
    if keep_left:
        return (CHIP[0], CY - CH * k / 2, CHIP[0] + CW * k, CY + CH * k / 2)
    return (CX - CW * k / 2, CY - CH * k / 2, CX + CW * k / 2, CY + CH * k / 2)


def icon(size, text, chip, fill=FILL, height=HEIGHT, radius=RADIUS):
    """One candidate at one size, drawn at that size and downsampled once."""
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw_page(img, n, PAGE, INK)

    mark = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    GLYPH(ImageDraw.Draw(mark), n, BOX, tuple(INK) + (255,), PAGE)
    img.alpha_composite(Image.composite(
        mark, Image.new("RGBA", (n, n), (0, 0, 0, 0)), page_mask(n)))

    d = ImageDraw.Draw(img)
    d.rounded_rectangle([g(n, chip[0]), g(n, chip[1]), g(n, chip[2]), g(n, chip[3])],
                        radius=g(n, radius), fill=tuple(INK) + (255,))

    # The type SHRINKS to fit rather than spilling, the way the shipped
    # renderer does it - the candidate being judged is the starting size and
    # the room it is given, not whether a long extension is allowed to run out.
    fh = (chip[3] - chip[1]) * height
    room = g(n, (chip[2] - chip[0]) * fill)
    f = font(g(n, fh))
    while f.getlength(text) > room and fh > 0.6:
        fh *= 0.92
        f = font(g(n, fh))
    d.text((g(n, (chip[0] + chip[2]) / 2), g(n, (chip[1] + chip[3]) / 2)),
           text, font=f, fill=tuple(PAGE) + (255,), anchor="mm")
    return img.resize((size, size), Image.LANCZOS)


def band(top, bottom):
    """A chip that runs the page's full width, top or bottom."""
    return (PX0, top, PX1, bottom)


# (key, label, chip box, fill, height, radius)
SECTIONS = {
    "How big the banner is": (
        "Same place, same type rule, the chip itself scaled. It grows to the RIGHT: "
        "the overhang is a bite out of the frame's left margin, so scaling that too "
        "walks the chip off the icon.",
        [
            ("s85", "85%|smaller than ships", scaled(0.85), FILL, HEIGHT, RADIUS),
            ("s100", "100%|what ships today", CHIP, FILL, HEIGHT, RADIUS),
            ("s115", "115%|a step up", scaled(1.15), FILL, HEIGHT, RADIUS),
            ("s130", "130%|clearly a banner", scaled(1.30), FILL, HEIGHT, RADIUS),
            ("s115c", "115%, centred|grown both ways, overhang scaled too",
             scaled(1.15, keep_left=False), FILL, HEIGHT, RADIUS),
        ],
    ),
    "Where it sits, and what shape it is": (
        "The overhang is the set's signature and the first thing to test against "
        "its absence. A full-width band is the other shape entirely - it stops "
        "being a tab on the page and becomes a header across it.",
        [
            ("noover", "No overhang|flush with the page's left edge",
             (PX0, CHIP[1], CHIP[2], CHIP[3]), FILL, HEIGHT, RADIUS),
            ("deep", "Deeper overhang|hard against the frame",
             (0.0, CHIP[1], CHIP[2], CHIP[3]), FILL, HEIGHT, RADIUS),
            ("wide", "Out to the page's right edge|the widest a tab can be",
             (CHIP[0], CHIP[1], PX1, CHIP[3]), FILL, HEIGHT, RADIUS),
            ("square", "Square corners|the same chip, unrounded",
             CHIP, FILL, HEIGHT, 0.0),
            ("pill", "Pill|radius at half the height", CHIP, FILL, HEIGHT, CH / 2),
            # Kept in the round even though both collide: a band is the honest
            # alternative to a tab, and WHY the tab won is worth being able to see
            # rather than being told.
            ("top", "A header band|full width across the top - and it lands on the fold",
             band(PY0, PY0 + CH), FILL, HEIGHT, 0.0),
            ("bottom", "A footer band|full width across the bottom - it swallows the foot of the glyph",
             band(PY1 - CH, PY1), FILL, HEIGHT, 0.0),
        ],
    ),
    "How big the type is on it": (
        "The chip held at what ships; only the type moves. `fill` is how much of "
        "the chip's width four characters may have before they start shrinking, "
        "`height` is where the size starts from.",
        [
            ("t70", "Small type|fill 0.70, height 0.52", CHIP, 0.70, 0.52, RADIUS),
            ("t86", "What ships|fill 0.86, height 0.62", CHIP, FILL, HEIGHT, RADIUS),
            ("t94", "Larger|fill 0.94, height 0.72", CHIP, 0.94, 0.72, RADIUS),
            ("t100", "Filling it|fill 1.00, height 0.80", CHIP, 1.00, 0.80, RADIUS),
            ("big-both", "Bigger chip AND bigger type|115% chip, fill 0.94",
             scaled(1.15), 0.94, 0.72, RADIUS),
        ],
    ),
}


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


HEAD = """<meta charset="utf-8"><title>Prism icon labels, round 28</title>
<style>
 :root{color-scheme:dark;--bg:#141519;--panel:#1b1d22;--line:#2b2e36;--text:#e9edf7;
       --dim:#8b90a0;--accent:#7c7cf0}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--text);
      font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
 header{padding:28px 32px 4px}
 h1{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
 header p{margin:0 0 6px;color:var(--dim);max-width:74ch}
 h2{margin:30px 32px 4px;font-size:14px;font-weight:650;text-transform:uppercase;
    letter-spacing:.09em;color:var(--accent)}
 h2 + p{margin:0 32px 10px;color:var(--dim);max-width:74ch}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));
       gap:14px;padding:6px 32px 8px}
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
 .measure{margin-top:9px;color:var(--dim);
          font:11.5px ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
 footer{color:var(--dim);padding:22px 32px 46px;max-width:76ch}
 code{background:#262932;padding:1px 5px;border-radius:4px;font-size:12.5px}
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    parts = [HEAD, """<header>
  <h1>The extension banner, round 28</h1>
  <p>One kind for the whole round, because every icon carries the same banner in the
  same place. The page, the fold, the glyph and the colours are held at what ships;
  only the chip and the type on it move.</p>
  <p>Judge it on the strip at the bottom of each card, not on the big renders. PY, MP3,
  WEBM and OPUS at 16px is the real test: two characters and three keep their size and
  four steps down, so a banner judged on MP3 alone is a banner judged on its easiest
  case. Pick by number, and the three sections can be mixed.</p>
</header>"""]

    n = 0
    for title, (blurb, items) in SECTIONS.items():
        parts.append(f"<h2>{title}</h2><p>{blurb}</p><div class='grid'>")
        for key, label, chip, fill, height, radius in items:
            n += 1
            made = {s: _png(icon(s, "MP3", chip, fill, height, radius)) for s in SIZES}
            sizes = "".join(
                f'<img src="{made[s]}" width="{s}" height="{s}" alt="">' for s in SIZES)
            grounds = "".join(
                f'<div class="ground {mode}"><div class="sizes">{sizes}</div>'
                f'<div class="row"><img src="{made[16]}" width="16" height="16" alt="">'
                f'interlude.mp3</div></div>' for mode in ("dark", "light"))
            zooms = "".join(
                f'<div class="{mode}"><img class="zoom" src="{made[16]}" '
                f'width="{ZOOM}" height="{ZOOM}" alt=""></div>'
                for mode in ("dark", "light"))
            strip = "".join(
                f'<span class="one"><img src="{_png(icon(16, t, chip, fill, height, radius))}"'
                f' width="16" height="16" alt="">{t.lower()}</span>' for t in LENGTHS)
            head, sub = label.split("|")
            meas = (f"chip {chip[2] - chip[0]:.2f} x {chip[3] - chip[1]:.2f} units"
                    f"  ({(chip[2] - chip[0]) / 16:.0%} of the frame's width)"
                    f"   fill {fill:.2f}  height {height:.2f}  radius {radius:.2f}")
            parts.append(f"""  <div class="card">
    <div class="name"><span class="num">{n}</span>
      <span class="what">{head}<small>{sub}</small></span></div>
    <div class="grounds">{grounds}</div>
    <div class="zooms">{zooms}</div>
    <div class="measure">{meas}</div>
    <div class="lens">
      <div class="cap">Two, three and four characters at 16px - the test it exists to pass</div>
      <div class="strip">{strip}</div>
    </div>
  </div>""")
        parts.append("</div>")

    parts.append("""<footer>Every size is drawn at that size, never downsampled from one
  big render; the magnified frame is the real 16px one at 6x. The type shrinks to fit
  rather than spilling, exactly as the shipped renderer does it, so what is being judged
  is the size it STARTS from and the room it is given - not whether a long extension is
  allowed to run out of the banner.</footer>""")
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
