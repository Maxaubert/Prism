import { afterEach, beforeEach, expect, it } from 'vitest'
import { NULL_DIAG_LOG, setDiagMain } from 'prism-term-core/main/diagLog'
import { mainCrumb } from './diagCrumb'

const lines: Array<{ src: string; k: string; fields?: Record<string, unknown> }> = []
let verbose = false
beforeEach(() => {
  lines.length = 0
  verbose = false
  setDiagMain({
    ...NULL_DIAG_LOG,
    verbose: () => verbose,
    write: (src, k, fields) => void lines.push({ src, k, fields })
  })
})
afterEach(() => setDiagMain(null))

it('writes a main crumb, its action named a', () => {
  mainCrumb('archive-job', { phase: 'start', a: 'not this' })
  expect(lines).toEqual([{ src: 'main', k: 'crumb', fields: { phase: 'start', a: 'archive-job' } }])
})

it('keeps an often crumb for Detailed logging', () => {
  mainCrumb('watch', { ms: 3 }, { often: true })
  expect(lines).toEqual([])
  verbose = true
  mainCrumb('watch', { ms: 3 }, { often: true })
  expect(lines.map((l) => l.fields?.a)).toEqual(['watch'])
})

it('writes nothing before the log is started', () => {
  setDiagMain(null)
  expect(() => mainCrumb('watch')).not.toThrow()
  expect(lines).toEqual([])
})
