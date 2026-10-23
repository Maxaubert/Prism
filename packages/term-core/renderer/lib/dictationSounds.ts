/**
 * The two cues (#13, owner: "plus a microphone sound effect"): a rising pair
 * of notes when the mic opens, a falling pair when it closes. SYNTHESISED, so
 * there is no asset to bundle, fetch or license, and the same code sounds the
 * same in both apps. Short and quiet on purpose: it plays into the room the
 * user is about to speak in. It does NOT hold the recording back: the mic opens
 * at the same moment, because a cue that delays capture clips the first word of
 * anyone who starts talking as they press. The capture asks for echo
 * cancellation, which takes this page's own output out of the recording.
 */
let ctx: AudioContext | null = null

function context(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function note(ac: AudioContext, freq: number, at: number, len: number): void {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // A few ms of attack and an exponential tail: a bare sine switched on and
  // off clicks, and the click is louder than the note.
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.12, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len)
  osc.connect(gain).connect(ac.destination)
  osc.start(at)
  osc.stop(at + len + 0.02)
}

function cue(freqs: [number, number]): Promise<void> {
  const ac = context()
  if (!ac) return Promise.resolve()
  const t = ac.currentTime + 0.005
  note(ac, freqs[0], t, 0.09)
  note(ac, freqs[1], t + 0.07, 0.11)
  return new Promise((r) => setTimeout(r, 190))
}

/** The mic is opening. Resolves when the cue has finished sounding. */
export const startCue = (): Promise<void> => cue([587.33, 880])
/** The mic has closed. */
export const stopCue = (): Promise<void> => cue([880, 587.33])
/** Cancelled: one low note, so it does not read as "got it". */
export function cancelCue(): void {
  const ac = context()
  if (ac) note(ac, 392, ac.currentTime + 0.005, 0.12)
}
