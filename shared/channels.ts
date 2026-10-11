/**
 * The terminal's IPC channel names, ONCE. The preload half (`core/preload/api`)
 * and the main half (`core/main/ipc`) both read this table, so a channel cannot
 * be renamed on one side of the bridge and not the other, in either app.
 */
export const CH = {
  shells: 'term:shells',
  spawn: 'term:spawn',
  input: 'term:input',
  resize: 'term:resize',
  kill: 'term:kill',
  prewarm: 'term:prewarm',
  cd: 'term:cd',
  data: 'term:data',
  agent: 'term:agent',
  agentLook: 'term:agent-look',
  /** Send one session's next agent answer, changed or not. */
  agentAgain: 'term:agent-again',
  exit: 'term:exit',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  /** A program's OSC 52 copy (#176): its own channel and its own cap. */
  clipboardTerm: 'clipboard:term-write',
  /** A session rang the bell (#177); the host decides what that looks like. */
  bell: 'term:bell',
  openExternal: 'shell:open-external',
  pathKinds: 'term:path-kinds',
  openPath: 'term:open-path'
} as const

/** The diagnostics log's channels (#140). A table of its own, like
 *  dictation's: a host wires it with one call on each side of the bridge
 *  (`createDiagApi`, `startDiagnostics`). Every `diag:` channel is left out of
 *  the IPC timing, which would otherwise log the log. */
export const DGCH = {
  /** The page's lines, batched every 250 ms. */
  batch: 'diag:batch',
  /** The page is alive: every 500 ms. A 2 s gap asks for its stack. */
  beat: 'diag:beat',
  info: 'diag:info',
  setVerbose: 'diag:set-verbose',
  openFolder: 'diag:open-folder',
  mark: 'diag:mark'
} as const

/** Dictation's channels (#13). A table of its own: dictation is optional, and
 *  a host wires it with a separate call on each side of the bridge. */
export const DCH = {
  info: 'dictation:info',
  status: 'dictation:status',
  download: 'dictation:download',
  cancel: 'dictation:cancel',
  remove: 'dictation:remove',
  progress: 'dictation:progress',
  transcribe: 'dictation:transcribe',
  warm: 'dictation:warm',
  stop: 'dictation:stop',
  mediaPause: 'dictation:media-pause',
  mediaResume: 'dictation:media-resume'
} as const
