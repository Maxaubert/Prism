import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { access, mkdir, stat } from 'fs/promises'
import { dirname, extname, join } from 'path'

/**
 * MIDI, synthesised.
 *
 * A .mid holds no sound at all: it is a score - which note, which instrument,
 * when - and playing one means rendering it through an instrument bank.
 * Chromium cannot, ffmpeg cannot (its build has no fluidsynth), so Prism
 * carries a synthesiser and a General MIDI soundfont and renders the file to a
 * WAV once. What plays after that is an ordinary wav.
 *
 * The rendering is the soundfont's interpretation, not "the" sound of the
 * file: two players with different banks produce audibly different music, and
 * that is what MIDI is.
 */

const MIDI_EXTS = new Set(['.mid', '.midi', '.kar', '.rmi'])

export function isMidi(path: string): boolean {
  return MIDI_EXTS.has(extname(path).toLowerCase())
}

export const midiExtensions = (): string[] => [...MIDI_EXTS]

/** Where the bundled synthesiser lives; the same walk-up rule as ffmpeg. */
export function fluidDirs(packaged: boolean, resourcesPath: string, appPath: string): string[] {
  const dirs: string[] = []
  if (packaged) dirs.push(join(resourcesPath, 'bin'))
  let up = appPath
  for (let i = 0; i < 4; i++) {
    dirs.push(join(up, 'vendor', 'fluidsynth'))
    const parent = dirname(up)
    if (parent === up) break
    up = parent
  }
  return dirs
}

export interface Fluid {
  exe: string
  soundfont: string
}

let cached: Promise<Fluid | null> | undefined

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false
  )

/**
 * The bundled synthesiser, looked for once a session. Async (owner,
 * 2026-10-12, main never waits on the disk): the first MIDI opened probed up
 * to eight paths on main's thread. Callers share one search.
 */
export function findFluid(packaged: boolean, resourcesPath: string, appPath: string): Promise<Fluid | null> {
  if (cached !== undefined) return cached
  cached = (async (): Promise<Fluid | null> => {
    for (const dir of fluidDirs(packaged, resourcesPath, appPath)) {
      const exe = join(dir, 'fluidsynth.exe')
      const soundfont = join(dir, 'soundfont.sf3')
      // Both halves or neither: a synthesiser with no bank renders silence.
      if ((await exists(exe)) && (await exists(soundfont))) return { exe, soundfont }
    }
    return null
  })()
  return cached
}

/** Test seam. */
export function resetFluid(): void {
  cached = undefined
}

/** fluidsynth argv for "render this score to this wav, quietly". */
export function midiArgs(soundfont: string, midi: string, out: string): string[] {
  return [
    '-ni', // no shell, no live audio device
    '-F', out,
    '-r', '44100',
    '-g', '0.8', // a little headroom: the default clips busy arrangements
    soundfont,
    midi
  ]
}

/** A stable name for the rendered copy: same file, same result. */
export function renderName(path: string, mtimeMs: number, size: number): string {
  return createHash('sha256').update(`midi|${path.toLowerCase()}|${mtimeMs}|${size}`).digest('hex').slice(0, 32) + '.wav'
}

const jobs = new Map<string, Promise<string>>()

/**
 * Render a MIDI file to WAV, or hand back the one rendered last time. Two
 * callers asking for the same file share one render.
 */
export async function renderMidi(fluid: Fluid, path: string, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const st = await stat(path)
  const out = join(dir, renderName(path, st.mtimeMs, st.size))
  const have = await stat(out).catch(() => null)
  if (have && have.size > 0) return out
  // Nothing is awaited from here to `jobs.set`, so two callers share one render.
  const running = jobs.get(out)
  if (running) return running

  const job = new Promise<string>((resolve, reject) => {
    execFile(
      fluid.exe,
      midiArgs(fluid.soundfont, path, out),
      { timeout: 120000, windowsHide: true, maxBuffer: 4 << 20 },
      (err) => {
        jobs.delete(out)
        const fail = (): void => reject(new Error('could not synthesise this MIDI file'))
        if (err) return fail()
        stat(out).then((made) => (made.size > 0 ? resolve(out) : fail()), fail)
      }
    )
  })
  jobs.set(out, job)
  return job
}
