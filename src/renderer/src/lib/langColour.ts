/**
 * The dot beside a text file's language in Properties (owner, 2026-10-12,
 * the code mockup's "Language with its dot"). Keyed by the name codeLang's
 * `langFor` gives, in the colours GitHub made familiar (the darkest lifted
 * to read on a dark dialog); a language not in the list, and plain text,
 * take the text kind's own colour.
 */
const COLOURS: Record<string, string> = {
  JavaScript: '#f1e05a',
  JSX: '#f1e05a',
  TypeScript: '#3178c6',
  TSX: '#3178c6',
  JSON: '#cbcb41',
  'JSON with Comments': '#cbcb41',
  JSON5: '#cbcb41',
  CSS: '#8f6ac9',
  SCSS: '#c6538c',
  Sass: '#a53b70',
  Vue: '#41b883',
  Less: '#5b7fbf',
  HTML: '#e34c26',
  XML: '#3d8fd1',
  Python: '#6fb2ff',
  Rust: '#dea584',
  Go: '#00add8',
  Java: '#b07219',
  'C++': '#f34b7d',
  PHP: '#777bb4',
  Ruby: '#cc342d',
  Swift: '#f05138',
  Lua: '#6c7cd1',
  Shell: '#89e051',
  PowerShell: '#5391fe',
  SQL: '#e38c00',
  YAML: '#cb171e',
  TOML: '#9c4221',
  Dockerfile: '#5f8fa3'
}

export const TEXT_COLOUR = 'var(--p-kind-text)'

export function langColour(name: string | undefined): string {
  return (name && COLOURS[name]) || TEXT_COLOUR
}
