import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { useMediaLook, type MediaLook } from '../lib/viz/mediaLook'
import { prismMediaLook } from '../lib/viz/prismMediaLook'
import { vizState, WIDTHS } from '../lib/viz/vizStore'
import { resolveVizTheme } from '../lib/theme'

/**
 * The players take their look from the host (#29, 2026-11-01).
 *
 * AudioView and VideoView are bound for the shared `prism-core` that Filesmith
 * will bundle too. Reaching into Prism's viz store and app theme directly would
 * drag Prism's whole Settings, preset and theme system along with them, so the
 * views read a narrow context (lib/viz/mediaLook) and Prism installs its stores
 * behind it (PrismMediaLook). Nothing a viewer sees changes: the same settings,
 * the same defaults, the same persistence.
 */

const RENDERER = resolve(__dirname, '..')
const BANNED = ['lib/viz/vizStore.ts', 'lib/theme.ts'].map((f) => resolve(RENDERER, f))

// Every module specifier in a file: `import ... from`, `export ... from`, a bare
// `import '...'` and a dynamic `import('...')`, in any quote style.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"`])([^'"`]+)\1/g

/** A renderer-local specifier to its file, or null for a package import. */
function resolveLocal(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else if (spec.startsWith('@renderer/')) base = resolve(RENDERER, spec.slice('@renderer/'.length))
  else return null
  for (const c of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx')
  ]) {
    if (/\.tsx?$/.test(c) && existsSync(c)) return c
  }
  throw new Error(`${spec} in ${from} resolves to no file`)
}

/** Each module the file reaches, mapped to the chain that reached it. */
function closure(entry: string): Map<string, string[]> {
  const reached = new Map<string, string[]>([[entry, [entry]]])
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift() as string
    for (const m of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const next = resolveLocal(file, m[2])
      if (!next || reached.has(next)) continue
      reached.set(next, [...(reached.get(file) as string[]), next])
      queue.push(next)
    }
  }
  return reached
}

describe('the players never reach into Prism settings stores (#29)', () => {
  for (const file of ['AudioView.tsx', 'VideoView.tsx']) {
    const entry = resolve(__dirname, file)

    it(`${file} reads its look from the host`, () => {
      expect(readFileSync(entry, 'utf8')).toMatch(/useMediaLook\(\)/)
    })

    it(`nothing ${file} imports, however deep or however spelled, is the viz store or the app theme`, () => {
      const reached = closure(entry)
      // The walk really follows children: the visualizer and the transport are in it.
      expect(
        reached.has(resolve(__dirname, 'Visualizer.tsx')) ||
          reached.has(resolve(__dirname, 'Transport.tsx'))
      ).toBe(true)
      const hits = BANNED.filter((b) => reached.has(b)).map((b) =>
        (reached.get(b) as string[]).map((f) => relative(RENDERER, f)).join(' -> ')
      )
      expect(hits).toEqual([])
    })
  }

  it('the walk catches every spelling of an import', () => {
    const spellings = [
      `import { useViz } from '../lib/viz/vizStore'`,
      `import { useViz } from "@renderer/lib/viz/vizStore"`,
      `export { useViz } from '../lib/viz/vizStore'`,
      `import '../lib/theme'`,
      'const t = await import(`../lib/theme`)'
    ]
    for (const line of spellings) {
      const [m] = [...line.matchAll(SPECIFIER)]
      expect(m, line).toBeDefined()
      expect(BANNED, line).toContain(resolveLocal(resolve(__dirname, 'AudioView.tsx'), m[2]))
    }
  })
})

describe("Prism's provider hands the views exactly what the stores hold", () => {
  const capture = (): MediaLook => prismMediaLook(vizState())

  it('the viz settings are the store settings', () => {
    const look = capture()
    const s = vizState()
    for (const k of Object.keys(look.viz) as Array<keyof MediaLook['viz']>) {
      expect(look.viz[k]).toBe(s[k])
    }
  })

  it('themes resolve through the app theme, accent included', () => {
    const look = capture()
    expect(look.resolveTheme).toBe(resolveVizTheme)
  })

  it('a width names the same class, an unknown one falls back to full', () => {
    const look = capture()
    for (const w of Object.keys(WIDTHS)) expect(look.widthClass(w)).toBe(WIDTHS[w])
    expect(look.widthClass('nonsense')).toBe(WIDTHS.full)
  })

  it('a view with no host says so instead of guessing a look', () => {
    const Probe = (): null => {
      useMediaLook()
      return null
    }
    expect(() => renderToString(createElement(Probe))).toThrow(/MediaLook/)
  })
})
