"""The colour sheet for the SHIPPED set: pick each kind's page colour, live.

round19's picker.py asked the same question of the candidate shapes. This one
asks it of what actually ships - it reads final_icons' own specs, so the
silhouette, the chip, the extension and the mark are the ones in the .ico
rather than a mock-up of them.

HOW THE LIVE RECOLOUR IS HONEST. Every kind is built as TWO layers by the real
renderer: a tintable PAGE whose alpha is the silhouette, and an INK overlay laid
on top unchanged, in which every knockout - a sprocket, the letters of the
extension - is an ABSENCE of ink rather than a third colour. So the browser can
put any colour behind the page layer and get exactly what the .ico would hold.
The one caveat is that the browser composites AFTER downsampling and the shipped
renderer composites BEFORE, which moves a handful of edge pixels and cannot
change a colour decision.

COMIC IS NOT ON THE SHEET, by instruction: it is the one kind whose page is
artwork rather than one flat colour, and it is settled.

THE CONTRAST READOUT IS THE POINT. It is measured against BOTH Explorer grounds
live, because a colour can look right while it is picked on one of them and
vanish on the other - the shipped white image page measures 1.07:1 on light,
where only its chip and mark are left. Under 1.5:1 the sheet says so.

The 16px column is upscaled from the REAL 16px render with nearest neighbour,
never from a bigger one: a smooth downscale of a 96px icon is a picture of an
icon that does not exist.

    python repick.py <outdir>
"""
import base64
import json
import pathlib
import sys
from io import BytesIO

from final_icons import BOX, COLOURS, PAGE_GLYPHS, render
from round12 import INK, Kind, _spec, build_layers
from round15 import CHIP_A, archive_layers, folder_zip, folder_zip_ink

SIZES = (16, 24, 32, 48)
ZOOM = 96

# The swatch wall. EVERY kind gets the SAME palette, deliberately: the job is
# not to nudge one colour, it is to see whether six kinds tell each other apart,
# and that can only be judged with the whole wheel under each of them.
#
# Three steps per hue rather than one. A hue that fails is usually not the hue -
# it is the lightness, and which lightness works depends on which ground you
# care about more: DEEP reads on Explorer's light ground and closes up on the
# dark one, LIGHT does the reverse, MID is the compromise that survives both.
# The readout beside each kind is what settles it.
#
# The kind's CURRENT colour leads its row, marked with a dashed ring.
HUES = [
    ("red", 4), ("orange", 24), ("amber", 40), ("yellow", 52), ("lime", 82),
    ("green", 140), ("emerald", 160), ("teal", 180), ("cyan", 194),
    ("sky", 205), ("blue", 220), ("indigo", 240), ("violet", 258),
    ("purple", 275), ("magenta", 300), ("pink", 330),
]
# (saturation, lightness) per step, as fractions.
STEPS = ((0.62, 0.62), (0.58, 0.52), (0.55, 0.42))
NEUTRALS = ["#ffffff", "#d6dae2", "#aab2c0", "#7c8697", "#5a6473", "#3d4552"]


def _hsl(h, s, ll):
    """One hex from hue in degrees and s/l in fractions."""
    c = (1 - abs(2 * ll - 1)) * s
    x = c * (1 - abs(((h / 60.0) % 2) - 1))
    m = ll - c / 2
    r, g_, b = [
        (c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)
    ][int(h // 60) % 6]
    return "#%02x%02x%02x" % tuple(round((v + m) * 255) for v in (r, g_, b))


WALL = [_hsl(deg, s, ll) for _name, deg in HUES for s, ll in STEPS] + NEUTRALS

GROUNDS = (("#202020", "dark"), ("#f7f7f7", "light"))


def _png(img):
    buf = BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def layers(kind, size):
    """The shipped icon, split into (tintable page, ink overlay)."""
    ext, _colour = COLOURS[kind]
    if kind == "archive":
        return archive_layers(size, folder_zip, folder_zip_ink, ext)
    obj = Kind(kind, ext, (0, 0, 0), (0, 0, 0), "", PAGE_GLYPHS[kind], PAGE_GLYPHS[kind])
    spec = _spec(page=(255, 255, 255), fold=INK, band=INK, band_at="chip",
                 glyph_col=INK, glyph_box=BOX, text=ext, text_col=(255, 255, 255),
                 sprocket=(255, 255, 255))
    return build_layers(size, obj, spec)


HEAD = """<meta charset="utf-8"><title>Prism icon colours</title>
<style>
 :root{color-scheme:dark;--bg:#141519;--panel:#1b1d22;--line:#2b2e36;--text:#e9edf7;
       --dim:#8b90a0;--accent:#7c7cf0}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--text);
      font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
 header{padding:26px 30px 6px}
 h1{margin:0 0 6px;font-size:19px;font-weight:650;letter-spacing:-.01em}
 header p{margin:0 0 4px;color:var(--dim);max-width:70ch}
 .kind{margin:20px 30px;background:var(--panel);border:1px solid var(--line);
       border-radius:12px;padding:14px 16px 16px}
 .top{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
 .name{font-weight:650;font-size:15px;min-width:96px}
 input[type=color]{width:46px;height:30px;padding:0;border:1px solid var(--line);
                   border-radius:7px;background:none;cursor:pointer}
 .hex{font:12.5px ui-monospace,Consolas,monospace;color:var(--dim);width:8ch}
 .ratio{font:12px ui-monospace,Consolas,monospace;color:var(--dim)}
 .bad{color:#ff9a8a}
 .grounds{display:flex;gap:10px}
 .ground{flex:1;border:1px solid var(--line);border-radius:9px;padding:11px 12px}
 .light{background:#f7f7f7;border-color:#dcdcdc}
 .dark{background:#202020}
 .sizes{display:flex;align-items:flex-end;gap:14px;min-height:104px}
 /* The magnified 16px is 96px tall, so the row is sized for IT rather
    than for the 48px beside it, or it climbs out over the header. */
 .row{display:flex;align-items:center;gap:7px;margin-top:10px;
      font:12px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap}
 .dark .row{color:#e6e6e6}.light .row{color:#1b1b1b}
 .ic{position:relative;display:inline-block}
 .ic i{position:absolute;inset:0;-webkit-mask-size:100% 100%;mask-size:100% 100%;
       -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}
 .ic img{position:relative;display:block;image-rendering:auto}
 .zoom img,.zoom i{image-rendering:pixelated}
 .swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(26px,1fr));
            gap:5px;margin-top:12px}
 .sw{aspect-ratio:1;border-radius:6px;border:2px solid transparent;cursor:pointer}
 .sw.on{border-color:var(--text)}
 .sw.cur{outline:1px dashed var(--dim);outline-offset:2px}
 footer{margin:26px 30px 50px;padding:16px;background:var(--panel);
        border:1px solid var(--line);border-radius:12px}
 pre{margin:8px 0 0;font:12.5px ui-monospace,Consolas,monospace;color:var(--accent);
     white-space:pre-wrap}
 button{font:13px inherit;background:var(--accent);color:#0d0f16;border:0;
        border-radius:7px;padding:7px 12px;font-weight:650;cursor:pointer}
</style>
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    kinds = [k for k in COLOURS if k != "comic"]
    # The kind's own colour leads, then the wall with any duplicate of it
    # dropped - two swatches that are the same colour is one that does nothing.
    cands = {k: ["#%02x%02x%02x" % COLOURS[k][1]]
                + [c for c in WALL if c.lower() != ("#%02x%02x%02x" % COLOURS[k][1]).lower()]
             for k in kinds}

    data = {}
    for kind in kinds:
        data[kind] = {
            "cur": "#%02x%02x%02x" % COLOURS[kind][1],
            "cands": cands[kind],
            "sizes": {str(s): [_png(a) for a in layers(kind, s)] for s in SIZES},
            "ext": COLOURS[kind][0],
        }

    parts = [HEAD, """<header>
  <h1>Prism icon colours</h1>
  <p>Every kind's page colour, on the shipped shapes. Click a swatch or open the
  colour well; both grounds update together, and the ratio beside each is measured
  against that ground. Comic is not here: its page is artwork, and it is settled.</p>
  <p>The 16px column is the real 16px render, magnified. It is the frame Explorer's
  details view uses, so it is the one that decides.</p>
</header>"""]

    for kind in kinds:
        cells = []
        for bg, mode in GROUNDS:
            imgs = "".join(
                f'<span class="ic" data-k="{kind}" data-s="{s}">'
                f'<i style="-webkit-mask-image:url({data[kind]["sizes"][str(s)][0]});'
                f'mask-image:url({data[kind]["sizes"][str(s)][0]})"></i>'
                f'<img src="{data[kind]["sizes"][str(s)][1]}" width="{s}" height="{s}" alt="">'
                f'</span>'
                for s in SIZES)
            zoom = (f'<span class="ic zoom" data-k="{kind}" data-s="16">'
                    f'<i style="-webkit-mask-image:url({data[kind]["sizes"]["16"][0]});'
                    f'mask-image:url({data[kind]["sizes"]["16"][0]})"></i>'
                    f'<img src="{data[kind]["sizes"]["16"][1]}" width="{ZOOM}" height="{ZOOM}" alt="">'
                    f'</span>')
            cells.append(f"""<div class="ground {mode}">
        <div class="sizes">{imgs}{zoom}</div>
        <div class="row"><span class="ic" data-k="{kind}" data-s="16">
          <i style="-webkit-mask-image:url({data[kind]['sizes']['16'][0]});
                    mask-image:url({data[kind]['sizes']['16'][0]})"></i>
          <img src="{data[kind]['sizes']['16'][1]}" width="16" height="16" alt=""></span>
          example.{data[kind]['ext'].lower()}</div>
      </div>""")
        sw = "".join(f'<span class="sw" data-k="{kind}" data-c="{c}" '
                     f'style="background:{c}"></span>' for c in cands[kind])
        parts.append(f"""<div class="kind" id="k-{kind}">
      <div class="top">
        <span class="name">{kind}</span>
        <input type="color" data-k="{kind}" value="{data[kind]['cur']}">
        <span class="hex" data-hex="{kind}">{data[kind]['cur']}</span>
        <span class="ratio" data-ratio="{kind}"></span>
      </div>
      <div class="grounds">{"".join(cells)}</div>
      <div class="swatches">{sw}</div>
    </div>""")

    parts.append("""<footer>
      <button id="copy">Copy the set</button>
      <pre id="out"></pre>
      <p style="color:var(--dim);margin:10px 0 0">Read these back and they go
      straight into <code>COLOURS</code> in final_icons.py.</p>
    </footer>""")

    parts.append("<script>const DATA=" + json.dumps({k: v["cur"] for k, v in data.items()}) + ";")
    parts.append("""
const lum=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255)
  .map(v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]}
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}
const pick={...DATA}
function paint(k){
  const c=pick[k]
  document.querySelectorAll(`.ic[data-k="${k}"] i`).forEach(e=>e.style.background=c)
  document.querySelector(`[data-hex="${k}"]`).textContent=c
  const d=ratio(c,'#202020'), l=ratio(c,'#f7f7f7')
  const el=document.querySelector(`[data-ratio="${k}"]`)
  el.textContent=`dark ${d.toFixed(2)}:1   light ${l.toFixed(2)}:1`
  el.className='ratio'+((d<1.5||l<1.5)?' bad':'')
  document.querySelectorAll(`.sw[data-k="${k}"]`).forEach(s=>
    s.classList.toggle('on', s.dataset.c.toLowerCase()===c.toLowerCase()))
  out()
}
function out(){
  document.getElementById('out').textContent =
    Object.entries(pick).map(([k,c])=>`${k.padEnd(9)} ${c}`).join('\\n')
}
document.querySelectorAll('input[type=color]').forEach(i=>
  i.addEventListener('input',e=>{pick[i.dataset.k]=e.target.value;paint(i.dataset.k)}))
document.querySelectorAll('.sw').forEach(s=>s.addEventListener('click',()=>{
  pick[s.dataset.k]=s.dataset.c
  document.querySelector(`input[data-k="${s.dataset.k}"]`).value=s.dataset.c
  paint(s.dataset.k)}))
document.querySelectorAll('.sw').forEach(s=>{
  if(s.dataset.c.toLowerCase()===DATA[s.dataset.k].toLowerCase()) s.classList.add('cur')})
document.getElementById('copy').addEventListener('click',()=>
  navigator.clipboard.writeText(document.getElementById('out').textContent))
Object.keys(pick).forEach(paint)
</script>""")

    (out / "index.html").write_text("\n".join(parts), encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
