import { spawnSync } from 'child_process'
import type { ShellDef } from '@shared/types'

// The shells this machine actually has. Prism never execs a renderer-supplied
// path: the renderer names a shell by id, and the id is looked up in this list,
// which main built itself - the same rule the "Open in" menu follows.

export type { ShellDef }

/**
 * Distro names out of decoded `wsl -l -q` output. The -q form prints one bare
 * name per line; an error banner ("...has no installed distributions.") has
 * spaces, which no -q distro name does, so a word-shaped filter drops it.
 */
export function parseWslList(out: string): string[] {
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+$/.test(l))
}

/** The saved shell if it still exists, else pwsh, else Windows PowerShell. */
export function shellById(id: string | undefined, list: ShellDef[]): ShellDef {
  return (
    list.find((s) => s.id === id) ??
    list.find((s) => s.id === 'pwsh') ??
    list.find((s) => s.id === 'powershell') ??
    list[0]
  )
}

const probe = (exe: string): boolean =>
  spawnSync('where', [exe], { windowsHide: true, timeout: 5000 }).status === 0

let cached: Promise<ShellDef[]> | null = null

/** Detect once per run. Prism is resident, but a newly installed shell only
 *  matters for NEW terminals, and a restart is an acceptable price for that. */
export function detectShells(): Promise<ShellDef[]> {
  cached ??= Promise.resolve().then(() => {
    const list: ShellDef[] = []
    if (probe('pwsh.exe'))
      list.push({
        id: 'pwsh',
        name: 'PowerShell 7',
        exe: 'pwsh.exe',
        // PSReadLine's ghost suggestions from history (RightArrow accepts,
        // Up/Down recalls), switched on explicitly so no profile or version
        // default can leave them off.
        //
        // EnableScreenReaderMode:$false matters more than it looks: when the
        // system screen-reader flag is set (automation tooling flips it as a
        // false positive), PSReadLine 2.4 silently drops to a plain renderer -
        // no colours, no predictions. This puts the real renderer back. A user
        // actually running a screen reader can pick a different shell in
        // Settings; a per-user toggle is the future knob if anyone needs it.
        // The try keeps older PSReadLine versions (no such parameter) working.
        //
        // Windows PowerShell ships PSReadLine 2.0: no prediction, plain args.
        args: [
          '-NoLogo',
          '-NoExit',
          '-Command',
          'Set-PSReadLineOption -PredictionSource History; try { Set-PSReadLineOption -EnableScreenReaderMode:$false } catch {}'
        ]
      })
    list.push({ id: 'powershell', name: 'Windows PowerShell', exe: 'powershell.exe', args: ['-NoLogo'] })
    list.push({ id: 'cmd', name: 'Command Prompt', exe: 'cmd.exe', args: [] })
    // wsl -l -q prints UTF-16LE. --cd . starts the distro in the pty's cwd.
    const wsl = spawnSync('wsl.exe', ['-l', '-q'], { windowsHide: true, timeout: 5000 })
    if (wsl.status === 0 && wsl.stdout) {
      for (const name of parseWslList(wsl.stdout.toString('ucs2').replace(/\0/g, ''))) {
        list.push({ id: `wsl-${name}`, name: `WSL: ${name}`, exe: 'wsl.exe', args: ['-d', name, '--cd', '.'] })
      }
    }
    return list
  })
  return cached
}
