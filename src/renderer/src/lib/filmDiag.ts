import { record } from 'prism-term-core/renderer/lib/diag'

/**
 * WHAT THE PLAYER DID WITH A FILM, ALWAYS ON (owner, 2026-11-08: "make sure
 * logs are always on so you can see what happened"). The owner's black films
 * left nothing behind: which route each took, whether a frame ever came, or
 * why not. One `op` line (`op: 'film'`) per event, never per frame:
 *
 * - `route`: `route` direct|live, `why` (lib/liveRoute `routeWhy`), `codec`
 * - `first-frame`: `ms` from the film being handed to the element, `route`
 * - `error`: the element's `code` and `message`
 * - `no-picture`: the bounded wait ran out (`ms`, `ready`, `net`)
 * - `black`: frames arrive and every one is black
 * - `to-live`: a direct start handed over (`why` said by what happened)
 * - `live-open`: main's answer, `error` when it had none
 * - `live-error`: hls.js gave up after its retries (`detail`)
 *
 * A failure is `ok: false`, which `npm run diag` lists as a problem.
 */
export function filmLine(
  ev: string,
  path: string,
  fields: Record<string, unknown> = {},
  ok = true
): void {
  record('op', { op: 'film', ev, ok, path, ...fields })
}
