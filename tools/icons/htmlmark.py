"""A new mark for HTML, to pick from.

What ships is `shield`, the HTML5 crest reduced to a silhouette. Flattened to
one colour it is a pentagon with a notch, and at 14px that is a badge - it says
nothing about markup, and it is the one mark in the set that survives only by
being famous in a colour it is not allowed to wear here.

TWO CONSTRAINTS SHAPE EVERY CANDIDATE.

THE LETTERS ARE ALREADY TAKEN. The band under the glyph carries the file's own
extension, so a mark made of letterforms prints HTML twice and spends the only
part of the icon that could say something else. Every candidate here is
pictorial; the angle brackets count as punctuation rather than letters, which is
the same licence `prompt` already takes for the shell.

AND IT MUST NOT COLLIDE WITH ITS NEIGHBOURS. `prompt` is a chevron and an
underscore, `braces` is a brace pair, `containers` is stacked boxes. A mark that
reads as any of those at 14px has not solved anything, so every candidate is
shown beside all three at the size that decides it.

    python htmlmark.py <outdir>
"""
import json
import pathlib
import sys

import svg
from langs import MARKS, _c, _rect
from round5 import g


# --------------------------------------------------------------- candidates
def _chevron(d, n, cx, cy, sg, gap, w, h, t, col):
    """One chevron, tip pointing AWAY from centre.

    Which is what makes the pair read as `< >` rather than `> <`: the tip of a
    `<` is its leftmost point, so on the left-hand glyph it sits further from
    the centre than the arms do, not nearer. Getting that backwards produces a
    perfectly tidy shape that means nothing.
    """
    out, inn = gap + w, gap - t
    tip, tip_in = gap + w, gap + w - t * 1.5
    d.polygon([(g(n, cx + sg * gap), g(n, cy - h)),
               (g(n, cx + sg * tip), g(n, cy)),
               (g(n, cx + sg * gap), g(n, cy + h)),
               (g(n, cx + sg * inn), g(n, cy + h)),
               (g(n, cx + sg * tip_in), g(n, cy)),
               (g(n, cx + sg * inn), g(n, cy - h))], fill=col)
    del out


def angles(d, n, box, col, _hole=None):
    """`< >` - the markup pair, symmetric so it cannot read as the shell's."""
    cx, cy, s = _c(box)
    for sg in (-1, 1):
        _chevron(d, n, cx, cy, sg, s * 0.06, s * 0.34, s * 0.30, s * 0.12, col)


def angles_slash(d, n, box, col, _hole=None):
    """`</>` - the closing tag, which is what most editors use for markup."""
    cx, cy, s = _c(box)
    t = s * 0.10
    for sg in (-1, 1):
        _chevron(d, n, cx, cy, sg, s * 0.14, s * 0.28, s * 0.28, t, col)
    d.polygon([(g(n, cx + t * 0.7), g(n, cy - s * 0.34)),
               (g(n, cx + t * 0.7 + t), g(n, cy - s * 0.34)),
               (g(n, cx - t * 0.7), g(n, cy + s * 0.34)),
               (g(n, cx - t * 0.7 - t), g(n, cy + s * 0.34))], fill=col)


def tag(d, n, box, col, _hole=None):
    """A tag as a shape: an angle bracket opening onto a solid block."""
    cx, cy, s = _c(box)
    t = s * 0.13
    d.polygon([(g(n, cx - s * 0.14), g(n, cy - s * 0.34)),
               (g(n, cx - s * 0.14 + t * 1.4), g(n, cy - s * 0.30)),
               (g(n, cx - s * 0.40), g(n, cy)),
               (g(n, cx - s * 0.14 + t * 1.4), g(n, cy + s * 0.30)),
               (g(n, cx - s * 0.14), g(n, cy + s * 0.34)),
               (g(n, cx - s * 0.46), g(n, cy))], fill=col)
    _rect(d, n, cx - s * 0.02, cy - s * 0.26, cx + s * 0.42, cy + s * 0.26, col)


def browser(d, n, box, col, hole=None):
    """A browser frame: a title bar with a dot in it. A page, not a language."""
    cx, cy, s = _c(box)
    h = svg.KO if hole is None else hole
    d.rounded_rectangle([g(n, cx - s * 0.44), g(n, cy - s * 0.36),
                         g(n, cx + s * 0.44), g(n, cy + s * 0.36)],
                        radius=g(n, s * 0.09), fill=col)
    _rect(d, n, cx - s * 0.34, cy - s * 0.10, cx + s * 0.34, cy + s * 0.26, h)
    d.ellipse([g(n, cx - s * 0.36), g(n, cy - s * 0.28),
               g(n, cx - s * 0.24), g(n, cy - s * 0.16)], fill=h)


def nested(d, n, box, col, hole=None):
    """Three boxes inside one another: markup is a tree, drawn as nesting."""
    cx, cy, s = _c(box)
    h = svg.KO if hole is None else hole
    t = s * 0.085
    d.rectangle([g(n, cx - s * 0.44), g(n, cy - s * 0.38),
                 g(n, cx + s * 0.44), g(n, cy + s * 0.38)], fill=col)
    d.rectangle([g(n, cx - s * 0.44 + t), g(n, cy - s * 0.38 + t),
                 g(n, cx + s * 0.44 - t), g(n, cy + s * 0.38 - t)], fill=h)
    d.rectangle([g(n, cx - s * 0.24), g(n, cy - s * 0.18),
                 g(n, cx + s * 0.44 - t), g(n, cy + s * 0.38 - t)], fill=col)


def tree(d, n, box, col, _hole=None):
    """A root with two children: the DOM, as a shape."""
    cx, cy, s = _c(box)
    t = s * 0.09
    _rect(d, n, cx - s * 0.16, cy - s * 0.40, cx + s * 0.16, cy - s * 0.22, col)
    _rect(d, n, cx - t / 2, cy - s * 0.22, cx + t / 2, cy + s * 0.02, col)
    _rect(d, n, cx - s * 0.30, cy - s * 0.02 - t, cx + s * 0.30, cy - s * 0.02, col)
    for sign in (-1, 1):
        _rect(d, n, cx + sign * s * 0.30 - t / 2, cy - s * 0.02,
              cx + sign * s * 0.30 + t / 2, cy + s * 0.16, col)
        _rect(d, n, cx + sign * s * 0.30 - s * 0.15, cy + s * 0.16,
              cx + sign * s * 0.30 + s * 0.15, cy + s * 0.36, col)


def globe(d, n, box, col, hole=None):
    """A globe: the web rather than the markup."""
    cx, cy, s = _c(box)
    h = svg.KO if hole is None else hole
    r = s * 0.40
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    for dy in (-r * 0.42, r * 0.42):
        _rect(d, n, cx - r, cy + dy - s * 0.045, cx + r, cy + dy + s * 0.045, h)
    d.ellipse([g(n, cx - r * 0.42), g(n, cy - r), g(n, cx + r * 0.42), g(n, cy + r)],
              fill=h)
    d.ellipse([g(n, cx - r * 0.26), g(n, cy - r), g(n, cx + r * 0.26), g(n, cy + r)],
              fill=col)


def page_angles(d, n, box, col, _hole=None):
    """Angle brackets over a baseline: markup sitting on a document."""
    cx, cy, s = _c(box)
    for sg in (-1, 1):
        _chevron(d, n, cx, cy - s * 0.10, sg, s * 0.06, s * 0.30, s * 0.22, s * 0.11, col)
    _rect(d, n, cx - s * 0.40, cy + s * 0.24, cx + s * 0.40, cy + s * 0.36, col)


def shield(d, n, box, col, _hole=None):
    """What ships, for comparison."""
    MARKS["html"](d, n, box, col)


CANDIDATES = [
    ("angles", "Angle pair  < >", angles),
    ("angles_slash", "Closing tag  < / >", angles_slash),
    ("tag", "Bracket onto a block", tag),
    ("browser", "Browser frame", browser),
    ("nested", "Nested boxes", nested),
    ("tree", "DOM tree", tree),
    ("globe", "Globe", globe),
    ("page_angles", "Angles over a baseline", page_angles),
    ("shield", "The shield, what ships now", shield),
]

# The three it has to stay apart from at 14px.
NEIGHBOURS = ["shell", "data", "docker"]

HEAD = """<meta charset="utf-8">
<title>Prism: a mark for HTML</title>
<style>
  :root { color-scheme: dark; --bg:#141519; --panel:#1b1d22; --line:#2b2e36;
          --text:#e9edf7; --dim:#8b90a0; --hl:#7c7cf0 }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI","Segoe UI Variable Text",system-ui,sans-serif }
  header { padding:24px 30px 6px }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650 }
  header p { margin:0 0 4px; color:var(--dim); max-width:88ch }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr));
          gap:12px; padding:16px 30px 40px }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:13px 15px 15px }
  h3 { margin:0 0 2px; font-size:13px; font-weight:650 }
  .key { margin:0 0 10px; font:11.5px ui-monospace,Consolas,monospace; color:var(--hl) }
  .row { display:flex; align-items:flex-end; gap:11px; padding:11px 12px; border-radius:9px }
  .dark { background:#1b1d22 } .light { background:#f7f7f7 }
  .near { margin-top:9px; display:flex; align-items:center; gap:7px; padding:7px 10px;
          border-radius:9px; background:#1b1d22; font-size:11px; color:var(--dim) }
  .near b { color:var(--text); font-weight:600 }
</style>
"""


def layers_for(fn):
    """Record a candidate the way svg.py records a shipped mark."""
    ko_ink, hi_ink = object(), object()
    r = svg.Recorder(ko_ink, hi_ink)
    fn(r, 16, svg.BOX, ko_ink, hi_ink)
    ko, hi = [], []
    for lay, op, pts in r.ops:
        (hi if lay == svg.HI else ko).append(svg.op_path(op, pts))
    return " ".join(ko), " ".join(hi)


def icon_svg(d, mark_ko, mark_hi, px, page="#464646", band="#000000", glyph="#ffffff",
             ext="HTML", uid="x"):
    """The icon exactly as the app draws it: masked, band composited last."""
    L = d["label"]
    size = L["sizes"][min(len(ext), 6)]
    return (
        f'<svg viewBox="0 0 24 24" width="{px}" height="{px}">'
        f'<mask id="m{uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">'
        f'<path d="{d["body"]}" fill="#fff"/></mask>'
        f'<g mask="url(#m{uid})">'
        f'<rect x="0" y="0" width="24" height="24" fill="{page}"/>'
        f'<path d="{mark_ko}" fill="{glyph}"/>'
        + (f'<path d="{mark_hi}" fill="{page}"/>' if mark_hi else '')
        + f'<path d="{d["bleed"]}" fill="{band}"/></g>'
        f'<text x="{L["x"]}" y="{L["y"]}" font-size="{size}" fill="#ffffff"'
        f' text-anchor="middle" dominant-baseline="central" font-weight="700"'
        f' font-family="Segoe UI,system-ui,sans-serif">{ext}</text></svg>')


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ids = svg.identities()
    code = ids["html"]
    uid = [0]

    def one(mark_ko, mark_hi, px, ext="HTML"):
        uid[0] += 1
        return icon_svg(code, mark_ko, mark_hi, px, ext=ext, uid=str(uid[0]))

    cards = []
    for key, label, fn in CANDIDATES:
        ko, hi = layers_for(fn)
        sizes = "".join(one(ko, hi, p) for p in (72, 40, 28, 20, 14))
        near = "".join(
            one(ids[nb]["mark"], ids[nb]["hi"], 14, ids[nb]["ext"]) for nb in NEIGHBOURS)
        cards.append(f"""
  <div class="card">
    <h3>{label}</h3>
    <p class="key">{key}</p>
    <div class="row dark">{sizes}</div>
    <div class="row light" style="margin-top:8px">{sizes}</div>
    <div class="near"><b>vs</b>{one(ko, hi, 14)}{near}<span>shell · data · docker</span></div>
  </div>""")

    html = (HEAD + """<header>
  <h1>A mark for HTML</h1>
  <p>What ships is the HTML5 crest as a silhouette, which at 14px is a badge with a notch in
  it. Every candidate below is pictorial - the band already carries the extension, so a mark
  made of letters prints HTML twice - and each is shown beside <b>shell</b>, <b>data</b> and
  <b>docker</b>, the three it has to stay distinct from at the size that decides it.</p>
  <p>Drawn through the same recorder the shipped marks use, so what you are looking at is what
  the .ico and the sidebar would both draw.</p>
</header>
<div class="grid">""" + "".join(cards) + "</div>")
    (out / "index.html").write_text(html, encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
