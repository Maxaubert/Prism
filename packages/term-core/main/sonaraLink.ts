import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import { join } from 'node:path'
import type { ShownQuestion } from '../shared/questionShown'

/**
 * SONARA, THE TEXT-TO-SPEECH READER (Sonara #323). Claude Code tells its
 * plugins nothing while the user moves between the questions of one
 * AskUserQuestion, so Sonara cannot read the question the user is on. The
 * tab can: the renderer reads it off the screen, and this hands it to a
 * Sonara running on this PC, naming the tab by the `PRISM_TAB_ID` its shell
 * carries (Sonara's own hook tagged the Claude session with the same value).
 *
 * Only to 127.0.0.1, only when Sonara wrote its `runtime.json` (its home is
 * `SONARA_HOME`, else `%LOCALAPPDATA%\Sonara`). No Sonara: nothing is sent
 * and nothing fails. Every failure is quiet; the caller gets false.
 */

/** Sonara's home folder, or null when neither variable says where. */
export function sonaraHome(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.SONARA_HOME) return env.SONARA_HOME
  return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Sonara') : null
}

interface Runtime {
  httpPort: number
  token: string
}

async function runtime(home: string): Promise<Runtime | null> {
  try {
    const r = JSON.parse(await readFile(join(home, 'runtime.json'), 'utf8')) as Record<string, unknown>
    const port = r.http_port
    const token = r.token
    if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) return null
    if (typeof token !== 'string' || !token) return null
    return { httpPort: port, token }
  } catch {
    return null
  }
}

/** Tell Sonara what tab `tabToken` shows. True when Sonara took it. */
export async function postQuestionShown(
  tabToken: string,
  shown: ShownQuestion,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 1500
): Promise<boolean> {
  const home = sonaraHome(env)
  if (!home || !tabToken) return false
  const rt = await runtime(home)
  if (!rt) return false
  const body = JSON.stringify({ host_tab: tabToken, ...shown })
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: rt.httpPort,
        path: '/v1/question_shown',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${rt.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (res) => {
        res.resume()
        resolve(res.statusCode === 200)
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end(body)
  })
}
