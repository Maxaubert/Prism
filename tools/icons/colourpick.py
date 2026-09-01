"""The COLOURED in-app icon scheme, for the owner to pick.

The Settings control is a switch of icon TYPES rather than a colour: monochrome
(what ships - white or a near-black, chosen by measured contrast against the
style's own ground) or coloured, the preset scheme this page exists to choose.

WHAT IS PICKED, AND WHAT IS NOT (2026-09-01, second round):

    page   the ground the glyph sits on          PICKED
    glyph  the mark itself                       PICKED
    band   the ground the extension sits in      BLACK, for every identity
    text   the extension                         derived, white or black on the band
    glint  a sheen across the page               a dial, shared by every identity

The first round DERIVED the glyph from the page by contrast. That guarantees
legibility and takes the choice away, and the owner wants the choice: a pale
mark on a dark page and a dark mark on a pale one are different icons, not two
spellings of one. The ratio is still MEASURED and shown beside every pick, so a
choice that cannot be read says so rather than being prevented.

TWENTY-SEVEN IDENTITIES, not seven. `svg.IDENTITIES` is the table and the reason
is written there: a colour identity is finer than an icon shape, so `.md` stops
being coloured as source and `.docx` stops being coloured as a PDF.

A SELECTED ROW FALLS BACK TO MONOCHROME, and that is not a detail of this page -
it is the rule the app follows. A blue icon on a blue selection fill is an
invisible icon, and no amount of picking fixes it, because the accent is the
user's and the icon colour is the scheme's. Monochrome measures its ink against
whatever is behind it, so it is right on every accent by construction. Every
preview here shows the selected state beside the two grounds.

    python colourpick.py <outdir>
"""
import json
import pathlib
import sys

import svg

# The label band, for every identity (owner: "the bg of the label can be black
# for all"). Not a pick, so not in the state.
BAND = "#000000"

# Where each identity starts. The seven kinds carry the first round's picks so
# nothing already chosen is thrown away; everything new starts from the page of
# the kind it borrows, so the page opens showing what ships rather than a set of
# fresh guesses, and a colour changes only where somebody changes it.
FIRST_ROUND = {
    "archive": "#8b8be2",
    "audio": "#69b485",
    "code": "#464646",
    "comic": "#d2603a",
    "document": "#6060ff",
    "image": "#ff8080",
    "video": "#5384df",
}
FIRST_ROUND_GLYPH = {"code": "#000000", "comic": "#f7f2de"}

# COMIC IS NOT EDITABLE (owner, 2026-09-01: "the comic icon we dont wanna
# change"). It is the one identity whose icon is artwork rather than a mark on a
# page - a keylined sunburst under a splat - so it has never been two flat
# colours to pick, and it keeps exactly what it has. It stays in
# `svg.IDENTITIES` because it is still a colour identity; it is simply not one
# this page offers.
FIXED = {"comic"}

GROUPS = [
    {"name": "Kinds", "ids": ["archive", "audio", "code", "document", "image", "video"]},
    {"name": "Special cases", "ids": ["markdown", "pdf", "word", "sheet", "slides", "ebook"]},
    {"name": "Languages", "ids": ["config", "css", "data", "docker", "git", "html", "java",
                                  "prose", "python", "react", "ruby", "shell", "sql", "swift",
                                  "vue"]},
]

HEAD = """<meta charset="utf-8">
<title>Prism coloured icons</title>
<style>
  :root { color-scheme: dark; --bg:#141519; --panel:#1b1d22; --line:#2b2e36;
          --text:#e9edf7; --dim:#8b90a0; --hl:#7c7cf0; --accent:#5b5bd6 }
  * { box-sizing:border-box }
  body { margin:0; background:var(--bg); color:var(--text);
         font:14px/1.5 -apple-system,"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif }
  header { padding:22px 28px 6px }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650; letter-spacing:-.01em }
  header p { margin:0 0 4px; color:var(--dim); max-width:86ch }
  .wrap { display:grid; grid-template-columns:minmax(0,1fr) 430px; gap:18px;
          align-items:start; padding:14px 28px 40px }

  .gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:8px;
             align-content:start }
  .cell { background:var(--panel); border:1px solid var(--line); border-radius:10px;
          padding:10px 6px 8px; cursor:pointer; text-align:center; transition:.12s }
  .cell:hover { border-color:#3d414d }
  .cell[data-on="1"] { border-color:var(--hl); box-shadow:0 0 0 1px var(--hl) }
  .cell .nm { margin-top:6px; font-size:11px; color:var(--dim); letter-spacing:.02em }
  .cell[data-on="1"] .nm { color:var(--text) }
  .group { grid-column:1/-1; margin:10px 0 -2px; font-size:11px; letter-spacing:.09em;
           text-transform:uppercase; color:var(--hl) }
  .group:first-child { margin-top:0 }

  .editor { position:sticky; top:14px; background:var(--panel); border:1px solid var(--line);
            border-radius:12px; padding:14px 15px 16px }
  .editor h2 { margin:0 0 2px; font-size:15px; font-weight:650 }
  .editor .sub { margin:0 0 12px; font-size:11.5px; color:var(--dim) }
  .heroes { display:flex; gap:8px; margin-bottom:12px }
  .hero { flex:1; border-radius:9px; border:1px solid var(--line); padding:12px 0;
          display:grid; place-items:center; gap:6px }
  .hero span { font-size:10.5px; color:var(--dim); letter-spacing:.04em }
  .on-dark { background:#1b1d22 } .on-light { background:#f7f7f7; border-color:#d6d6d6 }
  .on-light span { color:#606060 }
  .on-sel { background:var(--accent) } .on-sel span { color:#e8e8ff }

  .rows { border:1px solid var(--line); border-radius:9px; overflow:hidden; margin-bottom:13px }
  .r { display:flex; align-items:center; gap:8px; padding:5px 9px;
       font:12.5px/1 "Segoe UI",system-ui,sans-serif }
  .r.d { background:#1b1d22; color:#e6e6e6 }
  .r.l { background:#f7f7f7; color:#1b1b1b }
  .r.s { background:var(--accent); color:#fff }

  .pickers { display:flex; gap:12px }
  .pk { flex:1; min-width:0 }
  .pk > label { display:block; font-size:11.5px; color:var(--dim); margin-bottom:5px }
  .sv { position:relative; width:100%; height:104px; border-radius:8px; cursor:crosshair;
        border:1px solid var(--line); touch-action:none }
  .hue { position:relative; width:100%; height:14px; margin-top:7px; border-radius:7px;
         cursor:pointer; border:1px solid var(--line); touch-action:none;
         background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00) }
  .knob { position:absolute; width:12px; height:12px; margin:-6px 0 0 -6px; border-radius:50%;
          border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.55); pointer-events:none }
  .hknob { position:absolute; top:-2px; width:8px; height:16px; margin-left:-4px; border-radius:3px;
           border:2px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.55); pointer-events:none }
  .hex { margin-top:7px; width:100%; background:#20232b; border:1px solid var(--line);
         border-radius:7px; color:var(--text); padding:5px 8px;
         font:12px/1.3 ui-monospace,Consolas,monospace; text-transform:uppercase }
  .swatches { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px }
  .sw { width:17px; height:17px; border-radius:5px; border:1px solid rgba(255,255,255,.16);
        cursor:pointer; padding:0 }

  .dial { margin-top:13px }
  .dial label { display:flex; justify-content:space-between; font-size:11.5px; color:var(--dim) }
  .dial input { width:100%; margin-top:5px; accent-color:var(--hl) }
  .meta { margin-top:11px; font-size:11.5px; color:var(--dim); font-variant-numeric:tabular-nums }
  .warn { color:#e8a13c }
  .btn { margin-top:12px; width:100%; background:#20232b; border:1px solid var(--line);
         border-radius:8px; color:var(--text); padding:7px; font-size:12px; cursor:pointer }
  .btn:hover { border-color:#3d414d }
  footer { padding:0 28px 44px; color:var(--dim); max-width:96ch }
  pre { background:#20232b; padding:12px 14px; border-radius:9px; white-space:pre-wrap;
        font:12px/1.6 ui-monospace,Consolas,monospace; color:var(--text) }
</style>
"""

BODY = """<header>
  <h1>Prism in-app icons: the COLOURED scheme</h1>
  <p>Pick the <strong>glyph background</strong> and the <strong>glyph</strong> for each of the
  27 identities. The label band is black on all of them and the extension is white on it.
  Click an icon on the left to edit it.</p>
  <p>Every preview shows the <strong>selected row</strong> beside the two grounds. A selected row
  falls back to monochrome on purpose: the accent is yours and the icon colour is the scheme's,
  so a blue icon on a blue fill is the one collision no pick can avoid.</p>
</header>
<div class="wrap">
  <div id="gallery" class="gallery"></div>
  <div class="editor">
    <h2 id="title"></h2>
    <p class="sub" id="sub"></p>
    <div class="heroes">
      <div class="hero on-dark"><div id="h-dark"></div><span>dark</span></div>
      <div class="hero on-light"><div id="h-light"></div><span>light</span></div>
      <div class="hero on-sel"><div id="h-sel"></div><span>selected</span></div>
    </div>
    <div class="rows">
      <div class="r d"><span id="r-dark"></span>holiday-2024</div>
      <div class="r l"><span id="r-light"></span>holiday-2024</div>
      <div class="r s"><span id="r-sel"></span>holiday-2024</div>
    </div>
    <div class="pickers">
      <div class="pk" id="pk-page"></div>
      <div class="pk" id="pk-glyph"></div>
    </div>
    <div class="dial">
      <label>Glint <span id="glintval"></span></label>
      <input id="glint" type="range" min="0" max="100" step="5">
    </div>
    <div class="meta" id="meta"></div>
    <button class="btn" id="copy">Copy every pick</button>
  </div>
</div>
<footer>
  <p><strong>Read these out and I will build them:</strong></p>
  <pre id="out"></pre>
</footer>
"""

SCRIPT = r"""
const DATA = __DATA__
const ORDER = __ORDER__
const GROUPS = __GROUPS__
const START = __START__
const BAND = __BAND__
const ACCENT = '#5b5bd6'

/* ---------------- colour maths ---------------- */
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/* Monochrome's own rule, which is what a SELECTED row falls back to: white or
   black, whichever contrasts more with what is actually behind it. */
const inkOn = (bg) => (ratio('#ffffff', bg) >= ratio('#000000', bg) ? '#ffffff' : '#000000')

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
function hsv2hex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return '#' + hex2(f(5) * 255) + hex2(f(3) * 255) + hex2(f(1) * 255)
}
function hex2hsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = 60 * (((g - b) / d) % 6)
    else if (mx === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: mx ? d / mx : 0, v: mx }
}
const clean = (t) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(t.trim())
  return m ? '#' + m[1].toLowerCase() : null
}

/* ---------------- the icon ---------------- */
/* The glint is laid on the PAGE and under everything else: a sheen over the
   band would wash the extension, which is the one part that has to stay crisp.
   Two stops of white and one of black, so it reads as a highlight rolling off
   into a shaded corner rather than as a flat lightening of the whole tile. */
function glintDef(uid, amt) {
  if (amt <= 0) return ''
  const a = amt / 100
  return '<linearGradient id="' + uid + '" x1="0.08" y1="0" x2="0.82" y2="1">' +
    '<stop offset="0" stop-color="#ffffff" stop-opacity="' + (0.5 * a).toFixed(3) + '"/>' +
    '<stop offset="0.3" stop-color="#ffffff" stop-opacity="' + (0.13 * a).toFixed(3) + '"/>' +
    '<stop offset="0.34" stop-color="#ffffff" stop-opacity="' + (0.03 * a).toFixed(3) + '"/>' +
    '<stop offset="0.66" stop-color="#000000" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="#000000" stop-opacity="' + (0.26 * a).toFixed(3) + '"/>' +
    '</linearGradient>'
}

let uidN = 0
function svgFor(id, px, mode) {
  const d = DATA[id]
  const st = state[id]
  const L = d.label
  const size = L.sizes[Math.min(d.ext.length, 6)]
  const lab = (fill) =>
    '<text x="' + L.x + '" y="' + L.y + '" font-size="' + size + '" fill="' + fill + '"' +
    ' text-anchor="middle" dominant-baseline="central" font-weight="700"' +
    ' font-family="Segoe UI,system-ui,sans-serif">' + d.ext + '</text>'

  /* SELECTED: monochrome, measured against the accent behind it. The coloured
     scheme cannot help here - the accent belongs to the user and the icon
     colour to the scheme, so any fixed pick can collide with it. */
  if (mode === 'sel') {
    const ink = inkOn(ACCENT)
    return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '">' +
      '<path d="' + d.body + '" fill="' + ink + '"/>' +
      '<path d="' + d.ko + '" fill="' + ACCENT + '"/>' +
      (d.hi ? '<path d="' + d.hi + '" fill="' + ink + '"/>' : '') +
      lab(ink) + '</svg>'
  }

  /* THE SAME CONSTRUCTION THE APP USES, deliberately. An earlier version of
     this page painted the band straight onto the page, which looked right here
     and shipped a hairline of page colour round the outside of every icon: two
     antialiased edges meeting on the icon's own outline. A mockup that draws it
     differently from the app is a mockup that lies. */
  const uid = 'u' + ++uidN
  const g = glintDef(uid + 'g', st.glint)
  return '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '">' +
    (g ? '<defs>' + g + '</defs>' : '') +
    '<mask id="' + uid + '" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">' +
    '<path d="' + d.body + '" fill="#fff"/></mask>' +
    '<g mask="url(#' + uid + ')">' +
    '<rect x="0" y="0" width="24" height="24" fill="' + st.page + '"/>' +
    (g ? '<rect x="0" y="0" width="24" height="24" fill="url(#' + uid + 'g)"/>' : '') +
    /* THE BAND GOES ON LAST, the order the .ico composites in. The archive's
       mark is the zip seam and pull and runs the whole height of the container,
       straight through the band and the extension set in it; a page kind's
       glyph box stops well above the band, so the wrong order looks fine on six
       of the seven. */
    '<path d="' + d.mark + '" fill="' + st.glyph + '"/>' +
    (d.hi ? '<path d="' + d.hi + '" fill="' + st.page + '"/>' : '') +
    '<path d="' + d.bleed + '" fill="' + BAND + '"/>' +
    '</g>' + lab(inkOn(BAND)) + '</svg>'
}

/* ---------------- state ---------------- */
const KEY = 'prism.colouricon2.'
const state = {}
for (const id of ORDER) {
  let saved = null
  try { saved = JSON.parse(localStorage.getItem(KEY + id) || 'null') } catch {}
  state[id] = saved || Object.assign({}, START[id])
  if (typeof state[id].glint !== 'number') state[id].glint = START[id].glint
}
let current = ORDER[0]
const save = (id) => { try { localStorage.setItem(KEY + id, JSON.stringify(state[id])) } catch {} }

/* ---------------- the colour picker widget ---------------- */
/* Built in the page rather than <input type="color">, which opens the OS dialog
   and covers the icon: you cannot judge a colour you cannot see next to the
   thing it is for. */
const RECENT = ['#ffffff', '#000000', '#aab2c0', '#2b303b', '#5b5bd6', '#e8a13c',
                '#69b485', '#5384df', '#ff8080', '#d2603a', '#8b8be2', '#f2e15c']

function Picker(root, label, get, set) {
  root.innerHTML =
    '<label>' + label + '</label>' +
    '<div class="sv"><div class="knob"></div></div>' +
    '<div class="hue"><div class="hknob"></div></div>' +
    '<input class="hex" spellcheck="false">' +
    '<div class="swatches">' + RECENT.map(function (c) {
      return '<button class="sw" data-c="' + c + '" style="background:' + c + '" title="' + c + '"></button>'
    }).join('') + '</div>'
  const sv = root.querySelector('.sv')
  const knob = root.querySelector('.knob')
  const hue = root.querySelector('.hue')
  const hknob = root.querySelector('.hknob')
  const hexEl = root.querySelector('.hex')
  let hsv = { h: 0, s: 0, v: 0 }

  function paint() {
    sv.style.background =
      'linear-gradient(to top, #000, rgba(0,0,0,0)),' +
      'linear-gradient(to right, #fff, hsl(' + hsv.h + ' 100% 50%))'
    knob.style.left = hsv.s * 100 + '%'
    knob.style.top = (1 - hsv.v) * 100 + '%'
    hknob.style.left = (hsv.h / 360) * 100 + '%'
  }
  function push() {
    const hex = hsv2hex(hsv.h, hsv.s, hsv.v)
    hexEl.value = hex.toUpperCase()
    set(hex)
  }
  function sync() {
    const hex = get()
    hsv = hex2hsv(hex)
    hexEl.value = hex.toUpperCase()
    paint()
  }
  /* Pointer capture, so a drag that leaves the square keeps tracking - letting
     go outside it otherwise strands the knob mid-drag. */
  const drag = (el, move) => {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId)
      const run = (ev) => {
        const r = el.getBoundingClientRect()
        move(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
             Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)))
        paint(); push()
      }
      run(e)
      const up = () => {
        el.removeEventListener('pointermove', run)
        el.removeEventListener('pointerup', up)
        el.removeEventListener('pointercancel', up)
      }
      el.addEventListener('pointermove', run)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
    })
  }
  drag(sv, (x, y) => { hsv.s = x; hsv.v = 1 - y })
  drag(hue, (x) => { hsv.h = x * 360 })
  hexEl.addEventListener('input', () => {
    const c = clean(hexEl.value)
    if (!c) return
    hsv = hex2hsv(c); paint(); set(c)
  })
  for (const b of root.querySelectorAll('.sw')) {
    b.addEventListener('click', () => { hsv = hex2hsv(b.dataset.c); paint(); push() })
  }
  return { sync: sync }
}

/* ---------------- wiring ---------------- */
const gallery = document.getElementById('gallery')
gallery.innerHTML = GROUPS.map(function (g) {
  return '<div class="group">' + g.name + '</div>' +
    g.ids.map(function (id) {
      return '<div class="cell" data-id="' + id + '"><span data-cell="' + id + '"></span>' +
        '<div class="nm">' + id + '</div></div>'
    }).join('')
}).join('')

const pkPage = Picker(document.getElementById('pk-page'), 'Glyph background',
  () => state[current].page, (v) => { state[current].page = v; save(current); render() })
const pkGlyph = Picker(document.getElementById('pk-glyph'), 'Glyph',
  () => state[current].glyph, (v) => { state[current].glyph = v; save(current); render() })

const dial = document.getElementById('glint')
dial.addEventListener('input', () => {
  /* One dial, every identity: a sheen that varied per icon would read as a set
     of different materials rather than one. */
  for (const id of ORDER) { state[id].glint = +dial.value; save(id) }
  render()
})

function render() {
  const st = state[current], d = DATA[current]
  document.getElementById('title').textContent = current
  document.getElementById('sub').textContent =
    d.kind + ' page  ·  band ' + BAND + '  ·  label ' + d.ext
  const heroes = [['h-dark', 'dark'], ['h-light', 'light'], ['h-sel', 'sel']]
  for (const pair of heroes) document.getElementById(pair[0]).innerHTML = svgFor(current, 88, pair[1])
  const rows = [['r-dark', 'dark'], ['r-light', 'light'], ['r-sel', 'sel']]
  for (const pair of rows) document.getElementById(pair[0]).innerHTML = svgFor(current, 16, pair[1])
  for (const el of gallery.querySelectorAll('[data-cell]')) {
    el.innerHTML = svgFor(el.dataset.cell, 34, 'dark')
  }
  for (const el of gallery.querySelectorAll('.cell')) {
    el.dataset.on = el.dataset.id === current ? '1' : '0'
  }
  document.getElementById('glintval').textContent = st.glint + '%'
  const r = ratio(st.glyph, st.page)
  const el = document.getElementById('meta')
  el.className = 'meta' + (r < 2 ? ' warn' : '')
  el.textContent = 'glyph on page ' + r.toFixed(2) + ':1' +
    (r < 2 ? '  ·  under 2:1 the mark is hard to make out at 16px' : '') +
    '   ·   label ' + ratio(inkOn(BAND), BAND).toFixed(1) + ':1'
  summarise()
}

function summarise() {
  document.getElementById('out').textContent =
    ORDER.map(function (id) {
      return id.padEnd(10) + ' page ' + state[id].page + '   glyph ' + state[id].glyph
    }).join('\n') + '\n\nband       ' + BAND + ' (all)\nglint      ' + state[ORDER[0]].glint + '%'
}

gallery.addEventListener('click', (e) => {
  const cell = e.target.closest('.cell')
  if (!cell) return
  current = cell.dataset.id
  pkPage.sync(); pkGlyph.sync(); render()
})

document.getElementById('copy').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('out').textContent).catch(() => {})
})

dial.value = state[ORDER[0]].glint
pkPage.sync(); pkGlyph.sync(); render()
"""


def start_state(ident, kind):
    """Where an identity opens: the first round's pick if it had one, else the
    page its KIND already wears, so nothing on screen is a fresh guess."""
    page = FIRST_ROUND.get(ident) or FIRST_ROUND.get(kind, "#aab2c0")
    return {"page": page, "glyph": FIRST_ROUND_GLYPH.get(ident, "#ffffff"), "glint": 22}


def main(out_dir):
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ids = svg.identities()
    order = [i for g in GROUPS for i in g["ids"]]
    # The gallery and the emitter's table must name the same set. A silent
    # mismatch is an identity nobody can reach, or a cell that renders nothing.
    # The gallery must name identities that exist, and must account for every
    # one the emitter knows about - either by offering it or by fixing it.
    # A silent mismatch is an identity nobody can reach, or a cell drawing
    # nothing.
    unknown = set(order) - set(ids)
    unclaimed = set(ids) - set(order) - FIXED
    if unknown or unclaimed:
        raise SystemExit(f"gallery and svg.IDENTITIES disagree: "
                         f"unknown={sorted(unknown)} unclaimed={sorted(unclaimed)}")

    data = {
        k: {"kind": v["kind"], "ext": v["ext"], "body": v["body"], "bleed": v["bleed"],
            "ko": v["ko"], "mark": v["mark"], "hi": v["hi"], "label": v["label"]}
        for k, v in ids.items()
    }
    start = {k: start_state(k, ids[k]["kind"]) for k in order}
    # Token replacement rather than %-formatting: the script is full of literal
    # percent signs (hsl(... 100% 50%), knob positions), and every one of them
    # is a format specifier to Python.
    js = SCRIPT
    for token, value in (("__DATA__", data), ("__ORDER__", order), ("__GROUPS__", GROUPS),
                         ("__START__", start), ("__BAND__", BAND)):
        js = js.replace(token, json.dumps(value))
    html = HEAD + BODY + "<script>" + js + "</script>"
    (out / "index.html").write_text(html, encoding="utf-8")
    print(out / "index.html")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
