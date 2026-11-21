import { E2E } from '../appState'
import type { ffmpegTools } from '../bundledTools'
import { heicToJpeg } from '../heicClient'
import { holders } from '../holders'
import { thumbWantCount } from '../ipc/thumbs'
import { rawPreview } from '../rawPreview'
import { Thumbs } from '../thumbs'
import { userPaths } from '../paths'

/** The thumbnails group of whenReady (audit #7 step 2), moved whole. */
export function wireThumbs(hlsTools: ReturnType<typeof ffmpegTools>): Thumbs | null {
  // The phone grid's pictures (#135), made once and cached under userData.
  // Its ffmpegs register with the holders (#133), so a move of the file wins.
  const thumbs = hlsTools
    ? new Thumbs(hlsTools.ffmpeg, userPaths.thumbs(), (c, f) => holders.add(c, f), {
        // The desktop's tiles (zoom grid): a HEIC ffmpeg cannot join and a
        // camera raw's embedded JPEG come from the viewer's own decoders.
        heic: heicToJpeg,
        raw: rawPreview
      })
    : null
  // Half-written thumbnails of a run that died, off the startup path.
  void thumbs?.sweepParts()
  // The e2e reads how many thumbnail ffmpegs ran and the most at once.
  if (E2E && thumbs)
    Object.assign(globalThis, {
      __e2eThumbs: () => ({ ...thumbs.stats(), wants: thumbWantCount() })
    })
  return thumbs
}
