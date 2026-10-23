/**
 * WHAT CLAUDE CODE SAYS ABOUT ITSELF THROUGH ITS HOOKS (#131; owner,
 * 2026-10-05: "go ahead and build that").
 *
 * The bundled plugin (`core/claude-plugin`) has a command hook on each event
 * below, and each prints a FIXED `terminalSequence`: Claude writes it into its
 * own terminal, so it arrives in the tab's pty as
 *
 *   ESC ] 777 ; prism-agent ; state=<state> [; kind=<kind>] [; session=<id>] BEL
 *
 * In-band, so there is no listener, no port and no tab id to match: the
 * sequence can only reach the tab whose Claude ran the hook. `claude -p` and
 * SDK runs never write one (MEASURED), so a nested run cannot light a tab.
 * SessionStart and SessionEnd are left out: their bytes reached the pty in 1 of
 * 3 and 0 of 3 runs (MEASURED, 2026-10-05).
 *
 * Pure: xterm hands the OSC's data (everything after `777;`) to `parse`, and
 * anything that is not ours answers null so other OSC 777 users are untouched.
 */

export type AgentHookState = 'working' | 'question' | 'done' | 'failed'

export interface AgentSignal {
  state: AgentHookState
  /** Why a turn failed (StopFailure's `error`), only with `failed`. */
  kind?: string
  /** The Claude session the turn belongs to (its transcript's name), from
   *  UserPromptSubmit and Stop only: the catch-up report (2026-10-16). */
  session?: string
}

/** A Claude session id as Claude writes it: a lower-case UUID. Nothing else
 *  is carried, so the field can only ever name a transcript file. */
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const STATES: ReadonlySet<string> = new Set(['working', 'question', 'done', 'failed'])

/** Claude Code's StopFailure `error` values (2.1.289), one static hook each. A
 *  catch-all hook says `failed` with no kind too, so a kind added in a later
 *  Claude still marks the tab, only without its name. */
export const STOP_FAILURE_KINDS = [
  'rate_limit',
  'overloaded',
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'billing_error',
  'invalid_request',
  'model_not_found',
  'server_error',
  'max_output_tokens',
  'cloud_credential_error',
  'unknown'
] as const

/**
 * Which hook says what: the plugin's `hooks.json` is held to this by a test.
 * A Notification counts only for the three types that mean "waiting on you";
 * PermissionRequest is the INSTANT one (Notification's permission_prompt comes
 * about 6 s later, MEASURED). Subagents and compacting are the agent at work.
 */
export const AGENT_HOOK_EVENTS: ReadonlyArray<{ event: string; matcher: string; args: string }> = [
  // The turn's own two (never a tool's or a subagent's) also name the session:
  // `+sid` (the catch-up report, 2026-10-16).
  { event: 'UserPromptSubmit', matcher: '*', args: 'working +sid' },
  ...['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'PreCompact'].map(
    (event) => ({ event, matcher: '*', args: 'working' })
  ),
  { event: 'PermissionRequest', matcher: '*', args: 'question' },
  { event: 'Elicitation', matcher: '*', args: 'question' },
  ...['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog'].map((matcher) => ({
    event: 'Notification',
    matcher,
    args: 'question'
  })),
  { event: 'Stop', matcher: '*', args: 'done +sid' },
  ...STOP_FAILURE_KINDS.map((kind) => ({ event: 'StopFailure', matcher: kind, args: `failed ${kind}` })),
  { event: 'StopFailure', matcher: '*', args: 'failed' }
]

const PREFIX = 'prism-agent'
const KIND = /^[a-z][a-z0-9_]{0,39}$/

/** One OSC 777 payload, or null when it is not a state from our plugin. */
export function parseAgentSignal(data: string): AgentSignal | null {
  if (typeof data !== 'string' || data.length > 200) return null
  const parts = data.split(';')
  if (parts[0] !== PREFIX) return null
  let state: string | undefined
  let kind: string | undefined
  let session: string | undefined
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq <= 0) return null
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 'state') state = value
    else if (key === 'kind') kind = value
    else if (key === 'session') session = value
    // An unknown field is a newer plugin's: the state still stands.
  }
  if (!state || !STATES.has(state)) return null
  // A session that is not a UUID is dropped; the state still stands.
  const sid = session !== undefined && SESSION.test(session) ? { session } : {}
  if (state !== 'failed') return { state: state as AgentHookState, ...sid }
  if (kind === undefined) return { state: 'failed', ...sid }
  return KIND.test(kind) ? { state: 'failed', kind, ...sid } : null
}

/** Plain words for a failure's kind, for the tab's tooltip. */
const KIND_WORDS: Record<string, string> = {
  rate_limit: 'rate limit',
  overloaded: 'servers overloaded',
  authentication_failed: 'sign-in failed',
  oauth_org_not_allowed: 'organisation not allowed',
  account_on_hold: 'account on hold',
  billing_error: 'billing',
  invalid_request: 'invalid request',
  model_not_found: 'model not found',
  server_error: 'server error',
  max_output_tokens: 'reply too long',
  cloud_credential_error: 'cloud credentials',
  unknown: 'unknown error'
}

/** "Failed: rate limit", or "Failed" when the kind is not known. */
export function failedLabel(kind: string | undefined): string {
  if (!kind) return 'Failed'
  return `Failed: ${KIND_WORDS[kind] ?? kind.replace(/_/g, ' ')}`
}
