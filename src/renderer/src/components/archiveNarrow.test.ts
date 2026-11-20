import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, 'ArchiveView.tsx'), 'utf8')

describe('the archive panel on a 375px phone (audit #90)', () => {
  it('the archive name is capped by its column, not only by 36rem, so `truncate` works', () => {
    expect(src).toContain('max-w-[min(100%,36rem)] truncate')
    expect(src).not.toContain('max-w-[36rem] truncate')
  })
  it('the crumb names can shrink and truncate instead of running off the right edge', () => {
    const row = /data-archive-crumbs[\s\S]*?<\/div>\s*\n\s*\{?\/?/.exec(src)?.[0] ?? ''
    expect(row).toContain('flex h-6 min-w-0 items-center')
    expect(row.match(/min-w-0 truncate rounded px-1 py-0\.5/g)?.length).toBeGreaterThanOrEqual(3)
  })
})