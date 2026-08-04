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

  ; the same lists src/shared/fileKind.ts calls viewable, minus source code:
  ; a .ts or .css belongs to an editor, and Prism still opens either on request
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

  !insertmacro PRISM_EXT "txt"  "Prism.Text"
  !insertmacro PRISM_EXT "md"   "Prism.Text"
  !insertmacro PRISM_EXT "markdown" "Prism.Text"
  !insertmacro PRISM_EXT "csv"  "Prism.Text"
  !insertmacro PRISM_EXT "log"  "Prism.Text"

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
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend
