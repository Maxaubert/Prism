/**
 * Ten films from one design.
 *
 * Writing ten compositions by hand would produce ten slightly different design
 * systems and ten places to fix the same typo. So the look lives here once, each
 * film is a list of beats, and the HTML is generated:
 *
 *   node tools/showcase/films.mjs            # write every composition
 *   node tools/showcase/films.mjs styles     # just one
 *
 * Two layouts. `column` puts the window on one side and the type on the other,
 * for films that explain. `band` runs the window full width with a word across
 * the bottom, for films that just show. Everything else is shared: the ink
 * plane, the cream display face, the mono labels, one accent used sparingly, and
 * the same masked line-rise on every reveal.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const PROJECT = join(ROOT, 'videos', 'prism-showcase')
const OUT = join(PROJECT, 'compositions')
const ASSETS = join(PROJECT, 'assets')

const URL = 'github.com/Maxaubert/Prism'

/* ------------------------------------------------------------------ the films */
/* A beat is one shot and the words that go over it. `at` and `len` are seconds;
   `from` skips into the clip. `lines` is the display type, `sub` the mono line
   under it. Beats are written in order and the generator does the arithmetic. */

const FILMS = {
  /* THE film. Everything else in this file is a study for it.
   *
   * Four things it has to say, in the order someone would ask them: what you
   * look at, what you play, what you listen to, what you read. Then the folder
   * they all live in, and the fact that the window can look however you like.
   *
   * Pacing is deliberately uneven. The first three beats are short because they
   * are obvious and the viewer is still deciding whether to keep watching; the
   * later ones are longer because they are the reasons to download it. Ten
   * identical beats is a list, and a list is what the last ten films were.
   */
  prism: {
    title: 'Prism',
    rail: 'Prism · A modern file viewer',
    layout: 'column',
    side: 'right',
    beats: [
      { clip: 'open', len: 4, still: true, lines: ['view', 'images'],
        sub: 'Open one and it is there. Arrow keys walk the rest of the folder.' },
      { clip: 'zoom', len: 5.4, from: 0.6, lines: ['closer,', 'and around'],
        sub: 'Wheel to zoom, drag to move, 0 to put it back. R turns it a quarter at a time.' },
      // No transport in shot: the chrome hides itself when nothing is happening,
      // and a still progress bar in a film is furniture nobody asked to see.
      { clip: 'video-plain', len: 5.6, from: 2.6, lines: ['watch', 'videos'],
        sub: 'It plays at once. Seek, speed, single frames, and the chrome fades when you stop moving.' },
      /* The tour is Halo to 3.8s, Flow to 6.9s, Wall 2 to 9.5s. The beat has to
         reach past 6.9 or it cuts a tenth of a second into the third one, which
         reads as the film losing its nerve rather than moving on. */
      { clip: 'viz-tour', len: 8.3, from: 1, lines: ['listen to', 'audio'],
        sub: 'Cover art, a real spectrum, and a visualizer you can size, place and recolour.' },
      // Ends at 4.7s, before the click at 4.90s: running past it put a new
      // picture on screen for two frames right as the beat cut away.
      { clip: 'tree-walk', len: 4.2, from: 0.5, lines: ['the whole', 'folder'],
        sub: 'Ctrl+B opens a tree rooted where you opened, and it never wanders above it.' },
      /* Long, and meant to be: five styles need room to be seen as five rather
         than as flicker, and this is the beat the film ends on. */
      { clip: 'doc-theme', len: 12.4, from: 0.9, still: true, lines: ['read, and', 'make it yours'],
        sub: 'Documents in the same window, and styles that dress the frame without touching the text.' }
    ]
  },

  overview: {
    title: 'Prism, a modern file viewer',
    rail: 'Prism · A modern file viewer',
    layout: 'column',
    side: 'right',
    beats: [
      { clip: 'open', len: 2.9, lines: ['a modern', 'file viewer'],
        sub: 'Open a file, see it now, and arrow through the rest of the folder. Windows 10 and 11, free.' },
      { clip: 'portrait', len: 3.6, lines: ['images,', 'video, sound'],
        sub: 'JPG PNG WEBP AVIF HEIC JXL · MP4 MKV MOV WEBM AVI · MP3 FLAC WAV OPUS OGG' },
      { clip: 'viz-tour', len: 4.6, from: 1.2, lines: ['a real', 'visualizer'],
        sub: 'Several to choose from, each with its own framing, changed while the track plays.' },
      { clip: 'tree', len: 4, from: 0.4, lines: ['the whole', 'folder'],
        sub: 'Ctrl+B opens a tree rooted where you opened, and it never wanders above it.' },
      { clip: 'style-many', len: 5.2, from: 1, lines: ['eleven', 'styles'],
        sub: 'Five dark, six light. Each one a full treatment of the window rather than a colour swap.' },
      { clip: 'style-video', len: 4.6, from: 0.6, lines: ['changed', 'live'],
        sub: 'Under a running video. Nothing stops, nothing reloads, nothing blinks.' }
    ]
  },

  fifteen: {
    title: 'Prism in fifteen',
    layout: 'band',
    beats: [
      { clip: 'open', len: 1.9, lines: ['open it'], sub: 'JPG · PNG · WEBP · AVIF · HEIC' },
      { clip: 'portrait', len: 1.9, from: 1.4, lines: ['anything'], sub: 'Pictures, video and sound' },
      { clip: 'zoom', len: 1.8, from: 1.2, lines: ['closer'], sub: 'Fit · zoom · pan · rotate' },
      { clip: 'tree-walk', len: 1.9, from: 1.6, lines: ['the whole folder'], sub: 'Ctrl+B' },
      { clip: 'video', len: 1.9, from: 0.8, lines: ['watch it'], sub: 'Seek · speed · frame steps' },
      { clip: 'audio', len: 1.8, from: 1, lines: ['hear it'], sub: 'Halo, Flow and Wall 2' },
      { clip: 'style-many', len: 2.4, from: 2.2, lines: ['make it yours'], sub: 'Eleven styles, light and dark' }
    ]
  },

  styles: {
    title: 'Prism styles',
    rail: 'Prism · Styles',
    layout: 'column',
    side: 'left',
    beats: [
      { clip: 'style-many', len: 6, from: 0.8, lines: ['eleven', 'ways'],
        sub: 'One window. Five dark, six light, and the difference between them is the whole window, not an accent.' },
      { clip: 'style-warm', len: 5, from: 1.2, lines: ['the warm', 'ones'],
        sub: 'Driftwood in the dark, Linen and Paper in the light. Quiet enough to leave open all day.' },
      { clip: 'style-video', len: 4.8, from: 0.6, lines: ['while it', 'plays'],
        sub: 'The look changes under a running video. Nothing stops and nothing reloads.' },
      { clip: 'style-photo', len: 4.4, from: 1, lines: ['dark or', 'light'],
        sub: 'Each mode keeps its own style, so switching does not lose the look you chose.' }
    ]
  },

  visualizer: {
    title: 'The Prism visualizer',
    rail: 'Prism · The visualizer',
    layout: 'column',
    side: 'right',
    beats: [
      { clip: 'audio', len: 4.2, lines: ['sound,', 'seen'],
        sub: 'Cover art, the track, and a visualizer reading the actual spectrum.' },
      { clip: 'viz-tour', len: 5.6, from: 0.8, lines: ['three', 'that stuck'],
        sub: 'Halo, Flow and Wall 2, each with its own framing, changed while the track plays.' },
      { clip: 'viz-colour', len: 5, from: 0.8, lines: ['forty', 'palettes'],
        sub: 'Or one that simply follows whatever accent your style is wearing.' },
      { clip: 'settings-viz', len: 4.6, from: 2.6, lines: ['size it,', 'place it'],
        sub: 'Height, position, glow and drift, all while the track keeps playing.' }
    ]
  },

  kinds: {
    title: 'Everything Prism opens',
    rail: 'Prism · What it opens',
    layout: 'list',
    beats: [
      { clip: 'open', len: 2.9, item: 'Pictures' },
      { clip: 'portrait', len: 2.8, item: 'Any shape' },
      { clip: 'video', len: 3.4, from: 0.6, item: 'Video' },
      { clip: 'audio', len: 3.2, item: 'Sound' },
      { clip: 'tree-walk', len: 3.2, from: 1.2, item: 'The folder' }
    ],
    note:
      'JPG PNG WEBP AVIF HEIC JXL TIFF SVG GIF ICO · MP4 MKV MOV WEBM AVI · ' +
      'MP3 FLAC WAV OPUS OGG AAC M4A'
  },

  images: {
    title: 'Prism, images',
    rail: 'Prism · Images',
    layout: 'column',
    side: 'left',
    beats: [
      { clip: 'open', len: 2.9, lines: ['fitted,', 'immediately'],
        sub: 'Every picture arrives at the size of the window. Arrow keys walk the folder.' },
      { clip: 'zoom-deep', len: 5.6, from: 0.8, lines: ['all the', 'way in'],
        sub: 'Wheel to zoom, drag to move, and 0 to put it back the way it was.' },
      { clip: 'rotate', len: 4, from: 0.6, lines: ['and around'],
        sub: 'R turns it a quarter at a time, for the photographs the camera got sideways.' },
      { clip: 'portrait', len: 4, lines: ['tall or', 'wide'],
        sub: 'Portrait, landscape, square. The fit is worked out per picture, not per folder.' }
    ]
  },

  video: {
    title: 'Prism, video',
    rail: 'Prism · Video',
    layout: 'column',
    side: 'right',
    beats: [
      { clip: 'video', len: 5, lines: ['a player,', 'not a page'],
        sub: 'It plays at once, and the chrome fades out when the pointer stops moving.' },
      { clip: 'seek', len: 5.4, from: 0.8, lines: ['a frame', 'at a time'],
        sub: 'Comma and period step single frames. Arrows jump five seconds. Space stops it dead.' },
      { clip: 'speed', len: 4.4, from: 1, lines: ['or twice', 'as fast'],
        sub: 'Speed lives in the transport, where you are already looking.' }
    ]
  },

  tree: {
    title: 'The Prism file tree',
    rail: 'Prism · The tree',
    layout: 'column',
    side: 'left',
    beats: [
      { clip: 'tree', len: 4.4, lines: ['a tree,', 'bounded'],
        sub: 'Ctrl+B. Rooted at the folder you opened from, and it refuses to go above it.' },
      { clip: 'tree-walk', len: 5, from: 0.8, lines: ['click', 'anything'],
        sub: 'Every file opens in the window beside it, whatever kind it happens to be.' },
      { clip: 'rename', len: 4.3, from: 1.4, lines: ['rename', 'in place'],
        sub: 'F2, type, enter. The extension is left alone unless you go looking for it.' },
      { clip: 'delete', len: 4.6, from: 1.6, lines: ['delete,', 'reversibly'],
        sub: 'It asks once and says where the file goes. Everything lands in the Recycle Bin.' }
    ]
  },

  craft: {
    title: 'Prism, the small things',
    rail: 'Prism · The small things',
    layout: 'column',
    side: 'right',
    beats: [
      { clip: 'handoff', len: 4.2, lines: ['the second', 'file'],
        sub: 'One process. Open another file from anywhere and the window already up takes it.' },
      { clip: 'settings-general', len: 4.4, from: 1.2, lines: ['scoped', 'navigation'],
        sub: 'Decide how far the arrow keys may walk: everything, one kind, or one file type.' },
      { clip: 'settings', len: 4.6, from: 0.6, lines: ['settings', 'that show'],
        sub: 'Every style is a miniature of the window it makes, so nothing has to be imagined.' },
      { clip: 'style-photo', len: 4.4, from: 1.2, lines: ['light and', 'dark'],
        sub: 'Each mode keeps its own style, so switching does not lose the look you chose.' }
    ]
  },

  loop: {
    title: 'Prism loop',
    layout: 'band',
    silentEnd: true,
    /* A collage, not a tour. Eight things in seven seconds, none of them dwelt
       on: the point of a loop is that the second time round you notice what you
       missed, and a slow one has nothing left to find. */
    beats: [
      { clip: 'open', len: 0.9, lines: ['open any file'] },
      { clip: 'zoom', len: 0.9, from: 1.4 },
      { clip: 'tree-walk', len: 0.9, from: 2.2, lines: ['the whole folder'] },
      { clip: 'video', len: 0.9, from: 1.2 },
      { clip: 'audio', len: 0.9, from: 1.4, lines: ['watch, hear, read'] },
      { clip: 'viz-tour', len: 0.9, from: 6.4 },
      { clip: 'style-many', len: 0.9, from: 3.2, lines: ['make it yours'] },
      { clip: 'style-video', len: 1.1, from: 4.4 }
    ]
  }
}

/* ------------------------------------------------------------------ the design */

const CSS = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1920px; height: 1080px; overflow: hidden; background: #000; }
      :root {
        --ink: #08080b;
        --cream: #f2f3f7;
        --muted: #babfcc;
        --hint: #78787e;
        --accent: #5b5bd6;
        --display: "Segoe UI Variable Display", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
        --mono: "Cascadia Mono", Consolas, "Courier New", monospace;
      }
      #root { position: relative; width: 1920px; height: 1080px; overflow: hidden; }
      .bg { position: absolute; inset: 0; background: var(--ink); z-index: 0; }
      /* Never transformed. A CSS transform on the element a <video> lives in
         puts it on a composited layer that gets resampled, and the resampling
         drops about one frame in six: the same clip measures 0% duplicated
         frames on its own and 16% inside a scaled box. That is the hitch. The
         window is sized directly and faded by a veil over the top of it. */
      #screen { position: absolute; z-index: 2; border-radius: 12px; overflow: hidden;
        box-shadow: 0 40px 90px -25px rgba(0, 0, 0, 0.92); }
      #veil { position: absolute; inset: 0; background: #08080b; z-index: 5; opacity: 0;
        pointer-events: none; }
      /* contain, not cover. The boxes below are cut to the footage's own 3:2,
         but a clip that ever differs should letterbox rather than lose an edge:
         cover was quietly shaving the file tree off the left of every shot that
         had one. */
      #screen .clip { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
      .mask { display: block; overflow: hidden; padding-bottom: 5px; }
      .line { display: block; font-family: var(--display); font-weight: 800; color: var(--cream);
        letter-spacing: -0.045em; white-space: nowrap; }
      .rule { display: block; width: 100px; height: 3px; background: var(--accent);
        transform: scaleX(0); transform-origin: left center; }
      .sub { display: block; font-family: var(--mono); letter-spacing: 0.13em;
        text-transform: uppercase; color: var(--muted); }
      .rail, .num { font-family: var(--mono); letter-spacing: 0.16em; text-transform: uppercase; }
      .rail { position: absolute; left: 96px; top: 74px; font-size: 15px; color: var(--muted); z-index: 4; }
      .hair { position: absolute; left: 96px; right: 84px; top: 108px; height: 1px;
        background: #1d1d24; z-index: 4; }
      /* No progress line. Every player this is watched in draws its own, and two
         of them stacked is one too many: the viewer reads the film's as part of
         the app rather than as part of the page. */
      .end { position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; z-index: 6; }
      .wordmark { display: block; font-family: var(--display); font-size: 196px; font-weight: 800;
        letter-spacing: -0.05em; line-height: 1.06; color: var(--cream); }
      .end-line { display: block; font-family: var(--mono); font-size: 19px; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--muted); margin-top: 24px; }
`

const LAYOUT = {
  column: `
      #screen { top: 166px; width: 1152px; height: 766px; }
      .col { position: absolute; top: 166px; width: 520px; height: 766px; z-index: 3; }
      .num { position: absolute; top: 0; left: 0; font-size: 15px; color: var(--hint); }
      .slot { position: absolute; top: 176px; left: 0; width: 560px; }
      .line { font-size: 104px; line-height: 1; }
      .rule { margin: 26px 0 20px; }
      .sub { font-size: 16px; line-height: 1.75; max-width: 470px; }
`,
  band: `
      #screen { left: 160px; top: 8px; width: 1600px; height: 1064px; border-radius: 15px; }
      .band { position: absolute; left: 0; right: 0; bottom: 0; height: 330px; z-index: 3;
        background: linear-gradient(to top, rgba(4,4,6,.94) 12%, rgba(4,4,6,0) 100%); }
      .word { position: absolute; left: 104px; bottom: 96px; z-index: 4; }
      .line { font-size: 118px; line-height: 1; }
      .tag { position: absolute; right: 104px; bottom: 122px; font-family: var(--mono); font-size: 17px;
        letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); z-index: 4; }
`,
  list: `
      #screen { left: 700px; top: 150px; width: 1140px; height: 758px; }
      .list { position: absolute; left: 96px; top: 232px; width: 560px; z-index: 3; }
      .item { display: block; font-family: var(--display); font-size: 76px; font-weight: 800;
        line-height: 1.14; letter-spacing: -0.04em; color: var(--cream); opacity: 0; white-space: nowrap; }
      .item .dot { display: inline-block; width: 13px; height: 13px; margin-right: 20px;
        border-radius: 999px; background: var(--accent); vertical-align: middle; }
      .kicker { position: absolute; left: 96px; top: 150px; font-family: var(--mono); font-size: 16px;
        letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); z-index: 3; }
      .note { position: absolute; left: 96px; top: 848px; width: 520px; font-family: var(--mono);
        font-size: 15.5px; line-height: 1.8; letter-spacing: 0.12em; text-transform: uppercase;
        color: var(--hint); z-index: 3; opacity: 0; }
`
}

/* ------------------------------------------------------------------ generation */

const seconds = (file) =>
  Number(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      encoding: 'utf8'
    }).stdout.trim() || 0
  )

/**
 * Lay the beats out on a timeline, fitted to the clips that actually exist.
 *
 * A beat asks for a length; the clip decides what it can give. Re-recording
 * shifts every duration a little - a different pace, a tighter trim, a capture
 * that starts closer to the action - and refusing to build the film over a
 * missing third of a second just means editing ten numbers by hand each time.
 * So a beat that overruns its clip is shortened to fit and the trim is reported.
 * Only a beat with nothing left worth showing is dropped.
 */
function schedule(film) {
  const problems = []
  const fitted = []
  for (const b of film.beats) {
    const file = join(ASSETS, `${b.clip}.mp4`)
    if (!existsSync(file)) {
      problems.push(`${b.clip}.mp4 is missing`)
      continue
    }
    const from = b.from ?? 0
    const have = seconds(file)
    const room = have - from - 0.05
    if (room < 1.2) {
      problems.push(`${b.clip} has only ${Math.max(0, room).toFixed(1)}s past ${from}s, dropped`)
      continue
    }
    if (b.len > room) problems.push(`${b.clip} trimmed ${b.len.toFixed(1)}s to ${room.toFixed(1)}s`)
    fitted.push({ ...b, from, len: Number(Math.min(b.len, room).toFixed(2)) })
  }

  let t = 0
  const beats = fitted.map((b) => {
    const beat = { ...b, at: Number(t.toFixed(2)) }
    t += b.len
    return beat
  })
  return { beats, body: Number(t.toFixed(2)), problems }
}

/**
 * A display line is set as large as it can be without leaving its column.
 *
 * The type is `white-space: nowrap`, so a long line does not wrap, it simply
 * keeps going - across the gutter and into the window. "images, video, sound"
 * at 104px did exactly that. Measuring properly would mean a browser; the ratio
 * below is Segoe UI Variable Display at weight 800 with -0.045em tracking, and
 * it errs small.
 */
function fit(lines, room, max) {
  const longest = Math.max(...lines.map((l) => l.length))
  return Math.min(max, Math.floor(room / (longest * 0.5)))
}

function videos(beats) {
  return beats
    .map(
      (b) =>
        `        <video id="v-${b.clip}" class="clip" src="assets/${b.clip}.mp4" data-start="${b.at}" ` +
        `data-duration="${b.len}" data-track-index="0"` +
        (b.from ? ` data-media-start="${b.from}"` : '') +
        ` muted playsinline></video>`
    )
    .join('\n')
}

function columnFilm(id, film, { beats, body }) {
  const total = Number((body + 3).toFixed(2))
  const sideCss = film.side === 'left' ? '.col { right: 96px; } #screen { left: 84px; }'
    : '.col { left: 96px; } #screen { left: 684px; }'
  const cols = beats
    .map(
      (b, i) => `      <section id="c${i + 1}" class="clip col" data-start="${(b.at + 0.3).toFixed(2)}" data-duration="${(b.len - 0.4).toFixed(2)}" data-track-index="1">
        <div class="num">${String(i + 1).padStart(2, '0')} / ${String(beats.length).padStart(2, '0')}</div>
        <div class="slot">
${b.lines
  .map(
    (l) =>
      `          <span class="mask"><span class="line" style="font-size:${fit(b.lines, 545, 104)}px">${l}</span></span>`
  )
  .join('\n')}
          <span class="rule"></span>
          <span class="sub">${b.sub}</span>
        </div>
      </section>`
    )
    .join('\n\n')

  const tweens = beats
    .map((b, i) => {
      const at = b.at + 0.3
      const out = at + (b.len - 0.4)
      return `        ["#c${i + 1}", ${at.toFixed(2)}, ${out.toFixed(2)}]`
    })
    .join(',\n')

  /* Which beats get the slow push: only the ones whose footage holds still. */
  const drift = beats
    .filter((b) => b.still)
    .map((b) => `        [${b.at.toFixed(2)}, ${(b.at + b.len).toFixed(2)}]`)
    .join(',\n')

  return page(id, film, total, `${LAYOUT.column}\n      ${sideCss}`, `
      <div id="screen">
${videos(beats)}
      </div>

      <div id="chrome" class="clip" data-start="0" data-duration="${total}" data-track-index="8">
        <div class="rail">${film.rail}</div>
        <div class="hair"></div>
      </div>

${cols}

      <section id="end" class="clip end" data-start="${body.toFixed(2)}" data-duration="3" data-track-index="3">
        <span class="mask"><span class="wordmark" id="end-mark">prism</span></span>
        <span class="end-line" id="end-url">${URL}</span>
      </section>`, `
      const BEATS = [
${tweens}
      ];

      const DRIFT = [
${drift}
      ];

      /* A slow push on the beats whose content does not move.
       *
       * A picture viewer showing a picture is a still frame, and cutting between
       * still frames reads as the video stalling. Half a percent of scale a
       * second is not something you notice happening, only something you notice
       * missing. It is applied ONLY where the content is static: a transform on
       * a layer holding a playing video makes the compositor resample it and
       * drops one frame in six, which is the judder this film had. */
      DRIFT.forEach(([at, out]) => {
        tl.fromTo("#screen", { scale: 1 }, { scale: 1.035, duration: out - at, ease: "none" }, at);
        tl.set("#screen", { clearProps: "transform" }, out);
      });

      BEATS.forEach(([id, at, out]) => {
        tl.fromTo(\`\${id} .num\`, { opacity: 0, x: -14 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, at);
        tl.fromTo(\`\${id} .line\`, { yPercent: 112 }, { yPercent: 0, duration: 0.72, stagger: 0.075, ease: "power3.out" }, at + 0.1);
        tl.fromTo(\`\${id} .rule\`, { scaleX: 0 }, { scaleX: 1, duration: 0.65, ease: "power3.out" }, at + 0.36);
        tl.fromTo(\`\${id} .sub\`, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, at + 0.44);
        tl.to(\`\${id} .line\`, { yPercent: -112, duration: 0.46, stagger: 0.05, ease: "power2.in" }, out - 0.56);
        tl.to(\`\${id} .rule\`, { scaleX: 0, duration: 0.36, ease: "power2.in" }, out - 0.5);
        tl.to([\`\${id} .sub\`, \`\${id} .num\`], { opacity: 0, duration: 0.36, ease: "power2.in" }, out - 0.5);
      });

      tl.fromTo("#veil", { opacity: 1 }, { opacity: 0, duration: 0.7, ease: "power2.out" }, 0);
      tl.to("#veil", { opacity: 1, duration: 0.55, ease: "power2.inOut" }, ${(body - 0.6).toFixed(2)});
      tl.to("#chrome", { opacity: 0, duration: 0.5, ease: "power2.in" }, ${(body - 0.3).toFixed(2)});
      tl.fromTo("#end-mark", { yPercent: 116 }, { yPercent: 0, duration: 0.85, ease: "power3.out" }, ${(body + 0.15).toFixed(2)});
      tl.fromTo("#end-url", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${(body + 0.7).toFixed(2)});`)
}

function bandFilm(id, film, { beats, body }) {
  const total = film.silentEnd ? body : Number((body + 2.2).toFixed(2))
  const words = beats
    .map(
      (b, i) =>
        (b.lines
          ? `      <div id="w${i + 1}" class="clip word" data-start="${(b.at + 0.15).toFixed(2)}" data-duration="${(b.len - 0.15).toFixed(2)}" data-track-index="1">
        <span class="mask"><span class="line" style="font-size:${fit(b.lines, 1500, 118)}px">${b.lines[0]}</span></span>
      </div>`
          : '') + (b.sub ? `
      <div id="g${i + 1}" class="clip tag" data-start="${(b.at + 0.15).toFixed(2)}" data-duration="${(b.len - 0.15).toFixed(2)}" data-track-index="2">${b.sub}</div>` : '')
    )
    .join('\n')

  const tweens = beats
    .map((b) => `        [${(b.at + 0.15).toFixed(2)}, ${(b.len - 0.15).toFixed(2)}, ${b.sub ? 'true' : 'false'}]`)
    .join(',\n')

  const end = film.silentEnd
    ? ''
    : `
      <section id="end" class="clip end" data-start="${body.toFixed(2)}" data-duration="2.2" data-track-index="3">
        <span class="mask"><span class="wordmark" id="end-mark">prism</span></span>
        <span class="end-line" id="end-url">${URL}</span>
      </section>`

  const endTweens = film.silentEnd
    ? ''
    : `
      tl.to("#veil", { opacity: 1, duration: 0.55, ease: "power2.inOut" }, ${(body - 0.2).toFixed(2)});
      tl.fromTo("#end-mark", { yPercent: 118 }, { yPercent: 0, duration: 0.85, ease: "power3.out" }, ${(body + 0.1).toFixed(2)});
      tl.fromTo("#end-url", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${(body + 0.65).toFixed(2)});`

  return page(id, film, total, LAYOUT.band, `
      <div id="screen">
${videos(beats)}
      </div>

      <div id="band" class="clip band" data-start="0" data-duration="${body.toFixed(2)}" data-track-index="8"></div>

${words}
${end}`, `
      const BEATS = [
${tweens}
      ];

      BEATS.forEach(([at, len, hasTag], i) => {
        const w = \`#w\${i + 1}\`;
        tl.fromTo(\`\${w} .line\`, { yPercent: 115 }, { yPercent: 0, duration: 0.62, ease: "power3.out" }, at);
        tl.to(\`\${w} .line\`, { yPercent: -115, duration: 0.34, ease: "power2.in" }, at + len - 0.36);
        if (hasTag) {
          const g = \`#g\${i + 1}\`;
          tl.fromTo(g, { opacity: 0, x: 26 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, at + 0.12);
          tl.to(g, { opacity: 0, duration: 0.28, ease: "power2.in" }, at + len - 0.32);
        }
      });

      tl.fromTo("#veil", { opacity: 1 }, { opacity: 0, duration: 0.6, ease: "power2.out" }, 0);${endTweens}`)
}

function listFilm(id, film, { beats, body }) {
  const total = Number((body + 2.6).toFixed(2))
  const items = beats
    .map((b, i) => `        <span class="item" id="i${i + 1}"><span class="dot"></span>${b.item}</span>`)
    .join('\n')
  const tweens = beats.map((b) => `        ${(b.at + 0.35).toFixed(2)}`).join(',\n')

  return page(id, film, total, LAYOUT.list, `
      <div id="screen">
${videos(beats)}
      </div>

      <div id="chrome" class="clip" data-start="0" data-duration="${total}" data-track-index="8">
        <div class="rail">${film.rail}</div>
        <div class="hair"></div>
      </div>

      <div id="kicker" class="clip kicker" data-start="0.2" data-duration="${(body - 0.2).toFixed(2)}" data-track-index="7">One viewer, one window</div>

      <div id="list" class="clip list" data-start="0.2" data-duration="${(body - 0.2).toFixed(2)}" data-track-index="1">
${items}
      </div>

      <div id="note" class="clip note" data-start="${(body - 2.9).toFixed(2)}" data-duration="2.9" data-track-index="2">${film.note}</div>

      <section id="end" class="clip end" data-start="${body.toFixed(2)}" data-duration="2.6" data-track-index="3">
        <span class="mask"><span class="wordmark" id="end-mark">prism</span></span>
        <span class="end-line" id="end-url">${URL}</span>
      </section>`, `
      const AT = [
${tweens}
      ];

      AT.forEach((at, i) => {
        const id = \`#i\${i + 1}\`;
        tl.fromTo(id, { opacity: 0, x: -26 }, { opacity: 1, x: 0, duration: 0.55, ease: "power3.out" }, at);
        tl.fromTo(\`\${id} .dot\`, { scale: 0 }, { scale: 1, duration: 0.45, ease: "back.out(2.2)" }, at + 0.05);
        if (i > 0) tl.to(\`#i\${i}\`, { opacity: 0.34, duration: 0.5, ease: "power2.out" }, at);
      });

      tl.fromTo("#kicker", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.out" }, 0.2);
      tl.fromTo("#note", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${(body - 2.8).toFixed(2)});
      tl.fromTo("#veil", { opacity: 1 }, { opacity: 0, duration: 0.65, ease: "power2.out" }, 0);
      tl.to("#veil", { opacity: 1, duration: 0.55, ease: "power2.inOut" }, ${(body - 0.5).toFixed(2)});
      tl.to(["#list", "#kicker", "#note", "#chrome"], { opacity: 0, duration: 0.5, ease: "power2.in" }, ${(body - 0.4).toFixed(2)});
      tl.fromTo("#end-mark", { yPercent: 116 }, { yPercent: 0, duration: 0.85, ease: "power3.out" }, ${(body + 0.15).toFixed(2)});
      tl.fromTo("#end-url", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${(body + 0.7).toFixed(2)});`)
}

function page(id, film, total, layoutCss, body, script) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${film.title}</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>${CSS}${layoutCss}    </style>
  </head>
  <body>
    <!-- Generated by tools/showcase/films.mjs. Edit the film's beats there. -->
    <div
      id="root"
      data-composition-id="${id}"
      data-start="0"
      data-width="1920"
      data-height="1080"
      data-duration="${total}"
    >
      <div id="ground" class="clip bg" data-start="0" data-duration="${total}" data-track-index="9"></div>
${body}
      <div id="veil" class="clip" data-start="0" data-duration="${total}" data-track-index="6"></div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${script}

      window.__timelines["${id}"] = tl;
    </script>
  </body>
</html>
`
}

const wanted = process.argv.slice(2)
const names = wanted.length ? wanted : Object.keys(FILMS)
mkdirSync(OUT, { recursive: true })

for (const name of names) {
  const film = FILMS[name]
  if (!film) throw new Error(`no such film: ${name}`)
  const plan = schedule(film)
  if (!plan.beats.length) {
    console.log(`  ${name.padEnd(12)} nothing to build: ${plan.problems.join('; ')}`)
    continue
  }
  const build =
    film.layout === 'band' ? bandFilm : film.layout === 'list' ? listFilm : columnFilm
  writeFileSync(join(OUT, `${name}.html`), build(name, film, plan))
  const total = film.layout === 'band' && film.silentEnd ? plan.body : plan.body + (film.layout === 'list' ? 2.6 : film.layout === 'band' ? 2.2 : 3)
  console.log(
    `  ${name.padEnd(12)} ${plan.beats.length} beats, ${total.toFixed(1)}s` +
      (plan.problems.length ? `  (${plan.problems.join('; ')})` : '')
  )
}
