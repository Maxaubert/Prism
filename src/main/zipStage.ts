import { mkdir, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'

/**
 * ZIP A TO ZIP B STAGES HERE (#70 D9; owner approved the spec "as
 * recommended", 2026-11-01; review fix the same day). The members of one zip
 * go out to a staging folder, through the extraction window (progress and
 * Cancel at any size), and are added to the other zip from it. The folder is
 * made inside the RUN'S MEMBER FOLDER (memberTemp.ts), so the reads' grant
 * already covers it and quit, or the next start, removes whatever a crash
 * left; the page drops it as soon as the add is over. The old route left a
 * `prism-arcdir-*` folder in temp per folder member, for good.
 *
 * Only a folder this made can be dropped: the page names it, so the page
 * must not be able to name anything else.
 */
export class ZipStage {
  private readonly made = new Set<string>()

  constructor(private readonly runDir: string) {}

  async make(): Promise<string> {
    await mkdir(this.runDir, { recursive: true })
    const dir = await mkdtemp(join(this.runDir, 'zipcopy-'))
    this.made.add(dir)
    return dir
  }

  async drop(dir: unknown): Promise<boolean> {
    if (typeof dir !== 'string' || !this.made.has(dir)) return false
    this.made.delete(dir)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    return true
  }
}
