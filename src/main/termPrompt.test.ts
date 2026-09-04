import { describe, expect, it } from 'vitest'
import { PS_PROMPT_HOOK, cmdPrompt } from './termPrompt'
import { ptyEnv } from './terminal'

describe('the prompt reports its folder (#99)', () => {
  it('wraps the existing PowerShell prompt once and prints OSC 9;9 for the FileSystem provider', () => {
    expect(PS_PROMPT_HOOK).toContain('$global:__prismPrompt = $function:prompt')
    expect(PS_PROMPT_HOOK).toContain('Test-Path Variable:global:__prismPrompt')
    expect(PS_PROMPT_HOOK).toContain("$PWD.Provider.Name -eq 'FileSystem'")
    expect(PS_PROMPT_HOOK).toContain(']9;9;$($PWD.ProviderPath)')
    expect(PS_PROMPT_HOOK).toContain('& $global:__prismPrompt')
    // One line: it is a -Command argument, and a newline in argv is a trap.
    expect(PS_PROMPT_HOOK).not.toMatch(/[\r\n]/)
  })

  it('puts the report in front of whatever PROMPT cmd already had', () => {
    expect(cmdPrompt(undefined)).toBe('$e]9;9;$P$e\\$P$G')
    expect(cmdPrompt('')).toBe('$e]9;9;$P$e\\$P$G')
    expect(cmdPrompt('$D $P$G')).toBe('$e]9;9;$P$e\\$D $P$G')
  })

  it('reaches cmd through its environment, and no other shell', () => {
    expect(ptyEnv({ PROMPT: '$P$G' }, 'cmd').PROMPT).toBe('$e]9;9;$P$e\\$P$G')
    expect(ptyEnv({}, 'cmd').PROMPT).toBe('$e]9;9;$P$e\\$P$G')
    expect(ptyEnv({ PROMPT: '$P$G' }, 'pwsh').PROMPT).toBe('$P$G')
    expect(ptyEnv({}, 'pwsh').PROMPT).toBeUndefined()
  })
})
