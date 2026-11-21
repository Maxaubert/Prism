// Worker side of dropsOffMain.ts (audit #61): scans a mono, low-rate track for drops.
import { analyzeDrops } from './drops'

interface Job {
  samples: Float32Array
  sampleRate: number
  target: number
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Job>) => void) | null
  postMessage(message: number[]): void
}

scope.onmessage = (e): void => {
  const { samples, sampleRate, target } = e.data
  const times = analyzeDrops(
    { sampleRate, length: samples.length, numberOfChannels: 1, getChannelData: () => samples },
    target
  )
  scope.postMessage(times)
}
