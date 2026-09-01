"""The real language logos, in their brand colours, on the monochrome page.

Owner, 2026-09-01: the code icons should carry "there colroed glyuph in there
style liek the blue react lgoo, or the yellow and blue python logo", and "make
sure you actually use the glyphs not look a likes".

WHAT THIS IS. The shipped marks are hand-drawn approximations - an atom for
React, two stacked shapes for Python - and at a glance they read as the right
idea rather than as the logo. These are the OFFICIAL glyphs, taken from Simple
Icons (CC0, the set every editor's icon theme draws from), so the geometry is
the real thing rather than a likeness of it, and each wears the brand's own
published hex.

THE PROBLEM THIS PAGE EXISTS TO SHOW. Everything except the six document kinds
is monochrome now, and monochrome means the page is WHITE on a dark theme and a
NEAR-BLACK on a light one - measured against the row's own ground, which is the
whole point of it. A brand colour is a fixed value, so it can only suit one end
of that. React's #61DAFB is 1.63:1 on white and 12.4:1 on the dark page; Python's
#3776AB is the other way round. There is no single answer, so both are drawn:

    BRAND     the published hex, unchanged
    STEPPED   the same hue walked toward the page until it clears 4.5:1, the
              trick `archiveIconOf` already uses for the amber parcel

    python logoround.py <outdir>
"""
import pathlib
import re
import sys

import svg

# Simple Icons slugs, with the brand's own published hex. JSON, OpenJDK and
# Markdown publish #000000, which is a logo colour rather than a usable ink, so
# they take the language's own well-known colour instead - noted rather than
# quietly substituted.
LOGOS = {
    "python": ("python", "#3776AB"),
    "react": ("react", "#61DAFB"),
    "vue": ("vuedotjs", "#4FC08D"),
    "ruby": ("ruby", "#CC342D"),
    "java": ("openjdk", "#5382A1"),      # OpenJDK publishes #000000
    "swift": ("swift", "#F05138"),
    "docker": ("docker", "#2496ED"),
    "git": ("git", "#F05032"),
    "html": ("html5", "#E34F26"),
    "css": ("css3", "#1572B6"),
    "data": ("json", "#F0DB4F"),         # JSON publishes #000000; this is JS yellow
    "config": ("yaml", "#CB171E"),
    "sql": ("mysql", "#4479A1"),
}

# The glyph box, in the 24-unit viewBox the paths already use.
BOX24 = tuple(round(v * svg.SCALE, 3) for v in svg.BOX)


def _lum(c):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _hex(c):
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in c)


def ratio(a, b):
    la, lb = _lum(_rgb(a)), _lum(_rgb(b))
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def stepped(brand, page, target=4.5, steps=20):
    """The brand hue walked AWAY from the page until it clears `target`.

    Same shape as `archiveIconOf`: mix toward black on a light page and toward
    white on a dark one, a tenth at a time, and stop as soon as it is legible.
    Keeps the hue, which is the part that carries the brand.
    """
    page_dark = _lum(_rgb(page)) < 0.5
    toward = (255, 255, 255) if page_dark else (0, 0, 0)
    c = _rgb(brand)
    for _ in range(steps):
        if ratio(_hex(c), page) >= target:
            break
        c = tuple(c[i] + (toward[i] - c[i]) * 0.1 for i in range(3))
    return _hex(c)


def logo_path(slug, root):
    """The `d` of a Simple Icons file, and the transform onto the glyph box."""
    src = (root / f"{slug}.svg").read_text(encoding="utf-8")
    m = re.search(r'\sd="([^"]+)"', src)
    if not m:
        raise SystemExit(f"no path in {slug}.svg")
    x0, y0, x1, y1 = BOX24
    k = min(x1 - x0, y1 - y0) / 24.0
    tx = x0 + ((x1 - x0) - 24 * k) / 2
    ty = y0 + ((y1 - y0) - 24 * k) / 2
    return m.group(1), f"translate({tx:.3f} {ty:.3f}) scale({k:.4f})"


def icon(d, path, xform, colour, page, ko, px, ext, uid):
    """The monochrome icon with a COLOURED logo where its mark would be."""
    L = d["label"]
    size = L["sizes"][min(len(ext), 6)]
    return (
        f'<svg viewBox="0 0 24 24" width="{px}" height="{px}">'
        f'<path d="{d["body"]}" fill="{page}"/>'
        f'<path d="{d["koBand"]}" fill="{ko}"/>'
        f'<g transform="{xform}"><path d="{path}" fill="{colour}"/></g>'
        f'<text x="{L["x"]}" y="{L["y"]}" font-size="{size}" fill="{page}"'
        f' text-anchor="middle" dominant-baseline="central" font-weight="700"'
        f' font-family="Segoe UI,system-ui,sans-serif">{ext}</text></svg>')


HEAD = """<meta charset="utf-8">
<title>Prism: real language logos</title>
<style>
  :root { color-scheme: dark; --bg:#141519; --panel:#1b1d22; --line:#2b2e36;
          --text:#e9edf7; --dim:#8b90a0; --hl:#7c7cf0 }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif }
  header { padding:24px 30px 6px }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650 }
  header p { margin:0 0 5px; color:var(--dim); max-width:90ch }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(390px,1fr));
          gap:12px; padding:16px 30px 44px }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:13px 15px 14px }
  h3 { margin:0 0 1px; font-size:13.5px; font-weight:650 }
  .sub { margin:0 0 10px; font:11.5px ui-monospace,Consolas,monospace; color:var(--hl) }
  .pair { display:flex; gap:9px }
  .half { flex:1 }
  .cap { font-size:10.5px; color:var(--dim); letter-spacing:.04em; margin-bottom:4px }
  .row { display:flex; align-items:flex-end; gap:9px; padding:10px 11px; border-radius:9px }
  .d { background:#1b1d22 } .l { background:#f7f7f7 }
  .m { margin-top:8px; font-size:11.5px; color:var(--dim); font-variant-numeric:tabular-nums }
  .bad { color:#e8a13c }
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    root = out / "src"
    if not root.is_dir():
        raise SystemExit(f"put the Simple Icons .svg files in {root}")

    ids = svg.identities()
    dark_page, dark_ko = "#ffffff", "#1b1d22"
    light_page, light_ko = "#232221", "#f7f7f7"
    uid = [0]
    cards = []
    for ident, (slug, brand) in LOGOS.items():
        path, xform = logo_path(slug, root)
        d = ids[ident]
        ext = d["ext"]

        def strip(colour, page, ko, cls):
            uid[0] += 1
            return (f'<div class="row {cls}">' + "".join(
                icon(d, path, xform, colour, page, ko, px, ext, str(uid[0]))
                for px in (64, 36, 26, 18, 14)) + "</div>")

        sd = stepped(brand, dark_page)
        sl = stepped(brand, light_page)
        rb_d, rb_l = ratio(brand, dark_page), ratio(brand, light_page)
        note = (f'brand {brand} &middot; on white {rb_d:.2f}:1 &middot; '
                f'on near-black {rb_l:.2f}:1')
        cls = ' class="m bad"' if min(rb_d, rb_l) < 3 else ' class="m"'
        cards.append(f"""
  <div class="card">
    <h3>{ident}</h3>
    <p class="sub">{slug}</p>
    <div class="pair">
      <div class="half"><div class="cap">BRAND, unchanged</div>
        {strip(brand, dark_page, dark_ko, 'd')}
        {strip(brand, light_page, light_ko, 'l')}
      </div>
      <div class="half"><div class="cap">STEPPED to 4.5:1</div>
        {strip(sd, dark_page, dark_ko, 'd')}
        {strip(sl, light_page, light_ko, 'l')}
      </div>
    </div>
    <div{cls}>{note}</div>
    <div class="m">stepped {sd} on white &middot; {sl} on near-black</div>
  </div>""")

    html = (HEAD + """<header>
  <h1>The real logos, in brand colour, on the monochrome page</h1>
  <p>Official Simple Icons geometry - the actual glyphs, not likenesses - each in the brand's
  own published hex. Everything except the six document kinds is monochrome now, so these sit on
  a page that is <b>white on a dark theme</b> and a <b>near-black on a light one</b>.</p>
  <p>That is the difficulty, and it is why each card is drawn twice. A brand colour is one fixed
  value and the page behind it is not, so a hue that reads on one theme can vanish on the other.
  <b>BRAND</b> is the published hex untouched; <b>STEPPED</b> is the same hue walked toward the
  page until it clears 4.5:1, the trick the archive parcel already uses. Cards whose brand colour
  drops under 3:1 on either theme are flagged.</p>
</header>
<div class="grid">""" + "".join(cards) + "</div>")
    (out / "index.html").write_text(html, encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
