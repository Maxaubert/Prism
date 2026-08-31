;
; Prism setup, part three: the four screens.
;
; Each page is the same thing: an empty dialog, the canvas from video.nsh, and a
; timer. What differs is $Screen, which picks the overlay and decides what the
; clicks mean. There is not a single button control in this file.
;
; The default-viewer question is deliberately absent. Setup asks it once, in the
; app's own first-run guide, and Settings > General keeps it afterwards. An
; installer that registers file types on its way past is the behaviour Prism is
; meant to be an answer to.
;

; ---- page order --------------------------------------------------------------
!macro customWelcomePage
  Page custom prismWelcomeCreate prismPageLeave
!macroend

!macro customPageAfterChangeDir
  Page custom prismWhereCreate prismWhereLeave
  ; this lands immediately before MUI_PAGE_INSTFILES, which is the only way to
  ; hand that page a SHOW function without an earlier page swallowing it
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW prismCopyShow
!macroend

!macro customFinishPage
  Page custom prismDoneCreate prismDoneLeave
!macroend

; When the section ends, autoclose walks on to the finish page by itself: the
; Next button it would otherwise wait for has been hidden since .onGUIInit.
!macro customInstall
  ; Offer Prism for every type it can show. Offering is all Windows permits: the
  ; default itself is the user's to give, in Settings, one click per type.
  !insertmacro PRISM_REGISTER_TYPES
  SetAutoClose true
!macroend

; customUnInstall lives in assoc.nsh: this file is not compiled into the
; uninstaller, so a macro defined here is one the uninstaller never has.

; Prism installs for whoever runs it and has no other mode, so the "anyone who
; uses this computer / only me" page has nothing to ask. Answering it here makes
; it skip itself before it is ever drawn.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; ---- shared ------------------------------------------------------------------
Function prismPageStart
  ; A silent install still calls a custom page's creator, and nsDialogs::Show
  ; with nothing to show never returns: /S used to hang here forever. Abort in
  ; a creator means "skip this page", which is exactly right.
  ${If} ${Silent}
    Abort
  ${EndIf}
  !insertmacro HIDE_WIZARD_BUTTONS
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}
  Push $Dialog
  Call PrismCanvas
  Call PrismPickOverlay
  Call PrismDraw
  ${NSD_CreateTimer} PrismTick ${TICK}
FunctionEnd

Function prismPageLeave
  ${NSD_KillTimer} PrismTick
  Call PrismCanvasFree
FunctionEnd

; Prism gets a folder of its own wherever it is put: nobody means "empty your
; Documents folder into this" when they pick Documents.
Function prismOwnFolder
  StrLen $0 "${APP_FILENAME}"
  StrCpy $1 "$INSTDIR" "" -$0
  ${If} $1 != "${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

; called from PrismClick, which is parsed before this file
Function PrismBrowse
  nsDialogs::SelectFolderDialog "Choose where Prism goes" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    StrCpy $INSTDIR "$0"
    Call prismOwnFolder
  ${EndIf}
FunctionEnd

; ---- 1. welcome --------------------------------------------------------------
Function prismWelcomeCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  InitPluginsDir
  !insertmacro UNPACK_MEDIA
  StrCpy $Screen 0
  ; what the finish screen offers, and what it offers by default
  StrCpy $RunAfter 1
  StrCpy $WantMenu 1
  StrCpy $WantDesk 0
  Call prismPageStart
  nsDialogs::Show
FunctionEnd

; ---- 2. where it goes --------------------------------------------------------
Function prismWhereCreate
  StrCpy $Screen 1
  Call prismPageStart
  nsDialogs::Show
FunctionEnd

Function prismWhereLeave
  Call prismPageLeave
  Call prismOwnFolder
FunctionEnd

; ---- 3. copying --------------------------------------------------------------
; MUI owns this page, and the section runs on the script thread, so nothing can
; call back into script while files are being written. This screen therefore
; draws one frame and hands the motion over to the progress bar, which Windows
; paints for us.
Function prismCopyShow
  ${If} ${Silent}
    Return
  ${EndIf}
  FindWindow $R4 "#32770" "" $HWNDPARENT
  GetDlgItem $R5 $R4 1004   ; progress bar
  GetDlgItem $0 $R4 1006    ; status line, which prints nothing here
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $R4 1016    ; the log
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $R4 1027    ; "show details"
  ShowWindow $0 ${SW_HIDE}
  !insertmacro HIDE_WIZARD_BUTTONS

  ; MUI sizes this dialog from its own template, which is smaller than our window
  IntOp $R2 ${ART_W} * $Dpi
  IntOp $R2 $R2 / 96
  IntOp $R3 ${ART_H} * $Dpi
  IntOp $R3 $R3 / 96
  System::Call 'user32::SetWindowPos(p $R4, p 0, i 0, i 0, i $R2, i $R3, i 0x14)'

  StrCpy $Screen 2
  Push $R4
  Call PrismCanvas
  StrCpy $Frame 30          ; the frame the bloom looks best on
  Call PrismPickOverlay
  Call PrismDraw

  ; the progress bar: theme off, smooth on, Prism's indigo, sat on the drawn
  ; trough and raised above the canvas
  System::Call 'uxtheme::SetWindowTheme(p $R5, w "", w "")'
  System::Call 'user32::GetWindowLong(p $R5, i -16) i .r0'
  IntOp $0 $0 | 0x01        ; PBS_SMOOTH
  System::Call 'user32::SetWindowLong(p $R5, i -16, i $0)'
  SendMessage $R5 ${PBM_SETBKCOLOR} 0 0x3D2F2B
  SendMessage $R5 ${PBM_SETBARCOLOR} 0 0xD65B5B
  !insertmacro OAT COPY_TRACK
  System::Call 'user32::SetWindowPos(p $R5, p 0, i $R0, i $R1, i $R2, i $R3, i 0x10)'
FunctionEnd

; ---- 4. ready ----------------------------------------------------------------
Function prismDoneCreate
  StrCpy $Screen 3
  Call prismPageStart
  nsDialogs::Show
FunctionEnd

Function prismDoneLeave
  Call prismPageLeave

  ; The install section always writes the start menu shortcut, so declining it
  ; here means taking it back off; the desktop one is only ever ours to make.
  ${If} $WantMenu = 0
    Delete "$SMPROGRAMS\${PRODUCT_FILENAME}.lnk"
  ${EndIf}
  ${If} $WantDesk = 1
    CreateShortcut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}

  ${If} $RunAfter = 1
    ; Plain Exec, not StdUtils' run-as-user: setup asks for no elevation and
    ; never gets any, so it is already the user. PRODUCT_FILENAME rather than
    ; APP_EXECUTABLE_FILENAME, which is declared after this file parses.
    ; --setup so a fresh install lands in the first-run guide, even on a machine
    ; that has already been through it once
    Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe" --setup'
  ${EndIf}
FunctionEnd
