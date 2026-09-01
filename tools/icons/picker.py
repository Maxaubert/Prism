"""The picker sheet: every kind on its own tab, with the colour in the owner's hands.

The shape rounds ask about shape with the colour nailed down, because asking
both at once means neither can be answered. This is the other half: a real
<input type="color"> per tab, so the colour is CHOSEN rather than proposed.

How the live recolour works, and why it is honest. Every kind is built as TWO
layers - a tintable body whose alpha is the silhouette, and an overlay laid on
top unchanged. For the page kinds and for archive the overlay is pure ink and
every knockout (a sprocket, the letters of the extension) is an ABSENCE of ink
rather than a third colour. For COMIC the overlay is full-colour artwork and
the tintable layer is the ground it sits on. Either way it is a lossless split
of the real renderer rather than a mock-up of it, so what the tab shows is what
the .ico will hold. The one honest caveat: the browser composites AFTER
downsampling and the shipped renderer composites BEFORE, so a handful of edge
pixels differ. It is invisible at every size shown and cannot change a colour
decision, which is what this sheet is for.

The bar carries a LIVE CONTRAST READOUT against both Explorer grounds, because
two of the colours picked so far score about 1.0:1 on light - the icon's shape
disappears and only the chip is left. That is worth seeing while choosing
rather than being told about afterwards.

The 16px column is upscaled from the REAL 16px render with nearest neighbour,
never from a big one: 16px is the frame that decides everything, and a smooth
downscale of a 96px icon is a picture of an icon that does not exist.

    python picker.py <outdir>
"""
import json
import pathlib
import sys

from PIL import Image

import round14
import round15
import round20
import round21
import round22
import round23
from round12 import INK, Kind, _spec, build_layers, lines
from round13 import clapper
from round17 import quarter

BOX = round14.BOX
SIZES = (16, 20, 24, 32, 48, 96)
ZOOM = 96

# The owner's picks as of round nineteen. Comic's shape is the only thing left.
PICKED = {"archive": "#8b8be2", "comic": "#5b5bd6", "image": "#ffffff",
          "code": "#4a5568", "audio": "#69b485", "video": "#5384df",
          "document": "#2f8f9d"}

_g = {k: fn for k, _l, fn in round14.GLYPHS["image"][2]}
_c = {k: fn for k, _l, fn in round14.GLYPHS["code"][2]}

PAGE_KINDS = {
    "image": ("JPG", "holiday.jpg", [("hills", "Two hills (your pick)", _g["hills"])]),
    "code": ("PY", "server.py", [("bars", "Stepped indent bars (your pick)", _c["bars"])]),
    "audio": ("MP3", "interlude.mp3", [("quarter", "Quarter note, no flag (your pick)", quarter)]),
    "video": ("MP4", "holiday-2024.mp4", [("clapper", "Clapperboard (your pick)", clapper)]),
    "document": ("DOCX", "contract.docx", [("lines", "Three text lines (settled)", lines)]),
}

# Archive's shape is settled too: the folder with a zip seam.
ARCHIVE_PICK = "folderzip"

TAB_ORDER = ["comic", "archive", "image", "code", "audio", "video", "document"]

BLURB = {
    "comic": "The pop-art sunburst, halftone rebuilt and the stars gone. Cards "
             "1-10 are the GROUND ALONE, varying the dot; cards 11-21 put round "
             "eighteen's artwork on it. Wedges alternate between lemon and the "
             "colour you set here, keylined in black, and the dots are "
             "translucent so they follow your pick too.",
    "archive": "Folder with a zip seam, your pick. Colour only.",
    "image": "Two hills, your pick. Colour only.",
    "code": "Stepped indent bars, your pick. Colour only.",
    "audio": "Quarter note, no flag, your pick. Colour only.",
    "video": "Clapperboard, your pick. Colour only.",
    "document": "Three text lines, settled. Colour only.",
}


def render(kind, key, size):
    if kind == "archive":
        for k, _l, sil, ink in round15.ARCHIVES:
            if k == key:
                return round15.archive_layers(size, sil, ink)
    if kind == "comic":
        # Keys are prefixed because the same eleven pieces appear on both
        # grounds and the asset filenames have to stay distinct.
        for k, _l, fn in round23.BACKGROUNDS:
            if key == "bg-" + k:
                return _comic_layers(size, round23.bare(fn))
        for k, _l, art, _gr in round21.R18:
            if key == "art-" + k:
                return _comic_layers(size, round21.framed(round23.HERO_BG, art))
    ext, filename, items = PAGE_KINDS[kind]
    fn = next(f for k, _l, f in items if k == key)
    obj = Kind("k", ext, (0, 0, 0), (0, 0, 0), filename, fn, fn)
    spec = _spec(page=(0, 0, 0), fold=INK, band=INK, band_at="chip", glyph_col=INK,
                 glyph_box=BOX, text=ext, text_col=(0, 0, 0), sprocket=(0, 0, 0))
    return build_layers(size, obj, spec)


def _comic_layers(size, art):
    from round18 import comic_layers
    return comic_layers(size, art)


def entries(kind):
    if kind == "archive":
        return [(k, l) for k, l, _s, _i in round15.ARCHIVES if k == ARCHIVE_PICK]
    if kind == "comic":
        return ([("bg-" + k, "Ground only - " + l) for k, l, _f in round23.BACKGROUNDS]
                + [("art-" + k, "With artwork - " + l) for k, l, _a, _g in round21.R18])
    return [(k, l) for k, l, _f in PAGE_KINDS[kind][2]]


def filename(kind):
    if kind == "archive":
        return "backup-2026.zip"
    if kind == "comic":
        return "issue-012.cbz"
    return PAGE_KINDS[kind][1]


HEAD = """<meta charset="utf-8">
<title>Prism icons, pick a colour</title>
<style>
  :root { color-scheme: dark; --bg:#141519; --panel:#1b1d22; --line:#2b2e36;
          --text:#e9edf7; --dim:#8b90a0; --hl:#7c7cf0; --warn:#f0a24a; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif }
  header { padding:26px 32px 6px }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650; letter-spacing:-.01em }
  header p { margin:0; color:var(--dim); max-width:78ch }
  nav { display:flex; gap:6px; flex-wrap:wrap; padding:18px 32px 0;
        border-bottom:1px solid var(--line) }
  nav button { appearance:none; border:1px solid transparent; border-bottom:none;
        background:none; color:var(--dim); font:inherit; font-weight:600;
        padding:9px 15px; border-radius:9px 9px 0 0; cursor:pointer;
        display:flex; align-items:center; gap:8px }
  nav button:hover { color:var(--text) }
  nav button[aria-selected="true"] { background:var(--panel); color:var(--text);
        border-color:var(--line); margin-bottom:-1px }
  nav .dot { width:11px; height:11px; border-radius:3px; flex:0 0 auto;
        box-shadow:inset 0 0 0 1px #0006 }
  .bar { display:flex; align-items:center; gap:14px; flex-wrap:wrap;
         padding:16px 32px; background:var(--panel); border-bottom:1px solid var(--line) }
  .bar label { font-weight:600 }
  input[type=color] { width:52px; height:34px; padding:2px; cursor:pointer;
        background:var(--panel); border:1px solid var(--line); border-radius:8px }
  .hex, .cr { font-family:ui-monospace,Consolas,monospace; font-size:12.5px;
         background:#262932; padding:5px 9px; border-radius:6px }
  .cr.bad { background:#3a2a18; color:var(--warn) }
  .note { color:var(--dim); font-size:12.5px; max-width:70ch }
  .sw { display:flex; gap:5px; flex-wrap:wrap }
  .sw button { width:26px; height:26px; border-radius:6px; cursor:pointer;
        border:1px solid #0007; padding:0 }
  .sw button:hover { outline:2px solid var(--hl); outline-offset:1px }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(400px,1fr));
          gap:14px; padding:18px 32px 40px }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:14px 16px 16px }
  .name { display:flex; align-items:baseline; gap:9px; margin-bottom:12px }
  .num { display:grid; place-items:center; width:22px; height:22px; flex:0 0 auto;
         border-radius:6px; background:var(--hl); color:#0d0f16;
         font-size:12px; font-weight:750 }
  .what { font-weight:600 }
  .grounds { display:flex; gap:10px }
  .ground { flex:1; border-radius:8px; padding:11px 12px; border:1px solid var(--line) }
  .dark { background:#202020 } .light { background:#f7f7f7; border-color:#dcdcdc }
  .sizes { display:flex; align-items:flex-end; gap:11px; height:56px; margin-top:10px }
  .row { display:flex; align-items:center; gap:7px; margin-top:11px;
         font:12px/1 "Segoe UI",system-ui,sans-serif; white-space:nowrap }
  .dark .row { color:#e6e6e6 } .light .row { color:#1b1b1b }
  .zoom { margin-top:12px; display:flex; gap:10px; align-items:center }
  .zoom .cap { color:var(--dim); font-size:11.5px; line-height:1.4 }
  .ic { position:relative; display:inline-block; flex:0 0 auto }
  .ic i { position:absolute; inset:0; background:var(--c);
          -webkit-mask:var(--m) center/100% 100% no-repeat;
                  mask:var(--m) center/100% 100% no-repeat }
  .ic img { position:absolute; inset:0; width:100%; height:100% }
  .panel[hidden] { display:none }
  footer { color:var(--dim); padding:22px 32px 44px; max-width:84ch }
  pre { white-space:pre-wrap }
</style>
"""


def icon(kind, key, px, asset):
    m = f"url('picker/{kind}-{key}-{asset}-body.png')"
    return (f'<span class="ic" style="width:{px}px;height:{px}px;--m:{m}">'
            f'<i></i><img src="picker/{kind}-{key}-{asset}-over.png" alt=""></span>')


def card(kind, key, label, i, fname):
    sizes = "".join(icon(kind, key, s, s) for s in SIZES if s != 96)
    hero, small = icon(kind, key, 96, 96), icon(kind, key, 16, 16)
    return f"""
  <div class="card">
    <div class="name"><span class="num">{i}</span><span class="what">{label}</span></div>
    <div class="grounds">
      <div class="ground dark">{hero}<div class="sizes">{sizes}</div>
        <div class="row">{small}{fname}</div></div>
      <div class="ground light">{hero}<div class="sizes">{sizes}</div>
        <div class="row">{small}{fname}</div></div>
    </div>
    <div class="zoom">{icon(kind, key, 96, 'z')}
      <div class="cap">The real 16px frame, magnified 6x with<br>nearest neighbour - never a 96px icon<br>scaled down.</div>
    </div>
  </div>"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    assets = out / "picker"
    assets.mkdir(parents=True, exist_ok=True)

    for kind in TAB_ORDER:
        for key, _label in entries(kind):
            for s in SIZES:
                body, over = render(kind, key, s)
                body.save(assets / f"{kind}-{key}-{s}-body.png")
                over.save(assets / f"{kind}-{key}-{s}-over.png")
            body, over = render(kind, key, 16)
            body.resize((ZOOM, ZOOM), Image.NEAREST).save(assets / f"{kind}-{key}-z-body.png")
            over.resize((ZOOM, ZOOM), Image.NEAREST).save(assets / f"{kind}-{key}-z-over.png")

    palette = [(l.split("  ")[0], f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}")
               for _k, l, c in round14.PALETTE]

    parts = [HEAD, """<header>
  <h1>Prism file icons: pick a shape, pick a colour</h1>
  <p>One tab per kind. The colour picker recolours every icon on that tab live,
  and the readout beside it measures the result against both Explorer grounds as
  you go. Archive and comic still need a shape; the rest are settled and are here
  for their colour only. Picks are remembered in this browser and the footer
  prints the whole set back for you to read out.</p>
</header>"""]

    parts.append("<nav role='tablist'>")
    for i, kind in enumerate(TAB_ORDER):
        parts.append(f'<button role="tab" aria-selected="{"true" if i == 0 else "false"}" '
                     f'data-tab="{kind}"><span class="dot" data-dot="{kind}"></span>{kind}</button>')
    parts.append("</nav>")

    for i, kind in enumerate(TAB_ORDER):
        hid = "" if i == 0 else " hidden"
        sw = "".join(f'<button style="background:{hx}" data-pick="{kind}" data-hex="{hx}" '
                     f'title="{nm} {hx}"></button>' for nm, hx in palette)
        parts.append(f"""<div class="panel" id="p-{kind}" data-kind="{kind}"{hid}>
  <div class="bar">
    <label for="c-{kind}">{kind}</label>
    <input type="color" id="c-{kind}" value="{PICKED[kind]}" data-input="{kind}">
    <span class="hex" data-hex-out="{kind}">{PICKED[kind]}</span>
    <span class="cr" data-cr="{kind}"></span>
    <div class="sw">{sw}</div>
    <div class="note">{BLURB[kind]}</div>
  </div>
  <div class="grid">""")
        for n, (key, label) in enumerate(entries(kind), 1):
            parts.append(card(kind, key, label, n, filename(kind)))
        parts.append("</div></div>")

    parts.append("""<footer>
  <p><strong>Your picks</strong> - read these out and I will build them:</p>
  <pre class="hex" id="summary" style="padding:12px"></pre>
  <p>Contrast is measured against Explorer's light ground (#f7f7f7) and dark
  (#202020). Below about 1.25:1 the icon's shape disappears on that ground and
  only the black chip is left. Every size is drawn at that size, never
  downsampled; the shipped .ico carries 16, 20, 24, 32, 40, 48, 64, 96, 128, 256.</p>
</footer>""")

    parts.append("""<script>
const KINDS = %s;
const key = k => 'prism-icon-colour-' + k;
const lum = h => { const c=[1,3,5].map(i=>parseInt(h.substr(i,2),16)/255)
    .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]; };
const ratio = (a,b) => { const x=lum(a), y=lum(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); };
function apply(kind, hex) {
  document.getElementById('p-'+kind).style.setProperty('--c', hex);
  document.querySelector(`[data-dot="${kind}"]`).style.background = hex;
  document.querySelector(`[data-hex-out="${kind}"]`).textContent = hex;
  document.querySelector(`[data-input="${kind}"]`).value = hex;
  const L = ratio(hex,'#f7f7f7'), D = ratio(hex,'#202020');
  const el = document.querySelector(`[data-cr="${kind}"]`);
  el.textContent = L.toFixed(2)+':1 on light  ·  '+D.toFixed(2)+':1 on dark'
    + (Math.min(L,D) < 1.25 ? '   shape disappears' : '');
  el.classList.toggle('bad', Math.min(L,D) < 1.25);
  try { localStorage.setItem(key(kind), hex); } catch (e) {}
  summarise();
}
function summarise() {
  document.getElementById('summary').textContent = KINDS.map(k => {
    const h = document.querySelector(`[data-hex-out="${k}"]`).textContent;
    return k.padEnd(10) + h + '   ' + ratio(h,'#f7f7f7').toFixed(2)
      + ':1 light / ' + ratio(h,'#202020').toFixed(2) + ':1 dark';
  }).join('\\n');
}
KINDS.forEach(k => { let v=null; try { v=localStorage.getItem(key(k)); } catch(e){}
  apply(k, v || document.querySelector(`[data-input="${k}"]`).value); });
document.querySelectorAll('[data-input]').forEach(el =>
  el.addEventListener('input', () => apply(el.dataset.input, el.value)));
document.querySelectorAll('[data-pick]').forEach(el =>
  el.addEventListener('click', () => apply(el.dataset.pick, el.dataset.hex)));
document.querySelectorAll('[data-tab]').forEach(b =>
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(x =>
      x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.panel').forEach(p =>
      p.hidden = p.dataset.kind !== b.dataset.tab);
  }));
</script>""" % json.dumps(TAB_ORDER))

    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    n = sum(len(entries(k)) for k in TAB_ORDER)
    print(f"{n} candidates across {len(TAB_ORDER)} tabs -> {out / 'index.html'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
