import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const ROOT = resolve(__dirname, '../..')

test('the real fullscreen fade preserves GPU compositing and video playback', async () => {
  test.skip(process.platform !== 'win32', 'Windows native window regression')
  const folder = join(ROOT, '.e2e', `native-fullscreen-test-${randomUUID()}`)
  const profile = join(folder, 'profile')
  mkdirSync(profile, { recursive: true })
  const video = join(folder, 'motion.mp4')
  execFileSync(join(ROOT, 'vendor/ffmpeg/ffmpeg.exe'), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=640x360:rate=24', '-t', '15', '-c:v', 'libopenh264',
    '-pix_fmt', 'yuv420p', '-an', video
  ], { windowsHide: true })
  writeFileSync(join(profile, 'tabs.json'), JSON.stringify({ active: 0, tabs: [{
    id: 'native-fullscreen', role: 'explorer', pinned: true, root: folder,
    file: video, open: [folder], panes: [],
    browse: { path: folder, history: [{ path: folder, selected: video, scrollTop: 0,
      query: '', sort: { key: 'name', direction: 'asc' } }], cursor: 0,
      surface: 'viewer', preview: true }
  }] }))
  const app = await electron.launch({
    args: [join(ROOT, 'tools/e2e/fullscreen.bootstrap.mjs'),
      `--user-data-dir=${profile}`, '--preview'],
    env: { ...process.env }
  })
  const child = app.process()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => localStorage.setItem('prism.onboarded', '1'))
    await page.reload()
    const media = page.locator('video').first()
    await expect(media).toBeVisible()
    await expect.poll(() => media.evaluate((v: HTMLVideoElement) => v.readyState)).toBe(4)
    const beforeGpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus().gpu_compositing)
    test.skip(beforeGpu !== 'enabled', 'Requires an accelerated Windows GPU to detect fallback')
    await media.evaluate(async (v: HTMLVideoElement) => { v.muted = true; v.loop = true; await v.play() })
    for (const phase of ['enter', 'exit', 'enter-again', 'exit-again']) {
      const beforeFrames = await media.evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames)
      await page.keyboard.press('F11')
      await expect.poll(async () => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().filter((w) => !w.webContents.getURL()).length
      )).toBe(1)
      await expect.poll(async () => app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL())?.isVisible()
      )).toBe(true)
      await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
        const shroud = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL())
        return shroud && !shroud.isVisible()
      })).toBe(true)
      const state = await app.evaluate(({ app, BrowserWindow }) => ({
        gpu: app.getGPUFeatureStatus().gpu_compositing,
        mainResizable: BrowserWindow.getAllWindows().find((w) => w.webContents.getURL())?.isResizable(),
        windows: BrowserWindow.getAllWindows().map((w) => ({
          bounds: w.getBounds(), focusable: w.isFocusable()
        }))
      }))
      console.log(phase, JSON.stringify(state))
      expect(state.gpu, `${phase}: native fade must not disable the GPU`).toBe('enabled')
      expect(state.mainResizable).toBe(phase.startsWith('exit'))
      await expect(page.locator('.browse-viewer-toolbar')).toHaveCount(phase.startsWith('exit') ? 1 : 0)
      expect(state.windows.every((w) => w.bounds.x < -5000 && !w.focusable)).toBe(true)
      await expect.poll(() => media.evaluate((v: HTMLVideoElement) =>
        v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(beforeFrames + 3)
      expect(await media.evaluate((v: HTMLVideoElement) => v.error)).toBeNull()
    }
  } finally {
    await app.evaluate(async () => {
      await (globalThis as unknown as { __prismIndexer?: { dispose(): Promise<void> } }).__prismIndexer?.dispose()
    }).catch(() => {})
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    if (child.exitCode === null) await Promise.race([
      new Promise<void>((done) => child.once('exit', () => done())),
      new Promise<void>((done) => setTimeout(done, 3000))
    ])
    if (child.exitCode === null && child.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, stdio: 'ignore'
        })
      } catch {
        /* Only this diagnostic's child tree is eligible, and it may have exited. */
      }
    }
    for (const stream of child.stdio) stream?.destroy()
  }
})
