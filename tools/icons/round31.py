"""Round 31: the VIDEO mark, in the whole icon rather than on its own.

Every candidate is drawn through the REAL renderer - the shipped page, its
fold, its footer band with MP4 on it, its colours - because a mark is judged in
the frame it lives in and not beside it. Only the glyph moves.

WHAT A VIDEO MARK HAS TO SURVIVE. Detail is the first thing a 16px frame
spends: a clapperboard's stripes are one pixel each and merge into a grey bar,
a film strip's sprockets close up, a reel's holes fill in. So every candidate
here is FILLED rather than stroked, and anything that has to stay open is a
KNOCKOUT in the page colour - a hole is still a hole at 16px where a hairline
gap is not.

And it has to stay apart from IMAGE, which is the mark it can actually be
confused with: both are a rectangle with something inside. Each card shows the
candidate beside the shipped image and audio icons at 16px, which is the frame
that decides.

    python round31.py <outdir>
"""
import base64
import math
import pathlib
import sys
from io import BytesIO

from final_icons import BOX, CODE_PAGE, PAGE, PAPER, PAPER_EDGE, _hairline, _page_kind_with, render
from round12 import INK
from round13 import clapper
from round5 import g

SIZES = (16, 24, 32, 48)
ZOOM = 96


def _c(box):
    x0, y0, x1, y1 = box
    return (x0 + x1) / 2, (y0 + y1) / 2, min(x1 - x0, y1 - y0)


def _hole(h):
    if h is None:
        return None
    return tuple(h) + (255,) if isinstance(h, (tuple, list)) and len(h) == 3 else h


# ---------------------------------------------------------------- the marks
def play_round(d, n, box, col, hole=None):
    """A rounded tile with the triangle punched out of it."""
    cx, cy, s = _c(box)
    r = s * 0.44
    d.rounded_rectangle([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)],
                        radius=g(n, s * 0.14), fill=col)
    k = _hole(hole)
    if k:
        d.polygon([(g(n, cx - s * 0.15), g(n, cy - s * 0.24)),
                   (g(n, cx + s * 0.24), g(n, cy)),
                   (g(n, cx - s * 0.15), g(n, cy + s * 0.24))], fill=k)


def play_bare(d, n, box, col, _hole=None):
    """The triangle alone, as big as the box allows."""
    cx, cy, s = _c(box)
    d.polygon([(g(n, cx - s * 0.32), g(n, cy - s * 0.44)),
               (g(n, cx + s * 0.42), g(n, cy)),
               (g(n, cx - s * 0.32), g(n, cy + s * 0.44))], fill=col)


def play_circle(d, n, box, col, hole=None):
    """A disc with the triangle punched out."""
    cx, cy, s = _c(box)
    r = s * 0.45
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    k = _hole(hole)
    if k:
        d.polygon([(g(n, cx - s * 0.14), g(n, cy - s * 0.23)),
                   (g(n, cx + s * 0.24), g(n, cy)),
                   (g(n, cx - s * 0.14), g(n, cy + s * 0.23))], fill=k)


def strip_v(d, n, box, col, hole=None):
    """A length of film stood upright, sprockets down both edges."""
    cx, cy, s = _c(box)
    w, h = s * 0.40, s * 0.46
    d.rounded_rectangle([g(n, cx - w), g(n, cy - h), g(n, cx + w), g(n, cy + h)],
                        radius=g(n, s * 0.06), fill=col)
    k = _hole(hole)
    if k:
        hw, hh = s * 0.085, s * 0.075
        for i in range(3):
            y = cy - h * 0.60 + i * h * 0.60
            for x in (cx - w + s * 0.115, cx + w - s * 0.115):
                d.rounded_rectangle([g(n, x - hw), g(n, y - hh), g(n, x + hw), g(n, y + hh)],
                                    radius=g(n, s * 0.03), fill=k)
            d.rectangle([g(n, cx - w * 0.42), g(n, y - hh * 1.5),
                         g(n, cx + w * 0.42), g(n, y + hh * 1.5)], fill=k)


def frame_h(d, n, box, col, hole=None):
    """One frame of film lying flat, sprockets along the top and bottom."""
    cx, cy, s = _c(box)
    w, h = s * 0.46, s * 0.34
    d.rounded_rectangle([g(n, cx - w), g(n, cy - h), g(n, cx + w), g(n, cy + h)],
                        radius=g(n, s * 0.06), fill=col)
    k = _hole(hole)
    if k:
        hw, hh = s * 0.075, s * 0.075
        for i in range(4):
            x = cx - w * 0.66 + i * w * 0.44
            for y in (cy - h + s * 0.115, cy + h - s * 0.115):
                d.rounded_rectangle([g(n, x - hw), g(n, y - hh), g(n, x + hw), g(n, y + hh)],
                                    radius=g(n, s * 0.03), fill=k)


def reel(d, n, box, col, hole=None):
    """A reel: a disc with four windows and a hub."""
    cx, cy, s = _c(box)
    r = s * 0.46
    d.ellipse([g(n, cx - r), g(n, cy - r), g(n, cx + r), g(n, cy + r)], fill=col)
    k = _hole(hole)
    if k:
        wr = s * 0.135
        for i in range(4):
            a = math.radians(45 + i * 90)
            px, py = cx + math.cos(a) * r * 0.52, cy + math.sin(a) * r * 0.52
            d.ellipse([g(n, px - wr), g(n, py - wr), g(n, px + wr), g(n, py + wr)], fill=k)
        hub = s * 0.10
        d.ellipse([g(n, cx - hub), g(n, cy - hub), g(n, cx + hub), g(n, cy + hub)], fill=k)


def camcorder(d, n, box, col, hole=None):
    """A camera body with a lens and a viewfinder wedge."""
    cx, cy, s = _c(box)
    w, h = s * 0.34, s * 0.26
    d.rounded_rectangle([g(n, cx - w - s * 0.08), g(n, cy - h), g(n, cx + w * 0.5), g(n, cy + h)],
                        radius=g(n, s * 0.07), fill=col)
    d.polygon([(g(n, cx + w * 0.55), g(n, cy - h * 0.72)),
               (g(n, cx + w + s * 0.10), g(n, cy - h * 0.15)),
               (g(n, cx + w + s * 0.10), g(n, cy + h * 0.15)),
               (g(n, cx + w * 0.55), g(n, cy + h * 0.72))], fill=col)
    k = _hole(hole)
    if k:
        lr = s * 0.115
        d.ellipse([g(n, cx - w * 0.45 - lr), g(n, cy - lr),
                   g(n, cx - w * 0.45 + lr), g(n, cy + lr)], fill=k)


def screen_play(d, n, box, col, hole=None):
    """A screen on a stand, with the triangle punched out of it."""
    cx, cy, s = _c(box)
    w, h = s * 0.46, s * 0.32
    top = cy - s * 0.30
    d.rounded_rectangle([g(n, cx - w), g(n, top - h * 0.5), g(n, cx + w), g(n, top + h)],
                        radius=g(n, s * 0.07), fill=col)
    d.rectangle([g(n, cx - s * 0.07), g(n, top + h), g(n, cx + s * 0.07),
                 g(n, top + h + s * 0.16)], fill=col)
    d.rounded_rectangle([g(n, cx - s * 0.26), g(n, top + h + s * 0.14),
                         g(n, cx + s * 0.26), g(n, top + h + s * 0.26)],
                        radius=g(n, s * 0.05), fill=col)
    k = _hole(hole)
    if k:
        d.polygon([(g(n, cx - s * 0.11), g(n, top - s * 0.02)),
                   (g(n, cx + s * 0.19), g(n, top + h * 0.26)),
                   (g(n, cx - s * 0.11), g(n, top + h * 0.54))], fill=k)


def frames_two(d, n, box, col, hole=None):
    """Two frames, one behind the other - a sequence rather than a picture."""
    cx, cy, s = _c(box)
    w, h, off = s * 0.36, s * 0.27, s * 0.11
    d.rounded_rectangle([g(n, cx - w - off), g(n, cy - h - off),
                         g(n, cx + w - off), g(n, cy + h - off)],
                        radius=g(n, s * 0.06), fill=col)
    k = _hole(hole)
    if k:
        d.rounded_rectangle([g(n, cx - w + off - s * 0.05), g(n, cy - h + off - s * 0.05),
                             g(n, cx + w + off + s * 0.05), g(n, cy + h + off + s * 0.05)],
                            radius=g(n, s * 0.08), fill=k)
    d.rounded_rectangle([g(n, cx - w + off), g(n, cy - h + off),
                         g(n, cx + w + off), g(n, cy + h + off)],
                        radius=g(n, s * 0.06), fill=col)


def wide_screen(d, n, box, col, hole=None):
    """A 16:9 block with the triangle punched out. The simplest thing that works."""
    cx, cy, s = _c(box)
    w = s * 0.48
    h = w * 9 / 16
    d.rounded_rectangle([g(n, cx - w), g(n, cy - h), g(n, cx + w), g(n, cy + h)],
                        radius=g(n, s * 0.07), fill=col)
    k = _hole(hole)
    if k:
        d.polygon([(g(n, cx - s * 0.11), g(n, cy - s * 0.16)),
                   (g(n, cx + s * 0.18), g(n, cy)),
                   (g(n, cx - s * 0.11), g(n, cy + s * 0.16))], fill=k)


def clapper_two(d, n, box, col, hole=None):
    """The clapperboard with TWO stripes instead of three - the in-app cut."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    d.rounded_rectangle([g(n, x0), g(n, y0 + h * 0.34), g(n, x1), g(n, y1)],
                        radius=g(n, w * 0.05), fill=col)
    d.rounded_rectangle([g(n, x0), g(n, y0), g(n, x1), g(n, y0 + h * 0.27)],
                        radius=g(n, w * 0.04), fill=col)
    k = _hole(hole)
    if k:
        for i in range(2):
            sx = x0 + w * (0.16 + i * 0.40)
            d.polygon([(g(n, sx), g(n, y0)), (g(n, sx + w * 0.15), g(n, y0)),
                       (g(n, sx + w * 0.05), g(n, y0 + h * 0.27)),
                       (g(n, sx - w * 0.10), g(n, y0 + h * 0.27))], fill=k)


CANDIDATES = [
    ("clapper", "The clapperboard|what ships today", clapper),
    ("clapper2", "Clapperboard, two stripes|the cut the in-app icon already uses", clapper_two),
    ("wide", "Widescreen block|a 16:9 frame with the triangle punched out", wide_screen),
    ("play-round", "Play, in a tile|rounded square, triangle knocked out", play_round),
    ("play-circle", "Play, in a disc|the same, round", play_circle),
    ("play-bare", "Play alone|no container at all", play_bare),
    ("strip", "Film strip|stood upright, sprockets down both edges", strip_v),
    ("frame", "One frame|lying flat, sprockets top and bottom", frame_h),
    ("reel", "Reel|a disc with four windows and a hub", reel),
    ("camcorder", "Camcorder|body, lens and viewfinder", camcorder),
    ("screen", "Screen on a stand|the triangle punched out of it", screen_play),
    ("frames", "Two frames|a sequence rather than a picture", frames_two),
]


def icon(size, glyph):
    return _page_kind_with("video", size, glyph, text="MP4")


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


HEAD = """<meta charset="utf-8"><title>Prism video mark, round 31</title>
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
 .lens .strip{display:flex;gap:14px;background:#202020;padding:8px 10px;border-radius:7px}
 .lens .one{display:flex;align-items:center;gap:6px;font:12px "Segoe UI",system-ui;color:#e6e6e6}
 footer{color:var(--dim);padding:22px 32px 46px;max-width:78ch}
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    others = {k: _png(render(k, 16)) for k in ("image", "audio")}
    cards = []
    for i, (key, label, glyph) in enumerate(CANDIDATES, 1):
        made = {s: _png(icon(s, glyph)) for s in SIZES}
        sizes = "".join(f'<img src="{made[s]}" width="{s}" height="{s}" alt="">' for s in SIZES)
        grounds = "".join(
            f'<div class="ground {mode}"><div class="sizes">{sizes}</div>'
            f'<div class="row"><img src="{made[16]}" width="16" height="16" alt="">'
            f'holiday-2024.mp4</div></div>' for mode in ("dark", "light"))
        zooms = "".join(
            f'<div class="{mode}"><img class="zoom" src="{made[16]}" '
            f'width="{ZOOM}" height="{ZOOM}" alt=""></div>' for mode in ("dark", "light"))
        head, sub = label.split("|")
        cards.append(f"""  <div class="card">
    <div class="name"><span class="num">{i}</span>
      <span class="what">{head}<small>{sub}</small></span></div>
    <div class="grounds">{grounds}</div>
    <div class="zooms">{zooms}</div>
    <div class="lens">
      <div class="cap">Beside image and audio at 16px - image is the one it can be confused with</div>
      <div class="strip">
        <span class="one"><img src="{made[16]}" width="16" height="16" alt="">clip.mp4</span>
        <span class="one"><img src="{others['image']}" width="16" height="16" alt="">photo.jpg</span>
        <span class="one"><img src="{others['audio']}" width="16" height="16" alt="">song.mp3</span>
      </div>
    </div>
  </div>""")
    parts = [HEAD, """<header>
  <h1>The video mark, round 31</h1>
  <p>Twelve marks, each drawn through the REAL renderer - the shipped page, its fold, its
  footer band with MP4 on it, its colours. A mark is judged in the frame it lives in, not
  beside it, so only the glyph moves.</p>
  <p>Detail is the first thing a 16px frame spends: a clapperboard's stripes are a pixel
  each, a strip's sprockets close up, a reel's holes fill in. Everything here is FILLED
  rather than stroked, and anything that must stay open is a hole in the page colour.
  Judge it on the 16px strip at the bottom of each card, next to IMAGE - the one mark it
  can actually be confused with, both being a rectangle with something in it. Pick by
  number.</p>
</header>""", '<div class="grid">', *cards, "</div>", """<footer>Every size is drawn at
  that size, never downsampled from one big render; the magnified frame is the real 16px
  one at 6x.</footer>"""]
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
