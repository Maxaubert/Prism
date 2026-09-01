"""Round 30: the FOOTER BAND across the whole set, and per-language marks for code.

Two questions in one sheet, because they are the same question asked twice: the
band changes where the label lives, and a language mark changes what sits above
it, and neither can be judged without the other.

PART ONE - THE BAND AS A SYSTEM. Round 29 showed the footer band on one icon.
An icon set is not one icon, so here it is on every kind that is a page, with
each kind's own colours and its own mark, and the mark raised out of the band's
way in every case. Archive is shown as it SHIPS rather than restyled, because
its chip is already at the bottom for its own reason - a chip over the top of a
container hides the tab that says which container it is - so it is the one kind
the band changes nothing about.

PART TWO - A MARK PER LANGUAGE. The generic stepped bars say "this is source"
and nothing else; a React file and a shell script are the same picture. These
say which one.

    THE LETTERS ARE ALREADY TAKEN. The band carries the extension, so a mark
    built out of letterforms - JS in a square, TS in a square, C# - prints the
    same information twice and wastes the only part of the icon that can carry
    something else. Every mark here is PICTORIAL for that reason, and the ones
    whose real logos are letterforms are simply not in the round.

    WHAT IT COSTS, so it is decided rather than discovered. Windows associates
    by extension through a ProgID, and `Prism.Text` is ONE ProgID pointing at
    one .ico. A mark per language means a ProgID per language, an .ico per
    language, and `assoc.nsh` mapping each extension to its own - so this is a
    change to the installer as much as to the artwork. The in-app tree needs
    the same marks again as paths. And Prism claims ~150 languages, so whatever
    is drawn, the stepped bars stay as the fallback for everything else.

    AND THEY ARE SOMEBODY ELSE'S MARKS. These are redrawn approximations of
    trademarked logos. Editors ship icon themes that do exactly this and it is
    normal practice, but it is worth knowing that is what it is rather than
    finding out later.

    python round30.py <outdir>
"""
import base64
import math
import pathlib
import sys
from io import BytesIO

from PIL import Image, ImageDraw, ImageFilter

from final_icons import (BOX, CODE_BARS, CODE_EDGE, CODE_PAGE, COLOURS, PAGE,
                         PAGE_GLYPHS, PAPER, PAPER_EDGE, render)
from icons import S
from round12 import CHIP, CUT, INK, PX0, PX1, PY0, PY1, draw_page, font, page_mask
from round5 import g

SIZES = (16, 24, 32, 48)
ZOOM = 96

INK_A = tuple(INK) + (255,)
BAND_H = CHIP[3] - CHIP[1]            # the band keeps the chip's own height
BAND = (PX0, PY1 - BAND_H, PX1, PY1)

# The interior, and the mark's box once the band has taken the foot of the page.
IX0, IX1 = 3.88, 13.12
MARK = (IX0, 3.10, IX1, BAND[1] - 0.9)


def put(d, n, text, box, colour, height=0.62, fill=0.86):
    """Set `text` centred in `box`, shrinking to fit as the shipped set does."""
    fh = (box[3] - box[1]) * height
    room = g(n, (box[2] - box[0]) * fill)
    f = font(g(n, fh))
    while f.getlength(text) > room and fh > 0.6:
        fh *= 0.92
        f = font(g(n, fh))
    d.text((g(n, (box[0] + box[2]) / 2), g(n, (box[1] + box[3]) / 2)),
           text, font=f, fill=colour, anchor="mm")


def hairline(base, size, colour):
    """The set's own edge, eroded from the page mask. See final_icons._hairline."""
    n = size * S
    m = page_mask(n)
    inner = m.filter(ImageFilter.MinFilter(2 * int(0.35 * S) + 1))
    band = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    band.paste(Image.new("RGBA", (n, n), tuple(colour) + (255,)), (0, 0), m)
    band.paste(Image.new("RGBA", (n, n), (0, 0, 0, 0)), (0, 0), inner)
    out = base.copy()
    out.alpha_composite(band.resize((size, size), Image.LANCZOS))
    return out


def compose(size, text, page, mark_fn, ink, edge=None, box=MARK):
    """A page kind with its label in a FOOTER BAND instead of a corner tab.

    `ink` is everything that is not the page: the fold, the band, and the mark.
    The label is drawn in the page colour, the way a knockout would have looked.
    """
    n = size * S
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw_page(img, n, page, ink)

    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    mark_fn(d, n, box, tuple(ink) + (255,), page)
    d.rectangle([g(n, BAND[0]), g(n, BAND[1]), g(n, BAND[2]), g(n, BAND[3])],
                fill=tuple(ink) + (255,))
    # Clipped to the page, so the band picks up its rounded bottom corners.
    img.alpha_composite(Image.composite(
        layer, Image.new("RGBA", (n, n), (0, 0, 0, 0)), page_mask(n)))

    put(ImageDraw.Draw(img), n, text, BAND, tuple(page) + (255,))
    out = img.resize((size, size), Image.LANCZOS)
    return hairline(out, size, edge) if edge else out


# ------------------------------------------------------- the language marks
# Every one draws inside `box` in `col`, filled rather than stroked: a hairline
# outline is the first thing a 16px frame throws away. They are deliberately
# CHUNKY for that reason, and every one was checked at 16 before being kept.

def _c(box):
    x0, y0, x1, y1 = box
    return (x0 + x1) / 2, (y0 + y1) / 2, min(x1 - x0, y1 - y0)


def react(d, n, box, col, _hole=None):
    """The atom: a nucleus and three orbits, the orbits at 0, 60 and 120."""
    cx, cy, s = _c(box)
    r = s * 0.46
    for ang in (0, 60, 120):
        ring = Image.new("L", (n, n), 0)
        rd = ImageDraw.Draw(ring)
        rd.ellipse([g(n, cx - r), g(n, cy - r * 0.38),
                    g(n, cx + r), g(n, cy + r * 0.38)],
                   outline=255, width=max(2, int(g(n, s * 0.085))))
        d.bitmap((0, 0), ring.rotate(ang, center=(g(n, cx), g(n, cy))), fill=col)
    d.ellipse([g(n, cx - s * 0.13), g(n, cy - s * 0.13),
               g(n, cx + s * 0.13), g(n, cy + s * 0.13)], fill=col)


def vue(d, n, box, col, hole=None):
    """A V with a second V notched out of its head.

    The notch is knocked out in the PAGE colour rather than drawn as a second
    shape, so the two chevrons cannot drift apart at any size.
    """
    cx, cy, s = _c(box)
    top, half, depth = cy - s * 0.34, s * 0.44, s * 0.72
    d.polygon([(g(n, cx - half), g(n, top)), (g(n, cx + half), g(n, top)),
               (g(n, cx), g(n, top + depth))], fill=col)
    if hole is not None:
        k = 0.42
        d.polygon([(g(n, cx - half * k), g(n, top)), (g(n, cx + half * k), g(n, top)),
                   (g(n, cx), g(n, top + depth * k))],
                  fill=tuple(hole) + (255,) if len(hole) == 3 else hole)


def python(d, n, box, col, _hole=None):
    """Two interlocking hooks - the two snakes, at the only scale they survive."""
    cx, cy, s = _c(box)
    a, t = s * 0.40, s * 0.24
    d.rounded_rectangle([g(n, cx - a), g(n, cy - a), g(n, cx + t * 0.2), g(n, cy)],
                        radius=g(n, t * 0.55), fill=col)
    d.rounded_rectangle([g(n, cx - a), g(n, cy - a), g(n, cx - a + t), g(n, cy + a * 0.55)],
                        radius=g(n, t * 0.4), fill=col)
    d.rounded_rectangle([g(n, cx - t * 0.2), g(n, cy), g(n, cx + a), g(n, cy + a)],
                        radius=g(n, t * 0.55), fill=col)
    d.rounded_rectangle([g(n, cx + a - t), g(n, cy - a * 0.55), g(n, cx + a), g(n, cy + a)],
                        radius=g(n, t * 0.4), fill=col)


def gear(d, n, box, col, hole=None):
    """A cog: Rust, and config files generally.

    SIX teeth, not eight, and a knocked-out bore. Eight teeth at 16px are eight
    sub-pixel bumps that average into a circle, and a cog with no hole in it is
    a flower.
    """
    cx, cy, s = _c(box)
    r, tooth = s * 0.34, s * 0.15
    for i in range(6):
        a = math.radians(i * 60)
        dx, dy = math.cos(a) * r, math.sin(a) * r
        d.rounded_rectangle([g(n, cx + dx - tooth), g(n, cy + dy - tooth),
                             g(n, cx + dx + tooth), g(n, cy + dy + tooth)],
                            radius=g(n, tooth * 0.45), fill=col)
    d.ellipse([g(n, cx - r * 0.95), g(n, cy - r * 0.95),
               g(n, cx + r * 0.95), g(n, cy + r * 0.95)], fill=col)
    if hole is not None:
        b = r * 0.40
        d.ellipse([g(n, cx - b), g(n, cy - b), g(n, cx + b), g(n, cy + b)],
                  fill=tuple(hole) + (255,) if len(hole) == 3 else hole)


def shield(d, n, box, col, _hole=None):
    """The HTML5 crest, as a silhouette."""
    cx, cy, s = _c(box)
    w, h = s * 0.40, s * 0.46
    d.polygon([(g(n, cx - w), g(n, cy - h)), (g(n, cx + w), g(n, cy - h)),
               (g(n, cx + w * 0.78), g(n, cy + h * 0.42)),
               (g(n, cx), g(n, cy + h)),
               (g(n, cx - w * 0.78), g(n, cy + h * 0.42))], fill=col)


def droplet(d, n, box, col, _hole=None):
    """A drop: stylesheets, where a second shield would be the same picture."""
    cx, cy, s = _c(box)
    r = s * 0.34
    d.ellipse([g(n, cx - r), g(n, cy - r * 0.55), g(n, cx + r), g(n, cy + r * 1.35)],
              fill=col)
    d.polygon([(g(n, cx), g(n, cy - r * 1.5)), (g(n, cx + r * 0.86), g(n, cy + r * 0.2)),
               (g(n, cx - r * 0.86), g(n, cy + r * 0.2))], fill=col)


def prompt(d, n, box, col, _hole=None):
    """`>_` - a shell script."""
    cx, cy, s = _c(box)
    t = s * 0.13
    d.polygon([(g(n, cx - s * 0.40), g(n, cy - s * 0.30)),
               (g(n, cx - s * 0.40 + t * 1.5), g(n, cy - s * 0.36)),
               (g(n, cx - s * 0.02), g(n, cy - s * 0.02)),
               (g(n, cx - s * 0.40 + t * 1.5), g(n, cy + s * 0.32)),
               (g(n, cx - s * 0.40), g(n, cy + s * 0.26)),
               (g(n, cx - s * 0.16), g(n, cy - s * 0.02))], fill=col)
    d.rectangle([g(n, cx + s * 0.06), g(n, cy + s * 0.20),
                 g(n, cx + s * 0.42), g(n, cy + s * 0.32)], fill=col)


def _rect(d, n, x0, y0, x1, y1, col):
    """A rectangle whose corners are given in any order.

    PIL refuses x1 < x0 rather than sorting, and a mark drawn symmetrically
    about a centre produces exactly that on one of its two halves.
    """
    d.rectangle([g(n, min(x0, x1)), g(n, min(y0, y1)),
                 g(n, max(x0, x1)), g(n, max(y0, y1))], fill=col)


def braces(d, n, box, col, _hole=None):
    """{ } - JSON, YAML, and the data formats generally.

    The arms point INWARD and the middle nub points out, which is what makes a
    pair of them read as a brace rather than as two brackets.
    """
    cx, cy, s = _c(box)
    t, h, arm = s * 0.115, s * 0.36, s * 0.19
    for sign in (-1, 1):
        x = cx + sign * s * 0.30
        _rect(d, n, x - t / 2, cy - h, x + t / 2, cy + h, col)
        for y in (cy - h, cy + h - t):
            _rect(d, n, x, y, x - sign * arm, y + t, col)
        _rect(d, n, x, cy - t / 2, x + sign * arm * 0.7, cy + t / 2, col)


def database(d, n, box, col, hole=None):
    """A cylinder - SQL.

    The rim is KNOCKED OUT rather than drawn: three shapes in one colour merge
    into a rounded rectangle, and a rounded rectangle is not a database.
    """
    cx, cy, s = _c(box)
    w, h, e = s * 0.34, s * 0.30, s * 0.13
    d.rectangle([g(n, cx - w), g(n, cy - h), g(n, cx + w), g(n, cy + h)], fill=col)
    d.ellipse([g(n, cx - w), g(n, cy - h - e), g(n, cx + w), g(n, cy - h + e)], fill=col)
    d.ellipse([g(n, cx - w), g(n, cy + h - e), g(n, cx + w), g(n, cy + h + e)], fill=col)
    if hole is not None:
        k = tuple(hole) + (255,) if len(hole) == 3 else hole
        for dy in (-h + e * 1.5, cy * 0 + e * 0.2):
            d.ellipse([g(n, cx - w * 0.98), g(n, cy + dy - e * 0.62),
                       g(n, cx + w * 0.98), g(n, cy + dy + e * 0.62)], fill=k)


def cup(d, n, box, col, _hole=None):
    """A wide cup with a handle and two wisps of steam - Java."""
    cx, cy, s = _c(box)
    w, h = s * 0.32, s * 0.30
    d.rounded_rectangle([g(n, cx - w), g(n, cy - h * 0.1), g(n, cx + w), g(n, cy + h)],
                        radius=g(n, s * 0.09), fill=col)
    d.ellipse([g(n, cx + w - s * 0.05), g(n, cy + h * 0.05),
               g(n, cx + w + s * 0.22), g(n, cy + h * 0.72)], fill=col)
    if _hole is not None:
        k = tuple(_hole) + (255,) if len(_hole) == 3 else _hole
        d.ellipse([g(n, cx + w + s * 0.01), g(n, cy + h * 0.22),
                   g(n, cx + w + s * 0.15), g(n, cy + h * 0.55)], fill=k)
    d.rounded_rectangle([g(n, cx - w * 1.1), g(n, cy + h), g(n, cx + w * 1.1),
                         g(n, cy + h + s * 0.10)], radius=g(n, s * 0.04), fill=col)
    for i in (-1, 1):
        d.rounded_rectangle([g(n, cx + i * w * 0.48 - s * 0.055), g(n, cy - h * 1.35),
                             g(n, cx + i * w * 0.48 + s * 0.055), g(n, cy - h * 0.42)],
                            radius=g(n, s * 0.055), fill=col)


def branch(d, n, box, col, _hole=None):
    """Two dots and a fork - version control."""
    cx, cy, s = _c(box)
    r, t = s * 0.11, s * 0.09
    d.rectangle([g(n, cx - s * 0.22 - t / 2), g(n, cy - s * 0.34),
                 g(n, cx - s * 0.22 + t / 2), g(n, cy + s * 0.34)], fill=col)
    d.rectangle([g(n, cx - s * 0.22), g(n, cy - t / 2),
                 g(n, cx + s * 0.22), g(n, cy + t / 2)], fill=col)
    for px, py in ((cx - s * 0.22, cy - s * 0.34), (cx - s * 0.22, cy + s * 0.34),
                   (cx + s * 0.22, cy)):
        d.ellipse([g(n, px - r), g(n, py - r), g(n, px + r), g(n, py + r)], fill=col)


def whale(d, n, box, col, _hole=None):
    """Stacked containers on a hull - Docker."""
    cx, cy, s = _c(box)
    b, gap = s * 0.15, s * 0.03
    for row, count in ((1, 3), (0, 4)):
        for i in range(count):
            x = cx - (count * (b + gap) - gap) / 2 + i * (b + gap)
            y = cy - s * 0.10 - row * (b + gap)
            d.rectangle([g(n, x), g(n, y), g(n, x + b), g(n, y + b)], fill=col)
    d.rounded_rectangle([g(n, cx - s * 0.42), g(n, cy + s * 0.12),
                         g(n, cx + s * 0.42), g(n, cy + s * 0.32)],
                        radius=g(n, s * 0.09), fill=col)


def swoosh(d, n, box, col, _hole=None):
    """A bird's sweep - Swift."""
    cx, cy, s = _c(box)
    d.polygon([(g(n, cx - s * 0.38), g(n, cy + s * 0.34)),
               (g(n, cx + s * 0.10), g(n, cy + s * 0.10)),
               (g(n, cx + s * 0.40), g(n, cy - s * 0.36)),
               (g(n, cx + s * 0.16), g(n, cy - s * 0.02)),
               (g(n, cx + s * 0.30), g(n, cy + s * 0.30)),
               (g(n, cx - s * 0.06), g(n, cy + s * 0.16))], fill=col)


LANGS = [
    ("react", "React", "JSX", react),
    ("vue", "Vue", "VUE", vue),
    ("python", "Python", "PY", python),
    ("rust", "Rust and config", "RS", gear),
    ("html", "HTML", "HTML", shield),
    ("css", "Stylesheets", "CSS", droplet),
    ("shell", "Shell scripts", "SH", prompt),
    ("json", "Data formats", "JSON", braces),
    ("sql", "SQL", "SQL", database),
    ("java", "Java", "JAVA", cup),
    ("git", "Version control", "GIT", branch),
    ("docker", "Docker", "YML", whale),
    ("swift", "Swift", "SWIFT", swoosh),
    ("bars", "Everything else", "LUA", PAGE_GLYPHS["code"]),
]

# Each kind's own three colours under the band: (page, ink, edge).
KIND_COLOURS = {
    "audio": (PAGE, INK, None),
    "video": (PAGE, INK, None),
    "image": (PAGE, INK, None),
    "document": (PAPER, INK, PAPER_EDGE),
    "code": (CODE_PAGE, CODE_BARS, CODE_EDGE),
}
KIND_EXT = {k: COLOURS[k][0] for k in KIND_COLOURS}


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


HEAD = """<meta charset="utf-8"><title>Prism icons, round 30</title>
<style>
 :root{color-scheme:dark;--bg:#141519;--panel:#1b1d22;--line:#2b2e36;--text:#e9edf7;
       --dim:#8b90a0;--accent:#7c7cf0}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--text);
      font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
 header{padding:28px 32px 4px}
 h1{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
 header p{margin:0 0 6px;color:var(--dim);max-width:78ch}
 h2{margin:30px 32px 4px;font-size:14px;font-weight:650;text-transform:uppercase;
    letter-spacing:.09em;color:var(--accent)}
 h2 + p{margin:0 32px 10px;color:var(--dim);max-width:78ch}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));
       gap:12px;padding:6px 32px 8px}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;
       padding:12px 14px 14px}
 .name{display:flex;align-items:baseline;gap:8px;margin-bottom:10px}
 .num{display:grid;place-items:center;width:21px;height:21px;flex:0 0 auto;
      border-radius:6px;background:var(--accent);color:#0d0f16;
      font-size:11.5px;font-weight:750;font-variant-numeric:tabular-nums}
 .what{font-weight:600}
 .grounds{display:flex;gap:8px}
 .ground{flex:1;border:1px solid var(--line);border-radius:9px;padding:10px}
 .dark{background:#202020}
 .light{background:#f7f7f7;border-color:#dcdcdc}
 .sizes{display:flex;align-items:flex-end;gap:10px;min-height:52px}
 .zoom{image-rendering:pixelated;margin-top:8px}
 .row{display:flex;align-items:center;gap:6px;margin-top:9px;
      font:11.5px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
 .dark .row{color:#e6e6e6}.light .row{color:#1b1b1b}
 img{display:block}
 footer{color:var(--dim);padding:22px 32px 46px;max-width:80ch}
 .warn{border-left:3px solid var(--accent);padding-left:12px}
</style>
"""


def card(i, title, made):
    grounds = "".join(
        f'<div class="ground {mode}">'
        f'<div class="sizes">'
        + "".join(f'<img src="{made[s]}" width="{s}" height="{s}" alt="">' for s in SIZES)
        + f'</div><img class="zoom" src="{made[16]}" width="{ZOOM}" height="{ZOOM}" alt="">'
        f'</div>' for mode in ("dark", "light"))
    return f"""  <div class="card">
    <div class="name"><span class="num">{i}</span><span class="what">{title}</span></div>
    <div class="grounds">{grounds}</div>
  </div>"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    parts = [HEAD, """<header>
  <h1>The footer band across the set, and a mark per language</h1>
  <p>Two questions, one sheet, because they are the same question twice: the band decides
  where the label lives, and a language mark decides what sits above it.</p>
</header>
<h2>The band, on every kind</h2>
<p>Round 29 showed it on one icon; a set is not one icon. Each kind keeps its own
colours and its own mark, raised out of the band's way. ARCHIVE is shown as it ships
rather than restyled - its chip is already at the bottom, for its own reason - so it is
the one kind the band changes nothing about.</p>
<div class="grid">"""]

    n = 0
    for kind in ("audio", "video", "image", "document", "code"):
        n += 1
        page, ink, edge = KIND_COLOURS[kind]
        made = {s: _png(compose(s, KIND_EXT[kind], page, PAGE_GLYPHS[kind], ink, edge))
                for s in SIZES}
        parts.append(card(n, kind, made))
    n += 1
    parts.append(card(n, "archive (as it ships)",
                      {s: _png(render("archive", s)) for s in SIZES}))
    parts.append("</div>")

    parts.append("""<h2>A mark per language</h2>
<p class="warn">The band already carries the extension, so a mark made of LETTERS - JS in
a square, TS in a square, C# - prints the same thing twice and wastes the only part of the
icon that can say something else. Every mark here is pictorial for that reason, and the
languages whose real logos are letterforms are simply not in the round. What it costs is
worth knowing before picking: Windows associates through a ProgID, and Prism.Text is ONE
ProgID pointing at one .ico, so a mark per language means a ProgID, an .ico and an
assoc.nsh entry per language - the installer changes as much as the artwork does. Prism
claims about 150 languages, so the stepped bars stay as the fallback whatever is drawn.
And these are redrawn approximations of somebody else's trademarks; every editor's icon
theme does the same thing, but that is what they are.</p>
<div class="grid">""")
    page, ink, edge = KIND_COLOURS["code"]
    for i, (key, title, ext, fn) in enumerate(LANGS, 1):
        made = {s: _png(compose(s, ext, page, fn, ink, edge)) for s in SIZES}
        parts.append(card(i, f"{title} <span style='color:var(--dim)'>.{ext.lower()}</span>",
                          made))
    parts.append("</div>")
    parts.append("""<footer>Every size is drawn at that size, never downsampled from one
  big render; the magnified frame under each pair is the real 16px one at 6x. The marks
  are filled rather than stroked, because a hairline outline is the first thing a 16px
  frame throws away.</footer>""")
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
