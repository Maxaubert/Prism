!include "LogicLib.nsh"

!macro PRISM_STOP_WIN_E COMMAND
  ${If} ${FileExists} "$INSTDIR\resources\win-e\PrismShortcut.exe"
    nsExec::ExecToLog /TIMEOUT=15000 '"$INSTDIR\resources\win-e\PrismShortcut.exe" ${COMMAND}'
    Pop $0
    ${If} $0 != 0
      ; Do not copy over or delete a helper which has not finished shutting down.
      Abort "Prism's Win+E helper could not stop. Please try again, or turn off Open Prism with Win+E in General settings first."
    ${EndIf}
  ${EndIf}
!macroend

; A real uninstall removes the owned Run entry. Electron-builder also invokes
; the old uninstaller during upgrades, where the opt-in must be preserved.
!macro PRISM_UNREGISTER_WIN_E
  ${If} ${isUpdated}
    !insertmacro PRISM_STOP_WIN_E "--stop-own"
  ${Else}
    !insertmacro PRISM_STOP_WIN_E "--uninstall"
  ${EndIf}
!macroend
