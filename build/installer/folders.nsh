!include "LogicLib.nsh"

; "Open folders from other apps" (#393, src/main/folderHandler.ts). The helper
; registered PrismBrowse as the default verb of Directory and Drive (HKCU) and
; kept the default it replaced as PreviousDefault on that key. A real uninstall
; puts that back exactly and removes the launcher copied outside the install
; folder. An upgrade keeps all of it, so folders never fall back to File
; Explorer while Prism is being replaced; the new build's startup repair
; refreshes the copy. Done here in NSIS, not by the helper, so a missing or
; broken helper can never leave Windows' folder handler pointing at nothing.
!macro PRISM_UNREGISTER_FOLDER_CLASS CLASS
  ClearErrors
  ReadRegStr $0 HKCU "Software\Classes\${CLASS}\shell" ""
  ${If} $0 == "PrismBrowse"
    ClearErrors
    ReadRegStr $1 HKCU "Software\Classes\${CLASS}\shell\PrismBrowse" "PreviousDefault"
    ${If} ${Errors}
      DeleteRegValue HKCU "Software\Classes\${CLASS}\shell" ""
    ${Else}
      WriteRegStr HKCU "Software\Classes\${CLASS}\shell" "" $1
    ${EndIf}
  ${EndIf}
  ; Another app's default is left alone; only Prism's own key goes.
  DeleteRegKey HKCU "Software\Classes\${CLASS}\shell\PrismBrowse"
!macroend

!macro PRISM_UNREGISTER_FOLDERS
  ${IfNot} ${isUpdated}
    !insertmacro PRISM_UNREGISTER_FOLDER_CLASS "Directory"
    !insertmacro PRISM_UNREGISTER_FOLDER_CLASS "Drive"
    Delete "$LOCALAPPDATA\PrismFolders\PrismShortcut.exe"
    Delete "$LOCALAPPDATA\PrismFolders\PrismShortcut.exe.old-*"
    RMDir "$LOCALAPPDATA\PrismFolders"
    System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
