import { globToRegExp } from './searchQuery'

export interface BrowseQuery {
  matches(name: string, isDirectory: boolean): boolean
  error?: string
}

type Match = (name: string, isDirectory: boolean) => boolean

/** Preserve Everything syntax, translating only Prism's legacy exclusions. */
export function nativeBrowseQuery(query: string): string {
  let quoted = false
  let result = ''
  for (let i = 0; i < query.length; i++) {
    const char = query[i]
    if (char === '"') quoted = !quoted
    const startsTerm = i === 0 || /\s/.test(query[i - 1])
    result +=
      !quoted && char === '-' && startsTerm && i + 1 < query.length && !/\s/.test(query[i + 1])
        ? '!'
        : char
  }
  return result
}

const requiresEverything =
  'These filters need the file index. While it is unavailable for this folder, use names, wildcards, folder:, file: or ext: filters.'

/** A deliberately limited fallback. Never quietly treat advanced operators as names. */
export function parseBrowseQuery(query: string): BrowseQuery {
  const terms: Match[] = []
  const tokens = query.match(/(?:"[^"]*"|[^\s"])+/g) ?? []
  if ((query.match(/"/g)?.length ?? 0) % 2) {
    return { matches: () => false, error: 'Close the quotation mark to search for a phrase.' }
  }

  for (const raw of tokens) {
    let token = raw
    let negated = false
    while (token.startsWith('!') || (token.startsWith('-') && token.length > 1)) {
      negated = !negated
      token = token.slice(1)
    }

    // Quoted punctuation is part of a filename. Unquoted operators must go to Everything.
    const syntax = token.replace(/"[^"]*"/g, '')
    if (/[!|<>\\/]/.test(syntax)) return { matches: () => false, error: requiresEverything }
    if (!token || (token.includes('"') && /[*?]/.test(syntax))) {
      return { matches: () => false, error: requiresEverything }
    }

    let matcher: Match
    const filter = /^(folder|file|ext):(.*)$/i.exec(token)
    if (filter) {
      const [, kind, value] = filter
      const filterKind = kind.toLowerCase()
      const unquotedValue = value.replace(/"[^"]*"/g, '')
      if (unquotedValue.includes(':')) return { matches: () => false, error: requiresEverything }
      if (filterKind === 'ext') {
        const extensions = value
          .replace(/"/g, '')
          .toLowerCase()
          .split(';')
          .map((extension) => extension.replace(/^\./, ''))
          .filter(Boolean)
        if (!extensions.length || /[*?]/.test(unquotedValue)) {
          return { matches: () => false, error: requiresEverything }
        }
        matcher = (name, isDirectory) => {
          const dot = name.lastIndexOf('.')
          return !isDirectory && dot >= 0 && extensions.includes(name.slice(dot + 1).toLowerCase())
        }
      } else {
        const nameMatches = value ? matchName(value) : () => true
        matcher = (name, isDirectory) =>
          isDirectory === (filterKind === 'folder') && nameMatches(name)
      }
    } else {
      if (syntax.includes(':')) return { matches: () => false, error: requiresEverything }
      matcher = matchName(token)
    }
    terms.push(negated ? (name, isDirectory) => !matcher(name, isDirectory) : matcher)
  }

  return {
    matches: (name, isDirectory) =>
      terms.length > 0 && terms.every((matches) => matches(name, isDirectory))
  }
}

function matchName(value: string): (name: string) => boolean {
  const literal = value.replace(/"/g, '').toLowerCase()
  const unquoted = value.replace(/"[^"]*"/g, '')
  if (/[*?]/.test(unquoted)) {
    const pattern = globToRegExp(literal)
    return (name) => pattern.test(name)
  }
  return (name) => name.toLowerCase().includes(literal)
}
