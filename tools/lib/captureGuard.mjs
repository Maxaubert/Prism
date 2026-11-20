/**
 * A locator's box, or an error that says WHAT is missing. The showcase drives
 * the real window by label and role; a control the app no longer has (the file
 * tree and the Terminal button went on 2026-10-26) made `boundingBox()` answer
 * null and the next line dereference it (audit #96). `locator` is a Playwright
 * locator, swapped for a fake in the test.
 */
export async function needBox(locator, what) {
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error(
      `The showcase cannot find ${what} in the app. If that control was removed, ` +
        'update the beat in tools/showcase/showcase.mjs.'
    )
  }
  return box
}

/** Stop the recording and the app, whatever state the take was in. Never throws. */
export async function stopTake(take) {
  try {
    take.ff?.stdin?.write('q')
  } catch {
    /* ffmpeg already gone */
  }
  try {
    take.ff?.kill?.()
  } catch {
    /* ffmpeg already gone */
  }
  try {
    await take.app?.close()
  } catch {
    /* the app already closed */
  }
}
