/**
 * A WEB ADDRESS, AND NOTHING ELSE LEAVES THE APP (regression rule 4: http(s)
 * only for navigation and window-open). One test for every place either app
 * hands a link to the browser (audit 2026-10-12: four copies, two regexes,
 * one of them `^https?:` with no slashes).
 */
export function isWebUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}
