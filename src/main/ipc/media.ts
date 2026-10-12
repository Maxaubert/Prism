import { ipcMain } from 'electron'
import { CALL, PUSH } from '@shared/channels'
import type { ConvertResult } from '@shared/ipcTypes'
import { basename, dirname, extname } from 'path'
import { extendDesktopDirectories, insideDesktop } from '../desktopAccess'
import { userPaths } from '../paths'
import { AUDIO_SCHEME } from '../audioSidecar'
import { FIRST_AUDIO, needsSidecar, probeMedia } from '../ffmpeg'
import { cancelConversion, convertVideo, planConversion } from '../videoConvert'
import { cachedPeaks, loadPeaks } from '../peaks'
import { isMidi, renderMidi } from '../midi'
import { readAsVtt, sidecarsFor, type SubTrack } from '../subtitles'
import type { MediaProbe } from '@shared/types'
import { exists } from '../fsUtil'
import { MEDIA_SCHEME } from '../mediaProtocol'
import { ffmpegTools, fluidTools } from '../bundledTools'
import { openDialog } from '../dialogs'
import type { MainCtx, ReadyCtx } from './context'

/** Subtitles, the audio sidecar, peaks and probes, MIDI, video conversion, documents. */
export function registerMediaIpc(ctx: MainCtx, ready: ReadyCtx): void {
  const { pickedSubs, readable, wall } = ctx
  const { docHtmlOf, probeCached } = ready
  /* ----- subtitles ----- */

  // Sidecar tracks for a video (same name, same folder or Subs/), and their
  // text as WebVTT. Same wall as everything else: inside the root only.
  ipcMain.handle(CALL.subsFor, async (_e, p: string): Promise<SubTrack[]> => {
    if (!insideDesktop(p)) return []
    const tracks = await sidecarsFor(p)
    extendDesktopDirectories(
      dirname(p),
      tracks.map((track) => dirname(track.path))
    )
    return tracks
  })
  /**
   * A subtitle file the user points at (2026-08-27), for the tracks the
   * name-matching cannot find: a differently named .srt, or one kept
   * somewhere else entirely.
   *
   * The dialog IS the consent, which is why the answer is remembered as
   * readable - it can sit outside every root, and the root wall would
   * otherwise refuse the file the user just chose.
   */
  ipcMain.handle(CALL.subsPick, async (_e, near?: string): Promise<SubTrack | null> => {
    const r = await openDialog({
      properties: ['openFile'],
      ...(typeof near === 'string' && (await exists(dirname(near)))
        ? { defaultPath: dirname(near) }
        : {}),
      filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa'] }]
    })
    if (r.canceled || !r.filePaths.length) return null
    const p = r.filePaths[0]
    pickedSubs.add(p)
    return { path: p, label: basename(p) }
  })
  ipcMain.handle(CALL.subsRead, async (_e, p: string): Promise<string | null> =>
    insideDesktop(p) || pickedSubs.has(p) ? readAsVtt(p, ffmpegTools()?.ffmpeg) : null
  )

  /* ----- audio Chromium cannot decode ----- */

  const sidecarUrl = (p: string, stream: number, duration: number): string =>
    `${AUDIO_SCHEME}://track/${encodeURIComponent(p)}?s=${stream}&d=${duration}`

  // Ask before playing: what does this file hold, does its audio need Prism's
  // own decoder, and is there one? The renderer plays the answer's url beside
  // the video (which stays silent by itself, having no decoder for the track
  // either), or IN PLACE of the file for an audio-only viewer.
  /**
   * The waveform transport's envelope. Computed by ffmpeg here and streamed,
   * because the renderer's old way - fetch the file, decodeAudioData the lot
   * - took 7.4GB on a 2GB film and threw at the end of it.
   */
  ipcMain.handle(CALL.mediaPeaks, async (_e, p: string): Promise<number[] | null> => {
    if (!readable(p)) return null
    // Known already: no ffprobe, no ffmpeg, no wait.
    const known = await cachedPeaks(p)
    if (known) return known
    const tools = ffmpegTools()
    if (!tools) return null
    if (!tools.ffprobe) return null
    const info = await probeMedia(tools.ffprobe, p)
    if (!info?.audio || !info.duration) return null
    return loadPeaks(tools.ffmpeg, p, info.duration)
  })
  ipcMain.handle(CALL.mediaProbe, async (_e, p: string): Promise<MediaProbe> => {
    const none: MediaProbe = { ffmpeg: false, needed: false }
    if (!readable(p)) return none
    // A MIDI file is a score, not a recording: it has to be synthesised
    // before there is anything to play. The answer comes back at once so the
    // player can say so, and the rendering is asked for separately - loading
    // a 23MB soundfont takes a moment, and an <audio> pointed at the .mid
    // meanwhile would flash "can't be played".
    if (isMidi(p)) {
      const fluid = await fluidTools()
      return { ffmpeg: !!fluid, needed: true, synth: true, codec: 'midi' }
    }
    if (!ffmpegTools()) return none
    const info = await probeCached(p)
    // No ffprobe, or a container it could not read: the renderer still has a
    // second way in (its decoder byte counter), so offer the first track
    // blind rather than nothing.
    if (!info) return { ffmpeg: true, needed: false, blind: true }
    const plan = planConversion(info, extname(p))
    // A converted copy carries its own sound, so the sidecar stands down.
    const needed = !plan.needed && needsSidecar(info.audio?.codec, extname(p))
    const base: MediaProbe = {
      ffmpeg: true,
      needed,
      videoCodec: info.videoCodec ?? undefined,
      fps: info.fps ?? undefined,
      convert: plan.needed ? { reason: plan.reason ?? 'codec', quick: plan.copyVideo } : undefined
    }
    // More than one track: offer them all, each with the url that plays it.
    // One track needs no picker, and a picker with one row is chrome.
    const tracks =
      info.duration > 0 && info.tracks.length > 1
        ? info.tracks.map((t) => ({
            index: t.index,
            codec: t.codec,
            channels: t.channels,
            language: t.language,
            title: t.title,
            url: sidecarUrl(p, t.index, info.duration)
          }))
        : undefined
    if (!info.audio || info.duration <= 0) return { ...base, blind: true, tracks }
    return {
      ...base,
      codec: info.audio.codec,
      channels: info.audio.channels,
      layout: info.audio.layout,
      url: sidecarUrl(p, info.audio.index, info.duration),
      tracks
    }
  })

  // Render a score. Separate from the probe because it can take seconds:
  // the player shows that it is working rather than an error.
  ipcMain.handle(CALL.audioSynth, async (_e, p: string): Promise<string | null> => {
    if (!readable(p)) return null
    const fluid = await fluidTools()
    if (!fluid || !isMidi(p)) return null
    try {
      const wav = await renderMidi(fluid, p, userPaths.converted())
      wall.grantExtracted(wav)
      wall.grantServable(wav)
      return `${MEDIA_SCHEME}://local/${encodeURIComponent(wav)}`
    } catch {
      return null
    }
  })

  // The blind route: the renderer watched its own decoder produce no audio
  // and knows the duration the element reported, so it can ask for the first
  // audio track without anything having probed the file.
  ipcMain.handle(CALL.audioBlind, (_e, p: string, duration: number): string | null => {
    if (!readable(p)) return null
    if (!Number.isFinite(duration) || duration <= 0) return null
    if (!ffmpegTools()) return null
    return sidecarUrl(p, FIRST_AUDIO, duration)
  })

  // Video Chromium cannot show: convert it once, then play the copy. The
  // renderer waits on this and shows progress; a file already converted
  // comes back immediately.
  const convertDir = userPaths.converted
  /** Source file -> the copy being written for it and how many viewers are
   *  waiting. Two tabs can hold the same film (each tab keeps its own live
   *  player), and they share ONE conversion: the first to walk away must not
   *  cancel it out from under the other (2026-08-28). */
  const converting = new Map<string, { out: string; viewers: number }>()
  ipcMain.handle(
    CALL.videoConvert,
    async (e, p: string): Promise<ConvertResult> => {
      if (!readable(p)) return { error: 'outside the folder' }
      const tools = ffmpegTools()
      if (!tools?.ffprobe) return { error: 'no decoder available' }
      const info = await probeMedia(tools.ffprobe, p)
      const plan = planConversion(info, extname(p))
      if (!plan.needed) return { error: 'nothing to convert' }
      try {
        const handle = await convertVideo(
          tools.ffmpeg,
          p,
          convertDir(),
          plan,
          info?.duration ?? 0,
          (pct) => e.sender.send(PUSH.videoProgress, { path: p, pct })
        )
        // The renderer knows the FILE it asked about, never the copy's name,
        // so cancelling has to be answerable from the source (2026-08-28).
        const seen = converting.get(p)
        converting.set(p, { out: handle.out, viewers: (seen?.viewers ?? 0) + 1 })
        const out = await handle.done
        converting.delete(p)
        wall.grantExtracted(out) // the copy is ours to serve, wherever it sits
        wall.grantServable(out)
        return { url: `${MEDIA_SCHEME}://local/${encodeURIComponent(out)}` }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'conversion failed' }
      }
    }
  )
  // Nobody is waiting for this any more: the viewer moved on to another
  // file while a whole film was being re-encoded behind it (2026-08-28).
  ipcMain.on(CALL.videoCancel, (_e, source: string) => {
    if (typeof source !== 'string') return
    const job = converting.get(source)
    if (!job) return
    job.viewers -= 1
    if (job.viewers > 0) return // somebody else is still waiting for it
    converting.delete(source)
    cancelConversion(job.out)
  })

  // Office and ebook documents: converted to HTML in main, sanitised there
  // too, so nobody else's markup reaches a renderer that can see window.prism.
  ipcMain.handle(CALL.docHtml, async (_e, p: string): Promise<string | null> => {
    if (!readable(p)) return null
    return docHtmlOf(p)
  })
}
