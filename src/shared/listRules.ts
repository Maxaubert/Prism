/**
 * What a folder listing leaves out, wherever the listing comes from: the
 * shell's own junk, the recycle bin, the volume metadata. Shared between the
 * directory walk (`main/dirList`) and the Everything bridge
 * (`main/everything`), so the two can never disagree about what a result is.
 */
const SKIP = new Set(['desktop.ini', 'thumbs.db', '$recycle.bin', 'system volume information'])

export const isSkipped = (name: string): boolean => SKIP.has(name.toLowerCase())
