;
; File types.
;
; Prism registers itself as a handler for everything it can show, and stops
; there. It does NOT write the default for any extension, for two reasons: the
; product rule is that defaults are never taken silently, and Windows would not
; honour it anyway. Since Windows 8 the choice lives in a UserChoice key signed
; with a per-user hash, and an app that forges it is doing what malware does.
;
; What this buys, which is everything that is actually available:
;   - Prism appears in "Open with" for each type it understands
;   - Prism appears in Settings > Default apps as an application, with its file
;     types listed, so each one is a single click
;   - Settings > General deep links straight to that page
;
; SHELL_CONTEXT is HKCU here: Prism installs per user and never per machine.
;

!define PRISM_CAPS "Software\Prism\Capabilities"

; One class per kind, rather than one per extension: the Open With menu then
; says "Prism" once instead of listing thirty near-identical entries.
!macro PRISM_PROGID ID DESC
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}" "" "${DESC}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\shell\open" "" "Open with ${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${ID}\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'
!macroend

; Offered, never taken: OpenWithProgids adds Prism to the list of candidates,
; and the Capabilities entry is what makes Default apps list the type at all.
; The extension's default value is deliberately left alone.
!macro PRISM_EXT EXT ID
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${ID}"
  WriteRegStr SHELL_CONTEXT "${PRISM_CAPS}\FileAssociations" ".${EXT}" "${ID}"
  ; The other half of being offered. OpenWithProgids gets Prism into the Open
  ; With list; SupportedTypes under Applications\<exe> is what the "Choose
  ; another app" dialog and parts of Default apps read, and without it a type
  ; can look registered and still refuse to take.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_FILENAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

!macro PRISM_UNEXT EXT ID
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${ID}"
!macroend

!macro PRISM_REGISTER_TYPES
  !insertmacro PRISM_PROGID "Prism.Image" "Image"
  !insertmacro PRISM_PROGID "Prism.Video" "Video"
  !insertmacro PRISM_PROGID "Prism.Audio" "Audio"
  !insertmacro PRISM_PROGID "Prism.Document" "Document"
  !insertmacro PRISM_PROGID "Prism.Text" "Text file"

  ; The same lists src/shared/fileKind.ts calls viewable - ALL of them. Code
  ; and config types were excluded once ("a .ts belongs to an editor"), but the
  ; decision was reversed (2026-08-12, #45): being offered costs nothing, the
  ; default is still never taken, and Prism edits text now anyway.
  ;
  ; This list and fileKind.ts must stay in step, and they did not: the code
  ; viewer added 96 extensions here that were never registered, so Prism opened
  ; a .py and never showed up in its "Open with". A comment claiming parity did
  ; not stop that, so src/shared/fileAssoc.test.ts now checks it and names the
  ; extensions to add. Add a type to fileKind, add it here, or the suite fails.
  ;
  ; Extension-based only, so the bare names fileKind also matches (Dockerfile,
  ; Makefile, LICENSE) and the dotfiles (.gitignore) cannot appear: Windows
  ; associates on extension and those have none.
  !insertmacro PRISM_EXT "png"  "Prism.Image"
  !insertmacro PRISM_EXT "jpg"  "Prism.Image"
  !insertmacro PRISM_EXT "jpeg" "Prism.Image"
  !insertmacro PRISM_EXT "gif"  "Prism.Image"
  !insertmacro PRISM_EXT "webp" "Prism.Image"
  !insertmacro PRISM_EXT "bmp"  "Prism.Image"
  !insertmacro PRISM_EXT "svg"  "Prism.Image"
  !insertmacro PRISM_EXT "avif" "Prism.Image"
  !insertmacro PRISM_EXT "jxl"  "Prism.Image"
  !insertmacro PRISM_EXT "tiff" "Prism.Image"
  !insertmacro PRISM_EXT "tif"  "Prism.Image"
  !insertmacro PRISM_EXT "ico"  "Prism.Image"
  !insertmacro PRISM_EXT "heic" "Prism.Image"
  !insertmacro PRISM_EXT "heif" "Prism.Image"

  !insertmacro PRISM_EXT "mp4"  "Prism.Video"
  !insertmacro PRISM_EXT "m4v"  "Prism.Video"
  !insertmacro PRISM_EXT "webm" "Prism.Video"
  !insertmacro PRISM_EXT "ogv"  "Prism.Video"
  !insertmacro PRISM_EXT "mov"  "Prism.Video"
  !insertmacro PRISM_EXT "mkv"  "Prism.Video"
  !insertmacro PRISM_EXT "avi"  "Prism.Video"

  !insertmacro PRISM_EXT "mp3"  "Prism.Audio"
  !insertmacro PRISM_EXT "m4a"  "Prism.Audio"
  !insertmacro PRISM_EXT "aac"  "Prism.Audio"
  !insertmacro PRISM_EXT "ogg"  "Prism.Audio"
  !insertmacro PRISM_EXT "opus" "Prism.Audio"
  !insertmacro PRISM_EXT "flac" "Prism.Audio"
  !insertmacro PRISM_EXT "wav"  "Prism.Audio"

  !insertmacro PRISM_EXT "pdf"  "Prism.Document"

  ; prose and data
  !insertmacro PRISM_EXT "txt"      "Prism.Text"
  !insertmacro PRISM_EXT "md"       "Prism.Text"
  !insertmacro PRISM_EXT "markdown" "Prism.Text"
  !insertmacro PRISM_EXT "rst"      "Prism.Text"
  !insertmacro PRISM_EXT "adoc"     "Prism.Text"
  !insertmacro PRISM_EXT "tex"      "Prism.Text"
  !insertmacro PRISM_EXT "csv"      "Prism.Text"
  !insertmacro PRISM_EXT "log"      "Prism.Text"
  !insertmacro PRISM_EXT "srt"      "Prism.Text"
  !insertmacro PRISM_EXT "vtt"      "Prism.Text"
  !insertmacro PRISM_EXT "diff"     "Prism.Text"
  !insertmacro PRISM_EXT "patch"    "Prism.Text"

  ; web
  !insertmacro PRISM_EXT "html"     "Prism.Text"
  !insertmacro PRISM_EXT "xhtml"    "Prism.Text"
  !insertmacro PRISM_EXT "css"      "Prism.Text"
  !insertmacro PRISM_EXT "scss"     "Prism.Text"
  !insertmacro PRISM_EXT "sass"     "Prism.Text"
  !insertmacro PRISM_EXT "less"     "Prism.Text"
  !insertmacro PRISM_EXT "styl"     "Prism.Text"
  !insertmacro PRISM_EXT "vue"      "Prism.Text"
  !insertmacro PRISM_EXT "svelte"   "Prism.Text"
  !insertmacro PRISM_EXT "astro"    "Prism.Text"
  !insertmacro PRISM_EXT "xml"      "Prism.Text"
  !insertmacro PRISM_EXT "svgz"     "Prism.Text"

  ; javascript and friends
  !insertmacro PRISM_EXT "js"       "Prism.Text"
  !insertmacro PRISM_EXT "mjs"      "Prism.Text"
  !insertmacro PRISM_EXT "cjs"      "Prism.Text"
  !insertmacro PRISM_EXT "jsx"      "Prism.Text"
  !insertmacro PRISM_EXT "ts"       "Prism.Text"
  !insertmacro PRISM_EXT "mts"      "Prism.Text"
  !insertmacro PRISM_EXT "cts"      "Prism.Text"
  !insertmacro PRISM_EXT "tsx"      "Prism.Text"
  !insertmacro PRISM_EXT "json"     "Prism.Text"
  !insertmacro PRISM_EXT "jsonc"    "Prism.Text"
  !insertmacro PRISM_EXT "json5"    "Prism.Text"
  !insertmacro PRISM_EXT "ipynb"    "Prism.Text"

  ; scripting
  !insertmacro PRISM_EXT "py"       "Prism.Text"
  !insertmacro PRISM_EXT "pyw"      "Prism.Text"
  !insertmacro PRISM_EXT "rb"       "Prism.Text"
  !insertmacro PRISM_EXT "php"      "Prism.Text"
  !insertmacro PRISM_EXT "pl"       "Prism.Text"
  !insertmacro PRISM_EXT "pm"       "Prism.Text"
  !insertmacro PRISM_EXT "lua"      "Prism.Text"
  !insertmacro PRISM_EXT "r"        "Prism.Text"
  !insertmacro PRISM_EXT "jl"       "Prism.Text"
  !insertmacro PRISM_EXT "tcl"      "Prism.Text"

  ; shells
  !insertmacro PRISM_EXT "sh"       "Prism.Text"
  !insertmacro PRISM_EXT "bash"     "Prism.Text"
  !insertmacro PRISM_EXT "zsh"      "Prism.Text"
  !insertmacro PRISM_EXT "fish"     "Prism.Text"
  !insertmacro PRISM_EXT "ps1"      "Prism.Text"
  !insertmacro PRISM_EXT "psm1"     "Prism.Text"
  !insertmacro PRISM_EXT "bat"      "Prism.Text"
  !insertmacro PRISM_EXT "cmd"      "Prism.Text"

  ; compiled
  !insertmacro PRISM_EXT "c"        "Prism.Text"
  !insertmacro PRISM_EXT "h"        "Prism.Text"
  !insertmacro PRISM_EXT "cc"       "Prism.Text"
  !insertmacro PRISM_EXT "cpp"      "Prism.Text"
  !insertmacro PRISM_EXT "cxx"      "Prism.Text"
  !insertmacro PRISM_EXT "hpp"      "Prism.Text"
  !insertmacro PRISM_EXT "hh"       "Prism.Text"
  !insertmacro PRISM_EXT "hxx"      "Prism.Text"
  !insertmacro PRISM_EXT "m"        "Prism.Text"
  !insertmacro PRISM_EXT "mm"       "Prism.Text"
  !insertmacro PRISM_EXT "cs"       "Prism.Text"
  !insertmacro PRISM_EXT "go"       "Prism.Text"
  !insertmacro PRISM_EXT "rs"       "Prism.Text"
  !insertmacro PRISM_EXT "zig"      "Prism.Text"
  !insertmacro PRISM_EXT "java"     "Prism.Text"
  !insertmacro PRISM_EXT "kt"       "Prism.Text"
  !insertmacro PRISM_EXT "kts"      "Prism.Text"
  !insertmacro PRISM_EXT "scala"    "Prism.Text"
  !insertmacro PRISM_EXT "swift"    "Prism.Text"
  !insertmacro PRISM_EXT "dart"     "Prism.Text"
  !insertmacro PRISM_EXT "groovy"   "Prism.Text"
  !insertmacro PRISM_EXT "vb"       "Prism.Text"
  !insertmacro PRISM_EXT "pas"      "Prism.Text"
  !insertmacro PRISM_EXT "f90"      "Prism.Text"
  !insertmacro PRISM_EXT "asm"      "Prism.Text"
  !insertmacro PRISM_EXT "s"        "Prism.Text"

  ; functional
  !insertmacro PRISM_EXT "hs"       "Prism.Text"
  !insertmacro PRISM_EXT "ex"       "Prism.Text"
  !insertmacro PRISM_EXT "exs"      "Prism.Text"
  !insertmacro PRISM_EXT "erl"      "Prism.Text"
  !insertmacro PRISM_EXT "clj"      "Prism.Text"
  !insertmacro PRISM_EXT "cljs"     "Prism.Text"
  !insertmacro PRISM_EXT "elm"      "Prism.Text"
  !insertmacro PRISM_EXT "fs"       "Prism.Text"
  !insertmacro PRISM_EXT "fsx"      "Prism.Text"
  !insertmacro PRISM_EXT "ml"       "Prism.Text"
  !insertmacro PRISM_EXT "mli"      "Prism.Text"

  ; hardware
  !insertmacro PRISM_EXT "v"        "Prism.Text"
  !insertmacro PRISM_EXT "sv"       "Prism.Text"
  !insertmacro PRISM_EXT "vhd"      "Prism.Text"
  !insertmacro PRISM_EXT "vhdl"     "Prism.Text"

  ; data and queries
  !insertmacro PRISM_EXT "sql"      "Prism.Text"
  !insertmacro PRISM_EXT "graphql"  "Prism.Text"
  !insertmacro PRISM_EXT "gql"      "Prism.Text"
  !insertmacro PRISM_EXT "proto"    "Prism.Text"

  ; config and build
  !insertmacro PRISM_EXT "yml"      "Prism.Text"
  !insertmacro PRISM_EXT "yaml"     "Prism.Text"
  !insertmacro PRISM_EXT "toml"     "Prism.Text"
  !insertmacro PRISM_EXT "ini"      "Prism.Text"
  !insertmacro PRISM_EXT "cfg"      "Prism.Text"
  !insertmacro PRISM_EXT "conf"     "Prism.Text"
  !insertmacro PRISM_EXT "properties" "Prism.Text"
  !insertmacro PRISM_EXT "env"      "Prism.Text"
  !insertmacro PRISM_EXT "editorconfig" "Prism.Text"
  !insertmacro PRISM_EXT "tf"       "Prism.Text"
  !insertmacro PRISM_EXT "tfvars"   "Prism.Text"
  !insertmacro PRISM_EXT "nix"      "Prism.Text"
  !insertmacro PRISM_EXT "gradle"   "Prism.Text"
  !insertmacro PRISM_EXT "cmake"    "Prism.Text"
  !insertmacro PRISM_EXT "mk"       "Prism.Text"


  ; the executable as an application in its own right, which is what the
  ; per-type "Choose another app" dialog looks up
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_FILENAME}.exe" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_FILENAME}.exe\DefaultIcon" "" "$INSTDIR\${PRODUCT_FILENAME}.exe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_FILENAME}.exe\shell\open" "FriendlyAppName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_FILENAME}.exe\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'

  ; and the entry that makes Windows list Prism as an application you can
  ; choose, which is the door the app's own Settings link opens
  WriteRegStr SHELL_CONTEXT "${PRISM_CAPS}" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${PRISM_CAPS}" "ApplicationDescription" \
    "A modern viewer for images, video, audio and documents."
  WriteRegStr SHELL_CONTEXT "${PRISM_CAPS}" "ApplicationIcon" "$INSTDIR\${PRODUCT_FILENAME}.exe,0"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${PRISM_CAPS}"
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend

!macro PRISM_UNREGISTER_TYPES
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
  DeleteRegKey SHELL_CONTEXT "Software\Prism"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${PRODUCT_FILENAME}.exe"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Prism.Image"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Prism.Video"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Prism.Audio"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Prism.Document"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Prism.Text"
  !insertmacro PRISM_UNEXT "png"  "Prism.Image"
  !insertmacro PRISM_UNEXT "jpg"  "Prism.Image"
  !insertmacro PRISM_UNEXT "jpeg" "Prism.Image"
  !insertmacro PRISM_UNEXT "gif"  "Prism.Image"
  !insertmacro PRISM_UNEXT "webp" "Prism.Image"
  !insertmacro PRISM_UNEXT "bmp"  "Prism.Image"
  !insertmacro PRISM_UNEXT "svg"  "Prism.Image"
  !insertmacro PRISM_UNEXT "avif" "Prism.Image"
  !insertmacro PRISM_UNEXT "jxl"  "Prism.Image"
  !insertmacro PRISM_UNEXT "tiff" "Prism.Image"
  !insertmacro PRISM_UNEXT "tif"  "Prism.Image"
  !insertmacro PRISM_UNEXT "ico"  "Prism.Image"
  !insertmacro PRISM_UNEXT "heic" "Prism.Image"
  !insertmacro PRISM_UNEXT "heif" "Prism.Image"
  !insertmacro PRISM_UNEXT "mp4"  "Prism.Video"
  !insertmacro PRISM_UNEXT "m4v"  "Prism.Video"
  !insertmacro PRISM_UNEXT "webm" "Prism.Video"
  !insertmacro PRISM_UNEXT "ogv"  "Prism.Video"
  !insertmacro PRISM_UNEXT "mov"  "Prism.Video"
  !insertmacro PRISM_UNEXT "mkv"  "Prism.Video"
  !insertmacro PRISM_UNEXT "avi"  "Prism.Video"
  !insertmacro PRISM_UNEXT "mp3"  "Prism.Audio"
  !insertmacro PRISM_UNEXT "m4a"  "Prism.Audio"
  !insertmacro PRISM_UNEXT "aac"  "Prism.Audio"
  !insertmacro PRISM_UNEXT "ogg"  "Prism.Audio"
  !insertmacro PRISM_UNEXT "opus" "Prism.Audio"
  !insertmacro PRISM_UNEXT "flac" "Prism.Audio"
  !insertmacro PRISM_UNEXT "wav"  "Prism.Audio"
  !insertmacro PRISM_UNEXT "pdf"  "Prism.Document"
  !insertmacro PRISM_UNEXT "txt"  "Prism.Text"
  !insertmacro PRISM_UNEXT "md"   "Prism.Text"
  !insertmacro PRISM_UNEXT "markdown" "Prism.Text"
  !insertmacro PRISM_UNEXT "csv"  "Prism.Text"
  !insertmacro PRISM_UNEXT "log"  "Prism.Text"
  !insertmacro PRISM_UNEXT "json" "Prism.Text"
  !insertmacro PRISM_UNEXT "js"   "Prism.Text"
  !insertmacro PRISM_UNEXT "ts"   "Prism.Text"
  !insertmacro PRISM_UNEXT "tsx"  "Prism.Text"
  !insertmacro PRISM_UNEXT "jsx"  "Prism.Text"
  !insertmacro PRISM_UNEXT "css"  "Prism.Text"
  !insertmacro PRISM_UNEXT "html" "Prism.Text"
  !insertmacro PRISM_UNEXT "xml"  "Prism.Text"
  !insertmacro PRISM_UNEXT "yml"  "Prism.Text"
  !insertmacro PRISM_UNEXT "yaml" "Prism.Text"
  !insertmacro PRISM_UNEXT "ini"  "Prism.Text"
  !insertmacro PRISM_UNEXT "srt"  "Prism.Text"
  !insertmacro PRISM_UNEXT "vtt"  "Prism.Text"
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend
