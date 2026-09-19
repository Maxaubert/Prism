; The app stays per-user. Only the private NTFS metadata service requests UAC.
; Declining that prompt leaves the bundled unprivileged folder index available.
!macro PRISM_INSTALL_INDEXER
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\everything\service.ps1" -Action Install -InstallDirectory "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Prism fast NTFS indexing was not enabled. Folder indexing remains available."
  ${EndIf}
!macroend

!macro PRISM_UNINSTALL_INDEXER
  IfFileExists "$INSTDIR\resources\everything\service.ps1" 0 prism_indexer_done
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\everything\service.ps1" -Action StopClient -InstallDirectory "$INSTDIR"'
  Pop $0
  ; Upgrades preserve the protected service and avoid repeated UAC prompts.
  ${IfNot} ${isUpdated}
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\everything\service.ps1" -Action Uninstall -InstallDirectory "$INSTDIR"'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Prism could not remove its search service. Uninstall was stopped so its files are not left behind. Please allow administrator approval and try again." /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}
  prism_indexer_done:
!macroend
