"""The COLOURED in-app icon scheme, for the owner to pick.

The Settings control stops being a colour and becomes a TYPE: monochrome (what
ships - white on a dark theme, black on a light one, measured rather than read
off a theme flag) or coloured, a preset scheme per kind. This page is where the
preset gets chosen.

Two colours per kind, because those are the two areas a reader actually sees:

    the GLYPH GROUND - the page or container the mark sits on
    the LABEL GROUND - the band the extension is set in

Everything else follows from them rather than being picked. The mark and the
label text are WHITE OR BLACK, whichever contrasts more with the ground each
sits on, by the same better-of-two rule the monochrome scheme already uses. So
a choice cannot produce an illegible icon: pick a dark page and the mark goes
white on its own.

COMIC is not here. Its Explorer icon is artwork - a keylined sunburst under a
splat - and the owner has asked that the in-app coloured version keep that
scheme rather than be reduced to two flat colours. It is shown for reference at
the foot of the page and cannot be edited.

    python colourpick.py <outdir>
"""
import json
import pathlib
import sys

import svg

PICKABLE = ["archive", "audio", "code", "document", "image", "video"]

# WHAT SHIPS, so re-opening this page shows the scheme rather than a fresh set
# of guesses. Read from the emitter rather than restated: a second copy of six
# colour pairs does not fail when it drifts, it just quietly shows the wrong
# thing to the person about to change them.
START = {k: (v[0], v[1]) for k, v in svg.SCHEME.items()}

HEAD = """<meta charset="utf-8">
<title>Prism coloured icons</title>
<style>
  :root { color-scheme: dark; --bg:#141519; --panel:#1b1d22; --line:#2b2e36;
          --text:#e9edf7; --dim:#8b90a0; --hl:#7c7cf0 }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif }
  header { padding:24px 30px 4px }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650; letter-spacing:-.01em }
  header p { margin:0 0 4px; color:var(--dim); max-width:80ch }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(470px,1fr));
          gap:13px; padding:18px 30px 10px }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:13px 15px 15px }
  h3 { margin:0 0 10px; font-size:12px; letter-spacing:.07em; text-transform:uppercase;
       color:var(--hl) }
  .controls { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px }
  label { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--dim) }
  input[type=color] { width:44px; height:28px; padding:2px; cursor:pointer;
        background:var(--panel); border:1px solid var(--line); border-radius:7px }
  .grounds { display:flex; gap:10px }
  .ground { flex:1; border-radius:8px; padding:10px 11px; border:1px solid var(--line) }
  .dark { background:#1b1d22 } .light { background:#f7f7f7; border-color:#dcdcdc }
  /* The big preview gets its own full-width row; the grounds below carry the
     small sizes. A 96px icon in a half-card column overflowed it and spilled
     into the next card. */
  .hero { display:flex; gap:10px; margin-bottom:10px }
  .hero > div { flex:1; display:grid; place-items:center; padding:12px 0;
                border-radius:8px; border:1px solid var(--line) }
  .sizes { display:flex; align-items:flex-end; gap:9px; min-height:50px; flex-wrap:wrap }
  .row { display:flex; align-items:center; gap:8px; margin-top:10px;
         font:12.5px/1 "Segoe UI",system-ui,sans-serif; white-space:nowrap }
  .dark .row { color:#e6e6e6 } .light .row { color:#1b1b1b }
  .meta { margin-top:9px; color:var(--dim); font-size:11.5px;
          font-variant-numeric:tabular-nums }
  footer { padding:8px 30px 40px; color:var(--dim); max-width:84ch }
  pre { background:#20232b; padding:12px 14px; border-radius:9px; white-space:pre-wrap;
        font:12.5px/1.6 ui-monospace,Consolas,monospace; color:var(--text) }
</style>
"""

SCRIPT = """
const KINDS = %s
const PATHS = %s
const LABELS = %s
const START = %s

const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/* White or black, whichever contrasts more. Better-of-two rather than a
   midpoint: two colours either side of a midpoint can both be poor. */
const inkOn = (bg) => (ratio('#ffffff', bg) >= ratio('#000000', bg) ? '#ffffff' : '#000000')

const svgFor = (kind, px, page, band) => {
  const p = PATHS[kind], L = LABELS[kind]
  const mark = inkOn(page), text = inkOn(band)
  const size = L.sizes[Math.min(L.ext.length, 6)]
  return `<svg viewBox="0 0 24 24" width="${px}" height="${px}">`
    + `<path d="${p.body}" fill="${page}"/>`
    + (p.band ? `<path d="${p.band}" fill="${band}"/>` : '')
    + (p.mark ? `<path d="${p.mark}" fill="${mark}"/>` : '')
    + (p.hi ? `<path d="${p.hi}" fill="${page}"/>` : '')
    + `<text x="${L.x}" y="${L.y}" font-size="${size}" fill="${text}"`
    + ` text-anchor="middle" dominant-baseline="central" font-weight="700"`
    + ` font-family="Segoe UI,system-ui,sans-serif">${L.ext}</text></svg>`
}

const state = {}
const read = (k) => {
  try { return JSON.parse(localStorage.getItem('prism.colouricon.' + k) || 'null') } catch { return null }
}
for (const k of KINDS) state[k] = read(k) || { page: START[k][0], band: START[k][1] }

function paint(k) {
  const { page, band } = state[k]
  for (const el of document.querySelectorAll(`[data-preview="${k}"]`)) {
    el.innerHTML = [48, 32, 24, 16].map((px) => svgFor(k, px, page, band)).join('')
  }
  for (const el of document.querySelectorAll(`[data-hero="${k}"]`)) {
    el.innerHTML = svgFor(k, 96, page, band)
  }
  for (const el of document.querySelectorAll(`[data-rowicon="${k}"]`)) {
    el.innerHTML = svgFor(k, 16, page, band)
  }
  document.querySelector(`[data-meta="${k}"]`).textContent =
    `glyph ${page} -> mark ${inkOn(page)} at ${ratio(inkOn(page), page).toFixed(1)}:1`
    + `   ·   label ${band} -> text ${inkOn(band)} at ${ratio(inkOn(band), band).toFixed(1)}:1`
  try { localStorage.setItem('prism.colouricon.' + k, JSON.stringify(state[k])) } catch {}
  summarise()
}
function summarise() {
  document.getElementById('out').textContent = KINDS.map((k) =>
    `${k.padEnd(9)} glyph ${state[k].page}   label ${state[k].band}`).join('\\n')
}
for (const k of KINDS) {
  document.querySelector(`[data-page="${k}"]`).value = state[k].page
  document.querySelector(`[data-band="${k}"]`).value = state[k].band
  document.querySelector(`[data-page="${k}"]`).addEventListener('input', (e) => {
    state[k].page = e.target.value; paint(k)
  })
  document.querySelector(`[data-band="${k}"]`).addEventListener('input', (e) => {
    state[k].band = e.target.value; paint(k)
  })
  paint(k)
}
"""


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ic = svg.icons()
    paths = {
        k: {"body": ic[k]["body"], "band": ic[k].get("band", ""),
            "mark": ic[k].get("mark", ""), "hi": ic[k].get("hi", "")}
        for k in PICKABLE
    }
    labels = {k: {**ic[k]["label"], "ext": ic[k]["ext"]} for k in PICKABLE}

    cards = []
    for k in PICKABLE:
        cards.append(f"""
  <div class="card">
    <h3>{k}</h3>
    <div class="controls">
      <label>glyph ground <input type="color" data-page="{k}"></label>
      <label>label ground <input type="color" data-band="{k}"></label>
    </div>
    <div class="hero">
      <div class="dark" data-hero="{k}"></div>
      <div class="light" data-hero="{k}"></div>
    </div>
    <div class="grounds">
      <div class="ground dark">
        <div class="sizes" data-preview="{k}"></div>
        <div class="row"><span data-rowicon="{k}"></span>holiday-2024.{labels[k]['ext'].lower()}</div>
      </div>
      <div class="ground light">
        <div class="sizes" data-preview="{k}"></div>
        <div class="row"><span data-rowicon="{k}"></span>holiday-2024.{labels[k]['ext'].lower()}</div>
      </div>
    </div>
    <div class="meta" data-meta="{k}"></div>
  </div>""")

    html = (HEAD + """<header>
  <h1>Prism in-app icons: the COLOURED scheme</h1>
  <p>Two colours per kind - the ground the glyph sits on, and the ground the label sits in.
  The mark and the label text are not choices: each is white or black, whichever contrasts more
  with what it sits on, so no pick can make an illegible icon. Each card prints the resulting
  ratios.</p>
  <p>Shown at 96, 48, 32, 24 and 16px on both panel colours, then in a tree row at the size that
  decides it. Your picks are remembered in this browser.</p>
</header>
<div class="grid">""" + "".join(cards) + """</div>
<footer>
  <p><strong>Read these out and I will build them:</strong></p>
  <pre id="out"></pre>
  <p>Comic is deliberately absent: its Explorer icon is artwork rather than two flat colours, and
  it keeps that scheme in the app, as you asked.</p>
</footer>
<script>""" + (SCRIPT % (json.dumps(PICKABLE), json.dumps(paths), json.dumps(labels),
                        json.dumps(START))) + "</script>")
    (out / "index.html").write_text(html, encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
