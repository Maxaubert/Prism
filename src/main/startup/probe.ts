import { probeMedia, type MediaInfo } from '../ffmpeg'
import { createProbeCache } from '../probeCache'
import { ffmpegTools } from '../bundledTools'
import * as userFsp from '../userFs'

/** The media probe group of whenReady (audit #7 step 2), moved whole. */
export function createProbeCached(): (p: string) => Promise<MediaInfo | null> {
  // One probe per file, kept for as long as the file has not changed: the
  // audio player, the video player, the no-picture note and the phone's
  // /api/play all ask. Null is "ffprobe could not read it" AND "there is
  // no ffprobe": the callers that tell those apart ask findFfmpeg first.
  // The in-flight probe is shared too (review, 2026-10-16): see probeCache.ts.
  const probeShared = createProbeCache(
    (p) => {
      const ffprobe = ffmpegTools()?.ffprobe
      return ffprobe ? probeMedia(ffprobe, p) : Promise.resolve(null)
    },
    async (p) => (await userFsp.stat(p)).mtimeMs
  )
  const probeCached = async (p: string): Promise<MediaInfo | null> =>
    ffmpegTools()?.ffprobe ? probeShared(p) : null
  return probeCached
}
