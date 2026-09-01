"""Round 32: where the ARCHIVE's label goes, now the rest of the set has a band.

Every other kind moved its extension to a band across the foot of the page.
Archive did not, because it is not a page: it is a landscape container with a
zip running down the middle and a tab at the top-left, and the reason its chip
sits LOW is that a chip over the top hides the tab that says which container it
is. That reason is still true. What is no longer true is that a corner chip
looks like the rest of the set - it is now the one label in the whole set that
is not a band.

So this asks the question properly, with the container's own two obstacles in
view: the TAB at the top and the PULL at the bottom of the zip, which sits
exactly where a footer band would go.

Every candidate is drawn through the real archive renderer - the same folder,
the same teeth, the same colours - with only the label's shape and place
moving.

    python round32.py <outdir>
"""
import base64
import pathlib
import sys
from io import BytesIO

from PIL import Image, ImageDraw

from final_icons import PAGE, render
from icons import S
from round15 import AX0, AX1, AY0, AY1, CHIP_A, _label_at, folder_zip, folder_zip_ink
from round12 import INK
from round5 import g

SIZES = (16, 24, 32, 48)
ZOOM = 96
INK_A = tuple(INK) + (255,)
PAGE_A = tuple(PAGE) + (255,)

# The band the page kinds use, in the CONTAINER's coordinates: the same height,
# run across the bottom of the folder rather than the bottom of a page.
BAND_H = CHIP_A[3] - CHIP_A[1]
BAND = (AX0, AY1 - BAND_H, AX1, AY1)


def base(n):
    """The folder and its zip, with nothing said about the label yet."""
    body = Image.new("L", (n, n), 0)
    folder_zip(ImageDraw.Draw(body), n, 255)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (n, n), PAGE_A), (0, 0), body)
    ink = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    folder_zip_ink(ImageDraw.Draw(ink), n, INK_A, (0, 0, 0, 0))
    out.alpha_composite(Image.composite(ink, Image.new("RGBA", (n, n), (0, 0, 0, 0)), body))
    return out, body


def clip(out, layer, body, n):
    out.alpha_composite(Image.composite(layer, Image.new("RGBA", (n, n), (0, 0, 0, 0)), body))


# ------------------------------------------------------------ the treatments
def chip_low(out, body, n, ext):
    """What ships: an overhanging chip, low, clear of the tab."""
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([g(n, CHIP_A[0]), g(n, CHIP_A[1]), g(n, CHIP_A[2]), g(n, CHIP_A[3])],
                        radius=g(n, 0.7), fill=INK_A)
    (tx, ty), f = _label_at(n, ext, CHIP_A)
    d.text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def band_full(out, body, n, ext):
    """The page kinds' band, clipped to the container."""
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle(
        [g(n, BAND[0]), g(n, BAND[1]), g(n, BAND[2]), g(n, BAND[3])], fill=INK_A)
    clip(out, layer, body, n)
    (tx, ty), f = _label_at(n, ext, BAND)
    ImageDraw.Draw(out).text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def band_short(out, body, n, ext):
    """A shallower band, so more of the zip survives above it."""
    box = (AX0, AY1 - BAND_H * 0.76, AX1, AY1)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle(
        [g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])], fill=INK_A)
    clip(out, layer, body, n)
    (tx, ty), f = _label_at(n, ext, box)
    ImageDraw.Draw(out).text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def band_ribbon(out, body, n, ext):
    """A band that leaves the container on both sides, unclipped."""
    box = (0.4, AY1 - BAND_H, 15.6, AY1)
    d = ImageDraw.Draw(out)
    d.rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])], fill=INK_A)
    (tx, ty), f = _label_at(n, ext, box)
    d.text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def chip_centre(out, body, n, ext):
    """The chip, centred at the foot and not overhanging."""
    w = CHIP_A[2] - CHIP_A[0]
    cx = (AX0 + AX1) / 2
    box = (cx - w / 2, AY1 - BAND_H - 0.5, cx + w / 2, AY1 - 0.5)
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                        radius=g(n, 0.7), fill=INK_A)
    (tx, ty), f = _label_at(n, ext, box)
    d.text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def chip_wide(out, body, n, ext):
    """The chip stretched to the container's full width, still a chip."""
    box = (CHIP_A[0], CHIP_A[1], AX1 - 0.4, CHIP_A[3])
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])],
                        radius=g(n, 0.7), fill=INK_A)
    (tx, ty), f = _label_at(n, ext, box)
    d.text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def band_top(out, body, n, ext):
    """A band under the TAB rather than over it - the one place up there that is free."""
    box = (AX0, AY0 + 1.2, AX1, AY0 + 1.2 + BAND_H)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle(
        [g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])], fill=INK_A)
    clip(out, layer, body, n)
    (tx, ty), f = _label_at(n, ext, box)
    ImageDraw.Draw(out).text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def band_right(out, body, n, ext):
    """Half a band, on the right, leaving the zip's pull uncovered."""
    cx = (AX0 + AX1) / 2
    box = (cx - 1.9, AY1 - BAND_H, AX1, AY1)
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle(
        [g(n, box[0]), g(n, box[1]), g(n, box[2]), g(n, box[3])], fill=INK_A)
    clip(out, layer, body, n)
    (tx, ty), f = _label_at(n, ext, box)
    ImageDraw.Draw(out).text((tx, ty), ext, font=f, fill=PAGE_A, anchor="mm")


def bare(out, body, n, ext):
    """No container: the extension set on the folder itself, in ink.

    On the RIGHT half rather than centred, and that is the candidate's whole
    problem in one line: the zip's PULL is ink too and sits dead centre at the
    foot, so a centred label lands on it and disappears - ink on ink. With a
    chip or a band there is something behind the letters and it does not matter.
    """
    cx = (AX0 + AX1) / 2
    box = (cx + 1.9, AY1 - BAND_H, AX1 - 0.4, AY1 - 0.5)
    (tx, ty), f = _label_at(n, ext, box)
    ImageDraw.Draw(out).text((tx, ty), ext, font=f, fill=INK_A, anchor="mm")


CANDIDATES = [
    ("chip", "The low chip|what ships today - the only label in the set that is not a band",
     chip_low),
    ("band", "The page kinds' band|full width, clipped to the container", band_full),
    ("short", "A shallower band|more of the zip survives above it", band_short),
    ("ribbon", "A ribbon|leaves the container on both sides", band_ribbon),
    ("centre", "Chip, centred|no overhang, sitting on the foot", chip_centre),
    ("wide", "Chip, full width|still a chip, but the width of a band", chip_wide),
    ("top", "A band under the tab|the one place up there that is free", band_top),
    ("right", "Half a band, right|leaves the zip's pull uncovered", band_right),
    ("bare", "No container|set on the folder itself, in ink", bare),
]


def icon(size, fn, ext="ZIP"):
    n = size * S
    out, body = base(n)
    fn(out, body, n, ext)
    return out.resize((size, size), Image.LANCZOS)


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


HEAD = """<meta charset="utf-8"><title>Prism archive label, round 32</title>
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
    doc = _png(render("document", 16))
    cards = []
    for i, (key, label, fn) in enumerate(CANDIDATES, 1):
        made = {s: _png(icon(s, fn)) for s in SIZES}
        rar = _png(icon(16, fn, "RAR"))
        sizes = "".join(f'<img src="{made[s]}" width="{s}" height="{s}" alt="">' for s in SIZES)
        grounds = "".join(
            f'<div class="ground {mode}"><div class="sizes">{sizes}</div>'
            f'<div class="row"><img src="{made[16]}" width="16" height="16" alt="">'
            f'photos.zip</div></div>' for mode in ("dark", "light"))
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
      <div class="cap">At 16px, and beside a page kind - the set has to look like one set</div>
      <div class="strip">
        <span class="one"><img src="{made[16]}" width="16" height="16" alt="">photos.zip</span>
        <span class="one"><img src="{rar}" width="16" height="16" alt="">backup.rar</span>
        <span class="one"><img src="{doc}" width="16" height="16" alt="">notes.docx</span>
      </div>
    </div>
  </div>""")
    parts = [HEAD, """<header>
  <h1>The archive's label, round 32</h1>
  <p>Every other kind moved its extension to a band across the foot. Archive did not,
  because it is not a page: it is a landscape container with a zip down the middle and a
  tab at the top-left, and its chip sits LOW precisely because a chip over the top hides
  the tab that says which container it is. That reason still holds. What no longer holds
  is that a corner chip matches the set - it is the only label left that is not a band.</p>
  <p>Two obstacles are in view in every card: the TAB at the top, and the zip's PULL at
  the bottom, which sits exactly where a footer band wants to go. Judge it on the 16px
  strip, where a .zip, a .rar and a page kind sit together - the set has to look like one
  set. Pick by number.</p>
</header>""", '<div class="grid">', *cards, "</div>", """<footer>Every candidate is drawn
  through the real archive renderer - the same folder, the same teeth, the same colours -
  with only the label's shape and place moving. Every size is drawn at that size, never
  downsampled; the magnified frame is the real 16px one at 6x.</footer>"""]
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
