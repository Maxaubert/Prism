import { rm } from 'fs/promises'
import type { ffmpegTools } from '../bundledTools'
import { holders } from '../holders'
import type { MainCtx } from '../ipc/context'
import { createLiveVideo, type LiveVideo } from '../liveVideo'
import { writeOp } from '../opLog'
import { userPaths } from '../paths'

/** The desktop's live transcode group of whenReady (audit #7 step 2), moved whole. */
export function wireLiveVideo(
  hlsTools: ReturnType<typeof ffmpegTools>,
  readable: MainCtx['readable']
): LiveVideo | null {
  // The desktop's live transcode (2026-11-08): the phone's jobs, its own
  // folder, wiped before the first job may use it.
  const LIVE_DIR = userPaths.live()
  const liveWiped = rm(LIVE_DIR, { recursive: true, force: true }).catch(() => undefined)
  return hlsTools
    ? createLiveVideo({
        ffmpeg: hlsTools.ffmpeg,
        baseDir: LIVE_DIR,
        readable,
        hold: (c, f) => holders.add(c, f),
        ready: liveWiped,
        op: writeOp
      })
    : null
}
