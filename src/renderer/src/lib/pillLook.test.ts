import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARET_ABOVE, CARET_ABOVE_WIDE, CENTRED_PILL } from './pillLook'

// The centred pills of the viewers (audit #81, #82). A layout bug no unit test can see, so these hold the classes.
const src = (...p: string[]): string => readFileSync(join(__dirname, '..', 'components', ...p), 'utf8')

describe('a centred pill takes its own width', () => {
  it('names w-max and a cap inside the viewer', () => {
    expect(CENTRED_PILL).toContain('w-max')
    expect(CENTRED_PILL).toContain('max-w-[calc(100%-16px)]')
  })
  it('every left-1/2 -translate-x-1/2 pill of the viewers has one', () => {
    for (const f of [['ImageView.tsx'], ['pdf', 'PdfView.tsx'], ['VideoView.tsx'], ['CodeView.tsx']]) {
      const lines = src(...f).split('\n').filter((l) => /absolute[^"`]*left-1\/2[^"`]*-translate-x-1\/2/.test(l))
      expect(lines.length, f.join('/')).toBeGreaterThan(0)
      for (const l of lines) expect(l, f.join('/')).toMatch(/\$\{CENTRED_PILL\}|\bw-max\b/)
    }
  })
})

describe('the code editor caret pill and the Save pill (audit #82)', () => {
  it('the caret pill rises above the Save pill in a narrow viewer', () => {
    expect(CARET_ABOVE).toBe('@max-[480px]:bottom-14')
    expect(CARET_ABOVE_WIDE).toBe('@max-[800px]:bottom-14')
    const s = src('CodeView.tsx')
    expect(s).toContain('CARET_ABOVE')
    expect(s).toMatch(/absolute inset-x-0 bottom-0 z-10 h-0 @container/)
  })
})