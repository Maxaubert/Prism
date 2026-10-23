import { execFileSync } from 'child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ORCHESTRATOR_PLUGIN_NAME, isOurPlugin } from './claudePlugin'

/**
 * The opt-in orchestrator plugin (2026-10-16): its manifest is ours (so an
 * inherited copy is dropped like the status one), it hooks only the prompt,
 * and its role hook speaks only in the promoted tab.
 */

const PLUGIN = join(__dirname, '..', 'claude-plugin-orchestrator')

describe('the orchestrator plugin', () => {
  it('is recognised as ours, and hooks nothing but the prompt', () => {
    expect(JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe(ORCHESTRATOR_PLUGIN_NAME)
    expect(isOurPlugin(PLUGIN)).toBe(true)
    const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks
    expect(Object.keys(hooks)).toEqual(['UserPromptSubmit'])
    const h = hooks.UserPromptSubmit[0].hooks[0]
    expect([h.command, ...h.args]).toEqual(['cmd.exe', '/d', '/c', 'call', '$' + '{CLAUDE_PLUGIN_ROOT}/role.cmd'])
  })

  // Run from a folder with a space and brackets, as Claude Code runs it.
  it.runIf(process.platform === 'win32')('tells only the promoted tab it is the orchestrator', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'pt-orch-')), 'Prism (x) T')
    mkdirSync(root)
    copyFileSync(join(PLUGIN, 'role.cmd'), join(root, 'role.cmd'))
    const sessions = join(root, 'sessions.json')
    const run = (tab: string, file: string | null = sessions): string => {
      const env: NodeJS.ProcessEnv = { ...process.env, PRISM_TAB_ID: tab }
      if (file) env.PRISM_SESSIONS_FILE = file
      else delete env.PRISM_SESSIONS_FILE
      return execFileSync('cmd.exe', ['/d', '/c', 'call', join(root, 'role.cmd')], { env, encoding: 'utf8', windowsHide: true }).trim()
    }
    expect(run('tok-1')).toBe('') // no tab promoted
    writeFileSync(join(root, 'orchestrator-tab.txt'), 'tok-1')
    const said = JSON.parse(run('tok-1'))
    expect(said.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
    expect(said.hookSpecificOutput.additionalContext).toContain('prism-terminal-orchestrator:orchestrator')
    expect(run('tok-2')).toBe('')
    expect(run('tok-1&calc')).toBe('')
    expect(run('tok-1', null)).toBe('')
  })
})
