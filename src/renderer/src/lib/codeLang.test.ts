import { describe, expect, it } from 'vitest'
import { isProse, langFor } from './codeLang'

describe('langFor', () => {
  it('picks a language by extension', () => {
    expect(langFor('main.py')?.name).toBe('Python')
    expect(langFor('lib.rs')?.name).toBe('Rust')
    expect(langFor('Program.cs')?.name).toBe('C#')
    expect(langFor('build.gradle')?.name).toBe('Groovy')
    expect(langFor('script.ps1')?.name).toBe('PowerShell')
  })

  it('distinguishes the JavaScript dialects', () => {
    expect(langFor('a.js')?.name).toBe('JavaScript')
    expect(langFor('a.jsx')?.name).toBe('JSX')
    expect(langFor('a.ts')?.name).toBe('TypeScript')
    expect(langFor('a.tsx')?.name).toBe('TSX')
  })

  it('is case-insensitive', () => {
    expect(langFor('MAIN.PY')?.name).toBe('Python')
    expect(langFor('DOCKERFILE')?.name).toBe('Dockerfile')
  })

  it('matches whole names before extensions', () => {
    expect(langFor('Dockerfile')?.name).toBe('Dockerfile')
    expect(langFor('Makefile')?.name).toBe('CMake')
    expect(langFor('Gemfile')?.name).toBe('Ruby')
    expect(langFor('CMakeLists.txt')?.name).toBe('CMake')
  })

  it('has no language for prose or for anything unmapped', () => {
    expect(langFor('notes.txt')).toBeNull()
    expect(langFor('server.log')).toBeNull()
    expect(langFor('mystery.qqq')).toBeNull()
    expect(langFor('noextension')).toBeNull()
  })

  // The two tiers the squiggles depend on: a Lezer grammar can report a syntax
  // error, a ported stream lexer only colours tokens.
  it('marks which languages can report syntax errors', () => {
    expect(langFor('a.py')?.parsed).toBe(true)
    expect(langFor('a.json')?.parsed).toBe(true)
    expect(langFor('a.sh')?.parsed).toBe(false)
    expect(langFor('a.lua')?.parsed).toBe(false)
  })
})

describe('isProse', () => {
  it('is true for plain text, and for anything with no language', () => {
    expect(isProse('notes.txt')).toBe(true)
    expect(isProse('server.log')).toBe(true)
    expect(isProse('subs.srt')).toBe(true)
    expect(isProse('mystery.qqq')).toBe(true)
  })

  it('is false for code', () => {
    expect(isProse('main.py')).toBe(false)
    expect(isProse('Dockerfile')).toBe(false)
    expect(isProse('README.md')).toBe(false)
  })
})

// The mapping is hand-written against two upstream packages, so the export
// names are the part most likely to rot. Legacy modes are plain data with no
// DOM behind them, which makes them cheap to load for real here.
describe('the legacy stream modes it names', () => {
  const named = [
    'main.c', 'App.cs', 'a.scala', 'a.kt', 'a.m', 'a.mm', 'a.dart',
    'a.sh', 'a.ps1', 'a.rb', 'a.lua', 'a.swift', 'a.pl', 'a.r', 'a.jl',
    'a.hs', 'a.clj', 'a.erl', 'a.elm', 'a.toml', 'a.ini', 'Dockerfile',
    'a.conf', 'a.diff', 'a.proto', 'a.groovy', 'a.pas', 'a.f90', 'a.tcl',
    'a.vb', 'a.v', 'a.vhd', 'a.ml', 'a.fs', 'a.tex', 'a.cmake', 'a.styl',
    'a.scm', 'a.lisp', 'a.asm', 'a.cr'
  ]

  it.each(named)('%s resolves to a real stream parser', async (name) => {
    const lang = langFor(name)
    expect(lang, name).not.toBeNull()
    expect(lang!.parsed).toBe(false)
    // Throws if the export name is wrong: StreamLanguage.define needs a token().
    await expect(lang!.load()).resolves.toBeDefined()
  })
})

describe('the Lezer grammars it names', () => {
  const named = [
    'a.js', 'a.jsx', 'a.ts', 'a.tsx', 'a.json', 'a.css', 'a.scss', 'a.sass',
    'a.less', 'a.html', 'a.vue', 'a.xml', 'a.py', 'a.md', 'a.rs', 'a.cpp',
    'a.java', 'a.php', 'a.sql', 'a.yml', 'a.go'
  ]

  it.each(named)('%s resolves to a real grammar', async (name) => {
    const lang = langFor(name)
    expect(lang, name).not.toBeNull()
    expect(lang!.parsed).toBe(true)
    await expect(lang!.load()).resolves.toBeDefined()
  })
})
