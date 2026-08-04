/**
 * The folder the showcase browses.
 *
 * Everything here is made on this machine: the stills come out of FLUX, the
 * track is synthesised by ffmpeg, and the only borrowed file is one stock clip
 * under a licence that allows it. Nothing personal, nothing to clear, and the
 * whole folder can be rebuilt from this file if it is ever lost.
 *
 *   node tools/showcase/media.mjs [--force]
 */
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEMO = join(HERE, '..', '..', '.demo', 'PrismDemo')
const COMFY = 'http://127.0.0.1:8188'
const FORCE = process.argv.includes('--force')

// Landscape, portrait and square all appear, so the trailer shows the viewer
// fitting each one rather than three variations of the same shape.
const STILLS = [
  {
    name: 'coastline-dawn',
    w: 1216,
    h: 832,
    seed: 704122,
    prompt:
      'photograph of a rocky Atlantic coastline before sunrise, long exposure, ' +
      'sea mist moving over black basalt, cold pink light low on the horizon, ' +
      'medium format, fine grain, no people'
  },
  {
    name: 'atrium',
    w: 1216,
    h: 832,
    seed: 118803,
    prompt:
      'architectural photograph of a board-marked concrete atrium under a glass roof, ' +
      'hard afternoon shadows falling across the floor, one distant figure walking, ' +
      'symmetrical composition, muted palette'
  },
  {
    name: 'dunes',
    w: 1216,
    h: 832,
    seed: 552019,
    prompt:
      'aerial photograph of desert dunes at low sun, long shadow ridges, ' +
      'warm ochre sand against deep shadow, minimal, high altitude, sharp'
  },
  {
    // No signage anywhere in this one on purpose: a generated photograph with
    // lettering in it announces what it is.
    name: 'rain-street',
    w: 1216,
    h: 832,
    seed: 812655,
    prompt:
      'rain-slick city street at night photographed from low down, headlights and ' +
      'red tail lights smeared across the wet asphalt, shallow depth of field, ' +
      '35mm documentary photograph, no signage, no lettering, no text'
  },
  {
    name: 'glacier',
    w: 1216,
    h: 832,
    seed: 869214,
    prompt:
      'close photograph of a glacier crevasse, deep blue compressed ice, ' +
      'overcast diffused light, layered texture, extremely detailed'
  },
  {
    name: 'still-life',
    w: 832,
    h: 1216,
    seed: 240688,
    prompt:
      'studio still life, three matte ceramic vessels on a seamless warm grey backdrop, ' +
      'soft directional light from the left, long soft shadows, editorial product photograph'
  },
  {
    name: 'cover',
    w: 1024,
    h: 1024,
    seed: 991377,
    dir: '..',
    prompt:
      'abstract album cover artwork, dark indigo field with a single bright arc of light ' +
      'cutting across it, heavy film grain, no text, square'
  }
]

/** FLUX.1-dev in API format: one graph per still, only prompt/size/seed differ. */
function graph({ prompt, w, h, seed, name }) {
  return {
    1: {
      class_type: 'UNETLoader',
      inputs: { unet_name: 'flux1-dev-fp8.safetensors', weight_dtype: 'fp8_e4m3fn' }
    },
    2: {
      class_type: 'DualCLIPLoader',
      inputs: {
        clip_name1: 'clip_l.safetensors',
        clip_name2: 't5xxl_fp8_e4m3fn_scaled.safetensors',
        type: 'flux'
      }
    },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
    6: { class_type: 'FluxGuidance', inputs: { conditioning: ['4', 0], guidance: 3.5 } },
    7: { class_type: 'EmptySD3LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
    8: {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['6', 0],
        negative: ['5', 0],
        latent_image: ['7', 0],
        seed,
        steps: 20,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'beta',
        denoise: 1
      }
    },
    9: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    10: { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: `prism/${name}` } }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function render(still) {
  const out = join(DEMO, still.dir ?? '.', `${still.name}.jpg`)
  if (existsSync(out) && !FORCE) return console.log(`  ${still.name} (kept)`)

  const post = await fetch(`${COMFY}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: graph(still) })
  })
  if (!post.ok) throw new Error(`queue failed: ${post.status} ${await post.text()}`)
  const { prompt_id } = await post.json()

  // FLUX at 20 steps is seconds on this card, but the first render also pays
  // for loading twelve gigabytes of weights.
  const started = Date.now()
  for (;;) {
    if (Date.now() - started > 10 * 60_000) throw new Error(`${still.name}: timed out`)
    await sleep(1500)
    const hist = await (await fetch(`${COMFY}/history/${prompt_id}`)).json()
    const done = hist[prompt_id]
    if (!done) continue
    if (done.status?.status_str === 'error') throw new Error(`${still.name}: ${JSON.stringify(done.status)}`)
    const image = Object.values(done.outputs ?? {}).flatMap((o) => o.images ?? [])[0]
    if (!image) continue
    const q = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: 'output' })
    const png = Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer())
    const tmp = join(DEMO, still.dir ?? '.', `${still.name}.png`)
    writeFileSync(tmp, png)
    // JPEG because that is what a folder of photographs actually contains.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-q:v', '2', out])
    rmSync(tmp)
    console.log(`  ${still.name} ${still.w}x${still.h} in ${Math.round((Date.now() - started) / 1000)}s`)
    return
  }
}

/**
 * A track for the visualizer to answer.
 *
 * The synthesised version of this was four sine partials, which is exactly four
 * bars of a spectrum ring doing anything: correct, licence-free, and dead on
 * screen. The visualizer reads a real spectrum, so it gets real music. Nothing
 * is ever heard (every clip is silent and the trailer carries no audio track);
 * the file exists to move bars, and its on-screen name is invented.
 */
function track() {
  const mp3 = join(DEMO, 'coast-road.mp3')
  if (existsSync(mp3) && !FORCE) return console.log('  coast-road.mp3 (kept)')
  const src = process.env.SHOWCASE_TRACK
  if (!src || !existsSync(src)) throw new Error('set SHOWCASE_TRACK to a source audio file')
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-ss', '32', '-t', '75', '-i', src,
    '-i', join(DEMO, '..', 'cover.jpg'),
    '-map', '0:a', '-map', '1:v',
    '-af', 'afade=t=in:d=1',
    '-c:a', 'libmp3lame', '-b:a', '192k',
    '-c:v', 'mjpeg', '-disposition:v', 'attached_pic',
    '-metadata', 'title=Coast Road',
    '-metadata', 'artist=Iona Fell',
    '-metadata', 'album=Long Way Round',
    mp3
  ])
  console.log('  coast-road.mp3 with cover art')
}

/** The one file not made here. Pexels licence: free to use, no attribution required. */
function clip() {
  const out = join(DEMO, 'Video', 'wave-study.mp4')
  if (existsSync(out) && !FORCE) return console.log('  Video/wave-study.mp4 (kept)')
  const src = process.env.SHOWCASE_CLIP
  if (!src || !existsSync(src)) throw new Error('set SHOWCASE_CLIP to a source video')
  // 4K into a 1280 wide window is decode time nobody sees. 1440p is plenty.
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', src,
    '-t', '40', '-vf', 'scale=2560:-2', '-c:v', 'libx264', '-crf', '20',
    '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', out
  ])
  console.log('  Video/wave-study.mp4')
}

mkdirSync(join(DEMO, 'Video'), { recursive: true })
console.log(`demo folder: ${DEMO}`)
for (const still of STILLS) await render(still)
track()
clip()
console.log('done')
