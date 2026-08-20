// Which shell new terminals launch. A saved id that no longer exists on this
// machine is shellById's problem (it falls back to pwsh/powershell quietly).

const KEY = 'prism.term.shell'

export function savedShellId(): string | undefined {
  const v = localStorage.getItem(KEY)
  return v ? v : undefined
}

export function saveShellId(id: string): void {
  localStorage.setItem(KEY, id)
}
