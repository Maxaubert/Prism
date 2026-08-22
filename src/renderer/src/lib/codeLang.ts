import { StreamLanguage, type StreamParser } from '@codemirror/language'
import type { Extension } from '@codemirror/state'

// Extension -> language, the same idea Notepad++ gets from Lexilla: one lexer
// per language, picked by file name. Two tiers live here.
//
//   parsed: a real Lezer grammar. It builds a syntax tree, so a broken brace
//           becomes an error node the linter can underline (see codeLint.ts),
//           and folding and smart indent work.
//   lexed:  a legacy stream mode, ported from CodeMirror 5. It colours tokens
//           and nothing more: a tokenizer has no grammar to be wrong against,
//           so these files never show squiggles.
//
// Every entry loads on demand. Vite splits each import() into its own chunk, so
// opening a .py never downloads the Rust grammar.

export type CodeLang = {
  /** What to call it in the UI. */
  readonly name: string
  /** True when the grammar can report syntax errors. */
  readonly parsed: boolean
  readonly load: () => Promise<Extension>
}

const parsed = (name: string, load: () => Promise<Extension>): CodeLang => ({
  name,
  parsed: true,
  load
})

const lexed = (name: string, load: () => Promise<StreamParser<unknown>>): CodeLang => ({
  name,
  parsed: false,
  load: async () => StreamLanguage.define(await load())
})

/* ---------- Lezer grammars: highlighting, folding, and real errors ---------- */

const JS = parsed('JavaScript', async () => (await import('@codemirror/lang-javascript')).javascript())
const JSX = parsed('JSX', async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }))
const TS = parsed('TypeScript', async () => (await import('@codemirror/lang-javascript')).javascript({ typescript: true }))
const TSX = parsed('TSX', async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }))
const JSON_ = parsed('JSON', async () => (await import('@codemirror/lang-json')).json())
const CSS = parsed('CSS', async () => (await import('@codemirror/lang-css')).css())
const HTML = parsed('HTML', async () => (await import('@codemirror/lang-html')).html())
const XML = parsed('XML', async () => (await import('@codemirror/lang-xml')).xml())
const PYTHON = parsed('Python', async () => (await import('@codemirror/lang-python')).python())
const MARKDOWN = parsed('Markdown', async () => (await import('@codemirror/lang-markdown')).markdown())
const RUST = parsed('Rust', async () => (await import('@codemirror/lang-rust')).rust())
const CPP = parsed('C++', async () => (await import('@codemirror/lang-cpp')).cpp())
const JAVA = parsed('Java', async () => (await import('@codemirror/lang-java')).java())
const PHP = parsed('PHP', async () => (await import('@codemirror/lang-php')).php())
const SQL = parsed('SQL', async () => (await import('@codemirror/lang-sql')).sql())
const YAML = parsed('YAML', async () => (await import('@codemirror/lang-yaml')).yaml())
const GO = parsed('Go', async () => (await import('@codemirror/lang-go')).go())
const VUE = parsed('Vue', async () => (await import('@codemirror/lang-vue')).vue())
// indented: true is what makes this Sass; the option defaults to SCSS syntax.
const SASS = parsed('Sass', async () => (await import('@codemirror/lang-sass')).sass({ indented: true }))
const SCSS = parsed('SCSS', async () => (await import('@codemirror/lang-sass')).sass({ indented: false }))
const LESS = parsed('Less', async () => (await import('@codemirror/lang-less')).less())

/* ---------- Legacy stream modes: highlighting only ---------- */

const clike = (name: string, key: 'c' | 'csharp' | 'scala' | 'kotlin' | 'objectiveC' | 'objectiveCpp' | 'dart'): CodeLang =>
  lexed(name, async () => (await import('@codemirror/legacy-modes/mode/clike'))[key])

const C = clike('C', 'c')
const CSHARP = clike('C#', 'csharp')
const SCALA = clike('Scala', 'scala')
const KOTLIN = clike('Kotlin', 'kotlin')
const OBJC = clike('Objective-C', 'objectiveC')
const OBJCPP = clike('Objective-C++', 'objectiveCpp')
const DART = clike('Dart', 'dart')

const SHELL = lexed('Shell', async () => (await import('@codemirror/legacy-modes/mode/shell')).shell)
const POWERSHELL = lexed('PowerShell', async () => (await import('@codemirror/legacy-modes/mode/powershell')).powerShell)
const RUBY = lexed('Ruby', async () => (await import('@codemirror/legacy-modes/mode/ruby')).ruby)
const LUA = lexed('Lua', async () => (await import('@codemirror/legacy-modes/mode/lua')).lua)
const SWIFT = lexed('Swift', async () => (await import('@codemirror/legacy-modes/mode/swift')).swift)
const PERL = lexed('Perl', async () => (await import('@codemirror/legacy-modes/mode/perl')).perl)
const R = lexed('R', async () => (await import('@codemirror/legacy-modes/mode/r')).r)
const JULIA = lexed('Julia', async () => (await import('@codemirror/legacy-modes/mode/julia')).julia)
const HASKELL = lexed('Haskell', async () => (await import('@codemirror/legacy-modes/mode/haskell')).haskell)
const CLOJURE = lexed('Clojure', async () => (await import('@codemirror/legacy-modes/mode/clojure')).clojure)
const ERLANG = lexed('Erlang', async () => (await import('@codemirror/legacy-modes/mode/erlang')).erlang)
const ELM = lexed('Elm', async () => (await import('@codemirror/legacy-modes/mode/elm')).elm)
const TOML = lexed('TOML', async () => (await import('@codemirror/legacy-modes/mode/toml')).toml)
const PROPERTIES = lexed('Properties', async () => (await import('@codemirror/legacy-modes/mode/properties')).properties)
const DOCKERFILE = lexed('Dockerfile', async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile)
const NGINX = lexed('Nginx', async () => (await import('@codemirror/legacy-modes/mode/nginx')).nginx)
const DIFF = lexed('Diff', async () => (await import('@codemirror/legacy-modes/mode/diff')).diff)
const PROTOBUF = lexed('Protobuf', async () => (await import('@codemirror/legacy-modes/mode/protobuf')).protobuf)
const GROOVY = lexed('Groovy', async () => (await import('@codemirror/legacy-modes/mode/groovy')).groovy)
const PASCAL = lexed('Pascal', async () => (await import('@codemirror/legacy-modes/mode/pascal')).pascal)
const FORTRAN = lexed('Fortran', async () => (await import('@codemirror/legacy-modes/mode/fortran')).fortran)
const TCL = lexed('Tcl', async () => (await import('@codemirror/legacy-modes/mode/tcl')).tcl)
const VB = lexed('Visual Basic', async () => (await import('@codemirror/legacy-modes/mode/vb')).vb)
const VERILOG = lexed('Verilog', async () => (await import('@codemirror/legacy-modes/mode/verilog')).verilog)
const VHDL = lexed('VHDL', async () => (await import('@codemirror/legacy-modes/mode/vhdl')).vhdl)
const OCAML = lexed('OCaml', async () => (await import('@codemirror/legacy-modes/mode/mllike')).oCaml)
const FSHARP = lexed('F#', async () => (await import('@codemirror/legacy-modes/mode/mllike')).fSharp)
const LATEX = lexed('LaTeX', async () => (await import('@codemirror/legacy-modes/mode/stex')).stex)
const CMAKE = lexed('CMake', async () => (await import('@codemirror/legacy-modes/mode/cmake')).cmake)
const STYLUS = lexed('Stylus', async () => (await import('@codemirror/legacy-modes/mode/stylus')).stylus)
const SCHEME = lexed('Scheme', async () => (await import('@codemirror/legacy-modes/mode/scheme')).scheme)
const LISP = lexed('Common Lisp', async () => (await import('@codemirror/legacy-modes/mode/commonlisp')).commonLisp)
const GAS = lexed('Assembly', async () => (await import('@codemirror/legacy-modes/mode/gas')).gas)
const CRYSTAL = lexed('Crystal', async () => (await import('@codemirror/legacy-modes/mode/crystal')).crystal)

/* ---------- The map ---------- */

const BY_EXT: Record<string, CodeLang> = {
  '.js': JS, '.mjs': JS, '.cjs': JS, '.jsx': JSX,
  '.ts': TS, '.mts': TS, '.cts': TS, '.tsx': TSX,
  '.json': JSON_, '.jsonc': JSON_, '.json5': JSON_, '.ipynb': JSON_,
  '.css': CSS, '.scss': SCSS, '.sass': SASS, '.less': LESS, '.styl': STYLUS,
  '.html': HTML, '.xhtml': HTML, '.svelte': HTML, '.astro': HTML, '.vue': VUE,
  '.xml': XML, '.svg': XML, '.svgz': XML,
  '.py': PYTHON, '.pyw': PYTHON,
  '.md': MARKDOWN, '.markdown': MARKDOWN, '.rst': MARKDOWN, '.adoc': MARKDOWN,
  '.rs': RUST, '.zig': RUST,
  '.cpp': CPP, '.cxx': CPP, '.cc': CPP, '.hpp': CPP, '.hh': CPP, '.hxx': CPP,
  '.c': C, '.h': C,
  '.m': OBJC, '.mm': OBJCPP,
  '.java': JAVA, '.gradle': GROOVY, '.groovy': GROOVY,
  '.kt': KOTLIN, '.kts': KOTLIN, '.scala': SCALA, '.dart': DART, '.cs': CSHARP,
  '.php': PHP,
  '.sql': SQL,
  '.yml': YAML, '.yaml': YAML,
  '.go': GO,
  '.rb': RUBY, '.cr': CRYSTAL,
  '.lua': LUA, '.swift': SWIFT,
  '.pl': PERL, '.pm': PERL,
  '.r': R, '.jl': JULIA, '.hs': HASKELL,
  '.clj': CLOJURE, '.cljs': CLOJURE, '.scm': SCHEME, '.lisp': LISP, '.el': LISP,
  '.erl': ERLANG, '.ex': ERLANG, '.exs': ERLANG, '.elm': ELM,
  '.ml': OCAML, '.mli': OCAML, '.fs': FSHARP, '.fsx': FSHARP,
  '.sh': SHELL, '.bash': SHELL, '.zsh': SHELL, '.fish': SHELL,
  '.ps1': POWERSHELL, '.psm1': POWERSHELL, '.bat': POWERSHELL, '.cmd': POWERSHELL,
  '.toml': TOML, '.tf': TOML, '.tfvars': TOML, '.nix': TOML,
  '.ini': PROPERTIES, '.cfg': PROPERTIES, '.conf': NGINX, '.properties': PROPERTIES,
  '.env': PROPERTIES, '.editorconfig': PROPERTIES,
  '.diff': DIFF, '.patch': DIFF,
  '.proto': PROTOBUF, '.graphql': PROTOBUF, '.gql': PROTOBUF,
  '.pas': PASCAL, '.f90': FORTRAN, '.tcl': TCL, '.vb': VB,
  '.v': VERILOG, '.sv': VERILOG, '.vhd': VHDL, '.vhdl': VHDL,
  '.asm': GAS, '.s': GAS,
  '.tex': LATEX,
  '.mk': CMAKE, '.cmake': CMAKE
}

// Whole-name matches, for the files that carry their language in the filename.
const BY_NAME: Record<string, CodeLang> = {
  dockerfile: DOCKERFILE,
  containerfile: DOCKERFILE,
  makefile: CMAKE,
  gnumakefile: CMAKE,
  'cmakelists.txt': CMAKE,
  rakefile: RUBY,
  gemfile: RUBY,
  brewfile: RUBY,
  vagrantfile: RUBY,
  jenkinsfile: GROOVY,
  '.gitignore': PROPERTIES,
  '.gitattributes': PROPERTIES,
  '.npmrc': PROPERTIES,
  '.editorconfig': PROPERTIES,
  '.env': PROPERTIES,
  '.prettierrc': JSON_,
  '.eslintrc': JSON_,
  '.babelrc': JSON_
}

/**
 * The language for a file, or null when Prism has nothing to colour it with.
 * Null is a real answer, not a failure: prose (`.txt`, `.log`) is meant to be
 * plain, and an unmapped extension reads better uncoloured than mis-coloured.
 */
export function langFor(name: string): CodeLang | null {
  const n = name.toLowerCase()
  const byName = BY_NAME[n]
  if (byName) return byName
  const ext = /\.[^.]*$/.exec(n)?.[0] ?? ''
  return BY_EXT[ext] ?? null
}

/** Files shown as prose: no gutter, no folding, no language. */
export function isProse(name: string): boolean {
  return /\.(txt|log|csv|srt|vtt)$/i.test(name) || langFor(name) === null
}
