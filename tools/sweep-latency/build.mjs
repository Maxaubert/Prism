// Builds tools/sweep-latency/build/sweep-latency.exe (#338, task 1 step 3):
// MSVC through vswhere and vcvars64, /MT so it runs on any machine. Dev-only;
// the measuring tool is never shipped.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vcvars64 } from '../lib/msvc.mjs'
import { windowsOnly } from '../lib/repo.mjs'

const here = dirname(fileURLToPath(import.meta.url))
windowsOnly('sweep-latency: Windows only')
const vcvars = vcvars64()
if (!vcvars) throw new Error('MSVC x64 tools not found: install the Visual Studio C++ build tools')
const out = join(here, 'build')
mkdirSync(out, { recursive: true })
const cmd = `call "${vcvars}" >nul && cl /nologo /O2 /MT /EHsc /std:c++17 /W4 /utf-8 "${join(here, 'latency.cpp')}" /Fo"${out}\\\\" /Fe"${join(out, 'sweep-latency.exe')}"`
const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], { stdio: 'inherit', windowsHide: true, windowsVerbatimArguments: true })
if (r.status !== 0) process.exit(r.status ?? 1)
console.log(`sweep-latency: built ${join(out, 'sweep-latency.exe')}`)
