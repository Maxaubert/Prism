/**
 * THE NAME IN A TITLE (#512). In a title a file name is plain text, with no
 * quotes (one rule for every dialog; DialogName draws it in a body): the name
 * when exactly one item is meant and its name is known, else "N items".
 */
import { plural } from '../lib/emptyText'

export function nameOrCount(names: readonly string[], count: number, noun: string): string {
  return count === 1 && names.length ? names[0] : plural(count, noun)
}