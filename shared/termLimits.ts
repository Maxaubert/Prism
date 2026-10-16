/**
 * The most text a program in a tab may put on the clipboard with one OSC 52
 * write (#176): 1 MB of decoded text. Shared, because the page refuses more
 * before it crosses the bridge and main refuses it again (the page is never
 * trusted with a limit). Large enough for any answer Claude Code's /copy
 * makes; small enough that a runaway `cat` of a base64 blob cannot hand main
 * hundreds of megabytes.
 */
export const OSC52_MAX = 1_048_576

/**
 * The most paths the page may ask main about in one call (#99). Shared, because
 * main refuses past it and the page, which used to send more and read every
 * answer past the 300th as "does not exist" (perf review 2026-10-16), now asks
 * in pieces of this size.
 */
export const PATHS_MAX = 300
