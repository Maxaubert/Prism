import { spawnSync } from 'node:child_process'

/**
 * A clip's length in seconds, by ffprobe. When ffprobe cannot start (not
 * installed, not on PATH) say so: spawnSync then answers with no stdout, and
 * reading it threw a bare TypeError before the film script could name the
 * missing tool (audit #97). `run` is the spawn, swapped in by the test.
 */
export function durationOf(file, run = spawnSync) {
  const result = run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }
  )
  if (result.error || result.stdout == null) {
    throw new Error(
      `ffprobe is needed to measure ${file} and could not run (${result.error?.message ?? 'no output'}). ` +
        'Install ffmpeg (it ships ffprobe) and put it on PATH.'
    )
  }
  return Number(String(result.stdout).trim() || 0)
}
