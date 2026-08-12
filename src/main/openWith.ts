import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { basename } from 'path'

// "Open in ..." candidates for a file extension, read from the registry the way
// Explorer builds its Open With list: the user's own MRU (FileExts), the
// extension's OpenWithProgids, and the extension's default handler. Pure
// parsing lives in exported functions so it can be unit-tested; only `query`
// actually touches reg.exe.
//
// AppX/store handlers (DelegateExecute) are skipped: launching those takes COM
// activation, and the "Choose another app" chooser still reaches them.

export interface RegValue {
  /** The key the value sits under (last key line seen). */
  key: string
  name: string
  type: string
  data: string
}

export interface AppCandidate {
  /** Absolute path of the executable; doubles as the id over IPC. */
  exe: string
  /** Command-line template, tokenized; '%1' marks where the file goes. */
  args: string[]
  name: string
}

/* ---------- pure parsing ---------- */

/** Parse `reg query` output: key lines start with HK, value lines are indented
 *  `name    REG_TYPE    data`. The default value prints as `(Default)`. */
export function parseRegOutput(out: string): RegValue[] {
  const values: RegValue[] = []
  let key = ''
  for (const raw of out.split(/\r?\n/)) {
    if (!raw.trim()) continue
    if (/^HK/.test(raw)) {
      key = raw.trim()
      continue
    }
    const m = /^\s+(.+?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(raw)
    if (m) values.push({ key, name: m[1], type: m[2], data: m[3].trim() })
  }
  return values
}

/** Split a shell command template into tokens, honouring double quotes. */
export function splitCommandLine(cmd: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2])
  return out
}

/** The argv an app template means for `file`: %1/%L substituted, or the file
 *  appended when the template never mentions it. The exe itself is args[0]. */
export function argsFor(template: string[], file: string): string[] {
  let used = false
  const args = template.slice(1).map((a) => {
    if (/%[1lL*]/.test(a)) {
      used = true
      return a.replace(/"?%[1lL*]"?/g, file)
    }
    return a
  })
  if (!used) args.push(file)
  return args
}

/** MRUList "cab" turns value names into their user-preferred order. */
export function mruOrder(values: RegValue[]): string[] {
  const mru = values.find((v) => v.name.toLowerCase() === 'mrulist')?.data ?? ''
  const byName = new Map(values.filter((v) => v.name.length === 1).map((v) => [v.name, v.data]))
  const ordered: string[] = []
  for (const c of mru) {
    const d = byName.get(c)
    if (d) {
      ordered.push(d)
      byName.delete(c)
    }
  }
  return [...ordered, ...byName.values()]
}

const expandEnv = (s: string): string =>
  s.replace(/%([^%]+)%/g, (_, n: string) => process.env[n] ?? `%${n}%`)

/* ---------- registry access ---------- */

function query(key: string): Promise<RegValue[]> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', key],
      { windowsHide: true, timeout: 3000 },
      (err, stdout) => resolve(err ? [] : parseRegOutput(stdout))
    )
  })
}

const defaultValue = (values: RegValue[], key?: string): string | undefined =>
  values.find(
    (v) => v.name === '(Default)' && (!key || v.key.toLowerCase() === key.toLowerCase())
  )?.data

/** The open command an Applications\<exe> or a progid key declares, if it is a
 *  plain executable command (store handlers use DelegateExecute instead). */
async function openCommand(key: string): Promise<string | null> {
  const values = await query(`${key}\\shell\\open\\command`)
  if (values.some((v) => v.name.toLowerCase() === 'delegateexecute' && v.data)) return null
  const cmd = defaultValue(values)
  return cmd && !/rundll32|openas_rundll/i.test(cmd) ? cmd : null
}

/** "firefox" -> "Firefox": the exe stem, wearing its Sunday capital. */
const stemName = (exe: string): string => {
  const stem = basename(exe).replace(/\.exe$/i, '')
  return stem ? stem[0].toUpperCase() + stem.slice(1) : stem
}

async function friendlyName(appKey: string, exe: string): Promise<string> {
  const values = await query(appKey)
  const friendly = values.find((v) => v.name.toLowerCase() === 'friendlyappname')?.data
  // Resource references ("@shell32.dll,-1234") need Win32 to resolve; the exe's
  // own name reads fine, so fall back to it rather than showing the reference.
  if (friendly && !friendly.startsWith('@')) return friendly
  return stemName(exe)
}

async function candidateFromCommand(cmd: string): Promise<AppCandidate | null> {
  const args = splitCommandLine(expandEnv(cmd))
  const exe = args[0]
  if (!exe || !existsSync(exe)) return null
  return { exe, args, name: stemName(exe) }
}

/** Candidates for one exe name (e.g. "Code.exe") from HKCR\Applications, with
 *  the App Paths fallback Explorer also uses. */
async function fromExeName(exeName: string): Promise<AppCandidate | null> {
  const appKey = `HKCR\\Applications\\${exeName}`
  const cmd = await openCommand(appKey)
  if (cmd) {
    const c = await candidateFromCommand(cmd)
    if (c) return { ...c, name: await friendlyName(appKey, c.exe) }
  }
  const appPath = defaultValue(
    await query(`HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`)
  )
  if (appPath) {
    const exe = expandEnv(appPath.replace(/^"|"$/g, ''))
    if (existsSync(exe)) {
      return { exe, args: [exe, '%1'], name: stemName(exe) }
    }
  }
  return null
}

async function fromProgid(progid: string): Promise<AppCandidate | null> {
  if (!progid || progid.startsWith('AppX')) return null
  const cmd = await openCommand(`HKCR\\${progid}`)
  if (!cmd) return null
  const c = await candidateFromCommand(cmd)
  if (!c) return null
  return { ...c, name: await friendlyName(`HKCR\\Applications\\${basename(c.exe)}`, c.exe) }
}

/**
 * The apps Windows knows can open `ext`, most-recently-used first, our own
 * executable excluded. Capped: a submenu is a shortlist, not a registry dump.
 */
export async function appsForExt(ext: string, cap = 8): Promise<AppCandidate[]> {
  const fileExts = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${ext}`
  const [mruValues, userProgids, classProgids, classRoot] = await Promise.all([
    query(`${fileExts}\\OpenWithList`),
    query(`${fileExts}\\OpenWithProgids`),
    query(`HKCR\\${ext}\\OpenWithProgids`),
    query(`HKCR\\${ext}`)
  ])

  const exeNames = mruOrder(mruValues).filter((n) => /\.exe$/i.test(n))
  const progids = [
    defaultValue(classRoot) ?? '',
    ...userProgids.map((v) => v.name),
    ...classProgids.map((v) => v.name)
  ].filter((p) => p && p !== '(Default)' && p !== 'MRUList')

  const found = await Promise.all([
    ...exeNames.map(fromExeName),
    ...progids.map(fromProgid)
  ])

  // Prism never offers itself: pointless when installed (you are already
  // here), and in dev process.execPath is electron.exe, so the installed
  // Prism.exe has to be excluded by name.
  const self = process.execPath.toLowerCase()
  const seen = new Set<string>()
  const out: AppCandidate[] = []
  for (const c of found) {
    if (!c) continue
    const id = c.exe.toLowerCase()
    if (id === self || basename(id) === 'prism.exe' || seen.has(id)) continue
    seen.add(id)
    out.push(c)
    if (out.length >= cap) break
  }
  return out
}
