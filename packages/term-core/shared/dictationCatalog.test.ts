import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CATALOG,
  ENGINE,
  LANGUAGES,
  LIMITED_LANGUAGES_TEXT,
  catalogEntry,
  engineFor,
  languageFor,
  limitedLanguages,
  recommendedModel,
  visibleModels
} from './dictationCatalog'

const HEX64 = /^[0-9a-f]{64}$/

describe('CATALOG', () => {
  it('gives every entry an https url, an exact size and a lowercase 64-hex checksum', () => {
    for (const e of CATALOG) {
      expect(e.url, e.id).toMatch(/^https:\/\//)
      expect(Number.isInteger(e.bytes) && e.bytes > 0, e.id).toBe(true)
      expect(e.sha256, e.id).toMatch(HEX64)
      expect(e.label.length, e.id).toBeGreaterThan(0)
      // One short line: the model manager has a row, not a paragraph.
      expect(e.note.length, e.id).toBeGreaterThan(0)
      expect(e.note.length, e.id).toBeLessThanOrEqual(80)
      expect(e.note, e.id).not.toMatch(/\n/)
    }
  })

  it('has unique ids, and no two entries share a url or a checksum', () => {
    for (const key of ['id', 'url', 'sha256'] as const) {
      const seen = CATALOG.map((e) => e[key])
      expect(new Set(seen).size, key).toBe(seen.length)
    }
  })

  it('holds the seven models and the one GPU pack the design names', () => {
    expect(CATALOG.map((e) => e.id).sort()).toEqual(
      ['base', 'gpu-pack', 'large-v3', 'large-v3-turbo', 'parakeet-v3', 'parakeet-v3-q4', 'small', 'tiny'].sort()
    )
    expect(CATALOG.filter((e) => e.kind === 'gpu-pack').map((e) => e.id)).toEqual(['gpu-pack'])
    const label = (id: string): string | undefined => catalogEntry(id)?.label
    expect(label('tiny')).toBe('Whisper Tiny')
    expect(label('base')).toBe('Whisper Base')
    expect(label('small')).toBe('Whisper Small')
    expect(label('large-v3-turbo')).toBe('Whisper Large v3 Turbo')
    expect(label('large-v3')).toBe('Whisper Large v3')
    expect(label('parakeet-v3')).toBe('Parakeet v3')
  })

  it('pins every Whisper model to a COMMIT of the Hugging Face repo, never to main', () => {
    const models = CATALOG.filter((e) => e.kind === 'model' && engineFor(e.id) === 'whisper')
    expect(models.length).toBe(5)
    for (const e of models) {
      expect(e.url, e.id).not.toContain('/resolve/main/')
      expect(e.url, e.id).toMatch(
        /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/[0-9a-f]{40}\/ggml-[a-z0-9.-]+\.bin$/
      )
      expect(e.url.endsWith(`/ggml-${e.id}.bin`), e.id).toBe(true)
    }
  })

  it('pins Parakeet v3 to a COMMIT of ggml-org/parakeet-GGUF, the files read from its API', () => {
    const commit = 'https://huggingface.co/ggml-org/parakeet-GGUF/resolve/35156454d1a39de06863303dd209fd2bed6ee079/'
    const app = catalogEntry('parakeet-v3')
    expect(app?.url).toBe(commit + 'ggml-parakeet-tdt-0.6b-v3-q8_0.bin')
    expect(app?.bytes).toBe(668757119)
    expect(app?.sha256).toBe('4d64e9e96c2792186d072fde0034df0ad670cf680a2f53069052ead827fd600e')
    // The e2e's copy is the smallest official file of the same commit.
    const e2e = catalogEntry('parakeet-v3-q4')
    expect(e2e?.url).toBe(commit + 'ggml-parakeet-tdt-0.6b-v3-q4_0.bin')
    expect(e2e?.bytes).toBe(355615679)
    expect(e2e?.sha256).toBe('aa7fe2f5fb47d863ca23e8b1d490632d63a2599f515268b6d6bd656158dad45e')
    for (const e of [app, e2e]) {
      expect(e?.kind).toBe('model')
      expect(e?.engine).toBe('parakeet')
      expect(e?.limitedLanguages).toBe(true)
      // Fast on a CPU (MEASURED under a second a pass): never marked as needing the pack.
      expect(e?.needsGpu).toBeUndefined()
    }
    expect(e2e?.e2eOnly).toBe(true)
    expect(app?.e2eOnly).toBeUndefined()
  })

  it('flags limited languages on the Parakeet files only, and runs them with parakeet-cli', () => {
    expect(CATALOG.filter((e) => e.limitedLanguages).map((e) => e.id).sort()).toEqual(['parakeet-v3', 'parakeet-v3-q4'])
    expect(CATALOG.filter((e) => e.engine === 'parakeet').map((e) => e.id).sort()).toEqual(['parakeet-v3', 'parakeet-v3-q4'])
    for (const e of CATALOG) expect(engineFor(e.id), e.id).toBe(e.engine === 'parakeet' ? 'parakeet' : 'whisper')
    // An id nobody knows is Whisper's, the engine that was there first.
    expect(engineFor('nope')).toBe('whisper')
  })

  it('takes the GPU pack from the same pinned release as the engine', () => {
    const pack = catalogEntry('gpu-pack')
    expect(pack?.url).toBe(
      `https://github.com/ggml-org/whisper.cpp/releases/download/${ENGINE.tag}/whisper-cublas-12.4.0-bin-x64.zip`
    )
    expect(pack?.sha256).toBe('af520ddd034d985b55dfeea3e465ed93653ba2aee1a55e865033edc548c272a7')
    // The pack is not a model: it must never be offered as one, or recommended.
    expect(pack?.recommended).toBeUndefined()
    expect(pack?.needsGpu).toBeUndefined()
  })

  it('flags the models a CPU cannot keep up with, and only those', () => {
    const needs = CATALOG.filter((e) => e.needsGpu)
      .map((e) => e.id)
      .sort()
    expect(needs).toEqual(['large-v3', 'large-v3-turbo'])
  })
})

describe('visibleModels', () => {
  it('is the model manager list: models only, the e2e one left out, smallest first', () => {
    const ids = visibleModels().map((e) => e.id)
    expect(ids).toEqual(['base', 'small', 'parakeet-v3', 'large-v3-turbo', 'large-v3'])
    for (let i = 1; i < visibleModels().length; i += 1)
      expect(visibleModels()[i].bytes, ids[i]).toBeGreaterThan(visibleModels()[i - 1].bytes)
    expect(catalogEntry('tiny')?.e2eOnly).toBe(true)
    expect(ids).not.toContain('tiny')
    expect(ids).not.toContain('parakeet-v3-q4')
    expect(ids).not.toContain('gpu-pack')
  })

  it('marks exactly one pick for a CPU and one for the GPU pack', () => {
    const cpu = visibleModels().filter((e) => e.recommended === 'cpu')
    const gpu = visibleModels().filter((e) => e.recommended === 'gpu')
    expect(cpu.map((e) => e.id)).toEqual(['base'])
    expect(gpu.map((e) => e.id)).toEqual(['large-v3-turbo'])
    // A CPU pick that needs the GPU would be a recommendation nobody can use.
    expect(cpu[0].needsGpu).toBeFalsy()
    expect(gpu[0].needsGpu).toBe(true)
    // Nothing outside the visible list carries a badge.
    expect(CATALOG.filter((e) => e.recommended).length).toBe(2)
  })
})

describe('catalogEntry and recommendedModel', () => {
  it('finds an entry by id and answers undefined for anything else', () => {
    expect(catalogEntry('base')?.bytes).toBe(147951465)
    expect(catalogEntry('gpu-pack')?.kind).toBe('gpu-pack')
    expect(catalogEntry('')).toBeUndefined()
    expect(catalogEntry('BASE')).toBeUndefined()
    expect(catalogEntry('parakeet')).toBeUndefined()
  })

  it('recommends by what the machine can run', () => {
    expect(recommendedModel(false).id).toBe('base')
    expect(recommendedModel(true).id).toBe('large-v3-turbo')
  })
})

describe('limitedLanguages and languageFor', () => {
  it('asks a model that picks its own language for auto, and leaves the stored choice to the rest', () => {
    expect(limitedLanguages('parakeet-v3')).toBe(true)
    expect(limitedLanguages('base')).toBe(false)
    expect(limitedLanguages('')).toBe(false)
    expect(limitedLanguages('nope')).toBe(false)
    expect(languageFor('parakeet-v3', 'no')).toBe('auto')
    expect(languageFor('parakeet-v3', 'auto')).toBe('auto')
    // Back on a Whisper model, the user's language is what it always was.
    expect(languageFor('base', 'no')).toBe('no')
    expect(languageFor('large-v3-turbo', 'de')).toBe('de')
    expect(languageFor('', 'sv')).toBe('sv')
  })

  it('says the one line the owner wrote, and nothing about why', () => {
    expect(LIMITED_LANGUAGES_TEXT).toBe("This model doesn't support all languages.")
    expect(LIMITED_LANGUAGES_TEXT).not.toMatch(/nvidia|parakeet|whisper|europe/i)
  })
})

describe('LANGUAGES', () => {
  it('starts with auto-detect and lists each Whisper code once', () => {
    expect(LANGUAGES[0]).toEqual({ code: 'auto', name: 'Auto-detect' })
    const codes = LANGUAGES.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const l of LANGUAGES.slice(1)) {
      expect(l.code, l.name).toMatch(/^[a-z]{2}$/)
      expect(l.name.length, l.code).toBeGreaterThan(0)
    }
    for (const must of 'en no sv da de fr es it pt nl pl fi uk ru tr ar hi ja ko zh'.split(' '))
      expect(codes, must).toContain(must)
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(21)
    expect(LANGUAGES.length).toBeLessThanOrEqual(35)
  })

  it('names are unique too, so the picker never shows one language twice', () => {
    const names = LANGUAGES.map((l) => l.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('ENGINE', () => {
  it('is the pinned official CPU build', () => {
    expect(ENGINE.tag).toBe('b5130')
    expect(ENGINE.asset).toBe('whisper-bin-x64.zip')
    expect(ENGINE.url).toBe(
      'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip'
    )
    expect(ENGINE.sha256).toBe('f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c')
    expect(ENGINE.bytes).toBeGreaterThan(0)
    expect(ENGINE.files).toContain('whisper-server.exe')
    // Parakeet's runner comes out of the SAME zip (#121).
    expect(ENGINE.files).toContain('parakeet-cli.exe')
    expect(ENGINE.files).toContain('parakeet.dll')
    expect(new Set(ENGINE.files).size).toBe(ENGINE.files.length)
    // Flattened names: what the engine folder holds, not where the zip kept them.
    for (const f of ENGINE.files) expect(f, f).not.toMatch(/[\\/]/)
  })

  // The fetch script runs before any build exists, so it cannot import this
  // catalog and carries its own copy of the pin. Two copies drift silently
  // (the app would verify one archive and the build would bundle another), so
  // the script is read as TEXT here and held to the same values.
  it('says the same as core/tools/fetch-whisper.mjs', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', 'tools', 'fetch-whisper.mjs'), 'utf8')
    const one = (name: string): string | undefined =>
      new RegExp(`^const ${name} = '([^']+)'`, 'm').exec(src)?.[1]
    expect(one('TAG')).toBe(ENGINE.tag)
    expect(one('ASSET')).toBe(ENGINE.asset)
    expect(one('SHA256')).toBe(ENGINE.sha256)
    expect(Number(/^const BYTES = (\d+)/m.exec(src)?.[1])).toBe(ENGINE.bytes)
    const block = /^const FILES = \[([\s\S]*?)\]/m.exec(src)?.[1] ?? ''
    const files = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(files).toEqual([...ENGINE.files])
    // The url is built from the pin in the script, as it is here.
    expect(src).toContain(
      'https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}/${ASSET}'
    )
  })
})
