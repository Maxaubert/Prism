"""Round 33: an icon of its own for .iso, IN THE APP ONLY (owner, 2026-09-03).

A disc image is classed as an archive - it opens read-only through 7-Zip like
a .7z - so it wears the zip's container in the tree, and in Explorer the
Prism.Iso class carries that same artwork. The owner wants the tree to say
"disc" rather than "box"; Explorer's icon stays as it is.

So this is a DISC, drawn in the set's language: one flat silhouette in the
page colour, its detail knocked out to the ground, the extension on a band
across the foot like every other kind. Every candidate keeps the hole - a disc
without one is a coin - and they differ in how much else the silhouette
carries, because at 16px each extra mark costs a pixel the hole needs.

    python round33.py <outdir>       writes index.html and sheet.png
"""
import base64
import math
import pathlib
import sys
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont

from final_icons import PAGE, render
from icons import S
from round12 import INK
from round15 import CHIP_A, _label_at

SIZES = (16, 24, 32, 48)
ZOOM = 96
INK_A = tuple(INK) + (255,)
PAGE_A = tuple(PAGE) + (255,)
CLEAR = (0, 0, 0, 0)

# The disc's box, in sixteenths like every other glyph: the same frame height
# the page uses (15 of 16), centred.
D0, D1 = 0.5, 15.5
BAND_H = CHIP_A[3] - CHIP_A[1]


def _unit(n):
    return n / 16.0


def _disc_body(n, pad=0.0):
    u = _unit(n)
    body = Image.new("L", (n, n), 0)
    ImageDraw.Draw(body).ellipse([(D0 + pad) * u, (D0 + pad) * u, (D1 - pad) * u, (D1 - pad) * u], fill=255)
    return body


def _hole(draw, n, r=2.1):
    u = _unit(n)
    c = 8.0 * u
    draw.ellipse([c - r * u, c - r * u, c + r * u, c + r * u], fill=255)


def _band(out, body, n, ext):
    """The set's footer band, clipped to the disc, label knocked out."""
    u = _unit(n)
    band = Image.new("L", (n, n), 0)
    ImageDraw.Draw(band).rectangle([0, (D1 - BAND_H) * u, n, D1 * u], fill=255)
    band = Image.composite(band, Image.new("L", (n, n), 0), body)
    ink = Image.new("RGBA", (n, n), INK_A)
    out.paste(ink, (0, 0), band)
    # the label, in the page colour, the same sizing rule as every band
    (tx, ty), f = _label_at(n, ext, (D0 + 1.2, D1 - BAND_H, D1 - 1.2, D1))
    lab = Image.new("L", (n, n), 0)
    ImageDraw.Draw(lab).text((tx, ty), ext, font=f, fill=255, anchor="mm")
    out.paste(Image.new("RGBA", (n, n), PAGE_A), (0, 0), Image.composite(lab, Image.new("L", (n, n), 0), band))


def base(n):
    body = _disc_body(n)
    out = Image.new("RGBA", (n, n), CLEAR)
    out.paste(Image.new("RGBA", (n, n), PAGE_A), (0, 0), body)
    return out, body


def ko(out, n, mask):
    """Knock a mask out of the disc, to the ground."""
    out.paste(Image.new("RGBA", (n, n), CLEAR), (0, 0), mask)


# ------------------------------------------------------------------ candidates
def plain(out, body, n, ext):
    m = Image.new("L", (n, n), 0)
    _hole(ImageDraw.Draw(m), n)
    ko(out, n, m)
    _band(out, body, n, ext)


def ring(out, body, n, ext):
    """A hole and a hairline ring at the data edge."""
    u = _unit(n)
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    _hole(d, n)
    c = 8.0 * u
    r = 4.2 * u
    d.ellipse([c - r, c - r, c + r, c + r], outline=255, width=max(1, int(0.55 * u)))
    ko(out, n, m)
    _band(out, body, n, ext)


def sheen(out, body, n, ext):
    """A hole and a wedge of reflection, the way a CD catches light."""
    u = _unit(n)
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    _hole(d, n)
    c = 8.0 * u
    R = 7.5 * u
    d.pieslice([c - R, c - R, c + R, c + R], start=205, end=235, fill=255)
    d.pieslice([c - R, c - R, c + R, c + R], start=25, end=55, fill=255)
    inner = Image.new("L", (n, n), 0)
    ImageDraw.Draw(inner).ellipse([c - 3.3 * u, c - 3.3 * u, c + 3.3 * u, c + 3.3 * u], fill=255)
    m = Image.composite(Image.new("L", (n, n), 0), m, inner)  # the wedges stop at the hub
    _hole(ImageDraw.Draw(m), n)
    ko(out, n, m)
    _band(out, body, n, ext)


def hub(out, body, n, ext):
    """A small hole inside a wider hub ring: the disc's own centre."""
    u = _unit(n)
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    c = 8.0 * u
    d.ellipse([c - 3.0 * u, c - 3.0 * u, c + 3.0 * u, c + 3.0 * u], outline=255, width=max(1, int(0.6 * u)))
    _hole(d, n, r=1.5)
    ko(out, n, m)
    _band(out, body, n, ext)


def sleeve(out, body, n, ext):
    """A disc half out of a sleeve: the page kinds' rectangle behind it."""
    u = _unit(n)
    # redraw: sleeve first, disc over it, offset to the right
    out.paste(Image.new("RGBA", (n, n), CLEAR), (0, 0))
    sl = Image.new("L", (n, n), 0)
    ImageDraw.Draw(sl).rounded_rectangle([1.0 * u, 2.0 * u, 11.5 * u, 15.5 * u], radius=1.0 * u, fill=255)
    disc = Image.new("L", (n, n), 0)
    ImageDraw.Draw(disc).ellipse([4.5 * u, 3.0 * u, 15.5 * u, 14.0 * u], fill=255)
    both = Image.new("L", (n, n), 0)
    both.paste(255, (0, 0), sl)
    both.paste(255, (0, 0), disc)
    out.paste(Image.new("RGBA", (n, n), PAGE_A), (0, 0), both)
    # the seam between sleeve and disc, and the hole
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    d.ellipse([4.5 * u - 0.7 * u, 3.0 * u - 0.7 * u, 15.5 * u + 0.7 * u, 14.0 * u + 0.7 * u], outline=255, width=max(1, int(0.7 * u)))
    m = Image.composite(m, Image.new("L", (n, n), 0), sl)
    c = (10.0 * u, 8.5 * u)
    d2 = ImageDraw.Draw(m)
    d2.ellipse([c[0] - 1.9 * u, c[1] - 1.9 * u, c[0] + 1.9 * u, c[1] + 1.9 * u], fill=255)
    ko(out, n, m)
    body.paste(both)
    _band(out, body, n, ext)


def stack(out, body, n, ext):
    """A disc over a tray line: the spindle, the stack of them."""
    u = _unit(n)
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    _hole(d, n)
    ko(out, n, m)
    # a tray under the disc, in ink, outside the silhouette
    tray = Image.new("RGBA", (n, n), CLEAR)
    ImageDraw.Draw(tray).rounded_rectangle([0.5 * u, 13.2 * u, 15.5 * u, 15.5 * u], radius=0.6 * u, fill=PAGE_A)
    out.alpha_composite(tray)
    b2 = Image.new("L", (n, n), 0)
    b2.paste(255, (0, 0), body)
    ImageDraw.Draw(b2).rounded_rectangle([0.5 * u, 13.2 * u, 15.5 * u, 15.5 * u], radius=0.6 * u, fill=255)
    body.paste(b2)
    _band(out, body, n, ext)


CANDIDATES = [
    ("plain", "A disc|the hole and nothing else; the band carries ISO", plain),
    ("ring", "Disc, data edge|a hairline ring where the data starts", ring),
    ("sheen", "Disc, catching light|two wedges of reflection", sheen),
    ("hub", "Disc, hub|a small hole inside the hub ring", hub),
    ("sleeve", "Half out of a sleeve|the page's rectangle behind the disc", sleeve),
    ("stack", "On a spindle tray|a disc over a tray line", stack),
]


def icon(size, fn, ext="ISO"):
    n = size * S
    out, body = base(n)
    fn(out, body, n, ext)
    return out.resize((size, size), Image.LANCZOS)


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def sheet(out_dir):
    """One PNG with every candidate at every size on both grounds, plus 6x."""
    pad, cell_w, cell_h = 14, 300, 96
    W = pad * 2 + cell_w * 2 + 130
    H = pad + len(CANDIDATES) * (cell_h + pad)
    img = Image.new("RGB", (W, H), (20, 21, 25))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("segoeui.ttf", 13)
    except OSError:
        font = ImageFont.load_default()
    zipi = render("archive", 16).convert("RGBA")
    for i, (key, label, fn) in enumerate(CANDIDATES):
        y = pad + i * (cell_h + pad)
        d.text((pad, y + 4), f"{i + 1}  {label.split('|')[0]}", fill=(233, 237, 247), font=font)
        d.text((pad, y + 24), label.split("|")[1], fill=(139, 144, 160), font=font)
        for gi, (ground, fg) in enumerate((((32, 32, 32), (230, 230, 230)), ((247, 247, 247), (27, 27, 27)))):
            x0 = pad + 130 + gi * (cell_w + pad)
            d.rounded_rectangle([x0, y, x0 + cell_w, y + cell_h], radius=8, fill=ground)
            x = x0 + 10
            for s in SIZES:
                ic = icon(s, fn)
                img.paste(ic, (x, y + 10 + (48 - s)), ic)
                x += s + 12
            # beside the zip, in a row, as the tree shows them
            row_y = y + 70
            ic16 = icon(16, fn)
            img.paste(ic16, (x0 + 10, row_y), ic16)
            d.text((x0 + 32, row_y + 1), "game.iso", fill=fg, font=font)
            img.paste(zipi, (x0 + 120, row_y), zipi)
            d.text((x0 + 142, row_y + 1), "photos.zip", fill=fg, font=font)
            z = icon(16, fn).resize((64, 64), Image.NEAREST)
            img.paste(z, (x0 + cell_w - 74, y + 8), z)
    p = pathlib.Path(out_dir) / "sheet.png"
    img.save(p)
    return p


HEAD = """<meta charset="utf-8"><title>Prism .iso icon, round 33</title>
<style>
 :root{color-scheme:dark;--bg:#141519;--panel:#1b1d22;--line:#2b2e36;--text:#e9edf7;--dim:#8b90a0;--accent:#7c7cf0}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 "Segoe UI",system-ui,sans-serif}
 header{padding:28px 32px 4px} h1{margin:0 0 6px;font-size:19px;font-weight:650}
 header p{margin:0 0 6px;color:var(--dim);max-width:76ch}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr));gap:14px;padding:14px 32px 8px}
 .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px 16px}
 .name{display:flex;align-items:baseline;gap:9px;margin-bottom:11px}
 .num{display:grid;place-items:center;width:22px;height:22px;border-radius:6px;background:var(--accent);color:#0d0f16;font-size:12px;font-weight:750}
 .what{font-weight:600;line-height:1.32} .what small{display:block;font-weight:400;color:var(--dim);font-size:12.5px}
 .grounds{display:flex;gap:10px} .ground{flex:1;border:1px solid var(--line);border-radius:9px;padding:11px 12px}
 .dark{background:#202020} .light{background:#f7f7f7;border-color:#dcdcdc}
 .sizes{display:flex;align-items:flex-end;gap:13px;min-height:52px}
 .zooms{display:flex;gap:10px;margin-top:10px} .zooms > div{flex:1;border:1px solid var(--line);border-radius:9px;padding:8px}
 .row{display:flex;align-items:center;gap:7px;margin-top:10px;font:12px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
 .dark .row{color:#e6e6e6}.light .row{color:#1b1b1b} img{display:block} .zoom{image-rendering:pixelated}
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    zipi = _png(render("archive", 16))
    cards = []
    for i, (key, label, fn) in enumerate(CANDIDATES, 1):
        made = {s: _png(icon(s, fn)) for s in SIZES}
        sizes = "".join(f'<img src="{made[s]}" width="{s}" height="{s}" alt="">' for s in SIZES)
        grounds = "".join(
            f'<div class="ground {mode}"><div class="sizes">{sizes}</div>'
            f'<div class="row"><img src="{made[16]}" width="16" height="16" alt="">game.iso'
            f'&nbsp;&nbsp;<img src="{zipi}" width="16" height="16" alt="">photos.zip</div></div>'
            for mode in ("dark", "light"))
        zooms = "".join(
            f'<div class="{mode}"><img class="zoom" src="{made[16]}" width="{ZOOM}" height="{ZOOM}" alt=""></div>'
            for mode in ("dark", "light"))
        head, sub = label.split("|")
        cards.append(f'<div class="card"><div class="name"><span class="num">{i}</span>'
                     f'<span class="what">{head}<small>{sub}</small></span></div>'
                     f'<div class="grounds">{grounds}</div><div class="zooms">{zooms}</div></div>')
    parts = [HEAD, "<header><h1>The .iso icon, round 33</h1><p>In the app only: Explorer keeps the archive "
             "artwork. A disc in the set's language - one silhouette, its detail knocked out, the extension "
             "on the foot band. Judge the 16px row beside the zip. Pick by number.</p></header>",
             '<div class="grid">', *cards, "</div>"]
    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")
    print(sheet(out))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
