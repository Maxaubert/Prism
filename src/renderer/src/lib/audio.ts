// One shared Web Audio context for the window, plus a helper to pull a downsampled
// amplitude envelope (peaks) from a media file for the waveform transport styles.

let ctx: AudioContext | null = null
export function getAudioContext(): AudioContext {
  ctx ??= new AudioContext()
  return ctx
}

// loadPeaks lived here and pulled the WHOLE file into the page to decode it -
// 7.4GB of renderer memory on a 2GB film, for 160 numbers. The envelope now
// comes from ffmpeg in main, streamed: see src/main/peaks.ts and useWaveform.
