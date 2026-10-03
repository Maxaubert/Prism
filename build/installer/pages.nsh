;
; Prism setup, part three: the five screens.
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
  Page custom prismLicenceCreate prismLicenceLeave
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
  !insertmacro PRISM_INSTALL_INDEXER
  ; the licence the user accepted, kept next to the app so the terms are always
  ; findable. Silent installs get it too: they skip the screen, not the terms.
  ; The uninstaller's half is in assoc.nsh (customUnInstall).
  SetOutPath "$INSTDIR"
  File "/oname=LICENSE.txt" "${PROJECT_DIR}\LICENSE"
  ; LICENSE section 4 points here, so it has to be a file a user can open
  File "/oname=THIRD-PARTY-NOTICES.md" "${PROJECT_DIR}\THIRD-PARTY-NOTICES.md"
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
  ; Back runs no leave function, so the page we came from may still hold its
  ; canvas: the bitmaps, the DC and the GDI+ images, which keep their PNGs
  ; locked. Free it here so nothing leaks and nothing stays locked (Wind #263).
  ; PrismCanvasFree zeroes its handles, so after a Next this does nothing.
  Call PrismCanvasFree
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
  ; once per run: Back returns here, and the art is already unpacked (writing
  ; it again would fail on a file a canvas still had open, Wind #263)
  ${If} $ArtDir == ""
    InitPluginsDir
    !insertmacro UNPACK_MEDIA
  ${EndIf}
  StrCpy $Screen 0
  ; what the finish screen offers, and what it offers by default
  StrCpy $RunAfter 1
  StrCpy $WantMenu 1
  StrCpy $WantDesk 0
  Call prismPageStart
  nsDialogs::Show
FunctionEnd

; ---- 1b. licence -------------------------------------------------------------
; The terms are summarised on the screen and the full text is one click away;
; the box has to be ticked before Continue does anything. A silent install (/S)
; skips this page like every other one (prismPageStart aborts): whoever runs
; setup silently is deploying it deliberately, and LICENSE.txt lands next to
; Prism either way. $Accepted is never reset, so going Back to Welcome and on
; again keeps the tick. It starts empty, which every test of it reads as "not
; yet".
Function prismLicenceCreate
  StrCpy $Screen 4
  Call prismPageStart
  nsDialogs::Show
FunctionEnd

Function prismLicenceLeave
  ; Continue is dead until the box is ticked, so this only guards against
  ; anything that reaches Next another way (Enter, a stray WM_COMMAND). Abort
  ; keeps the page up, and the canvas and its timer with it; $Leaving goes back
  ; to 0 so the tick keeps drawing. Back never comes through here: NSIS does
  ; not call a page's leave function on Back.
  ${If} $Accepted <> 1
    StrCpy $Leaving 0
    Abort
  ${EndIf}
  Call prismPageLeave
FunctionEnd

; Opens the licence in the user's own viewer, through explorer.exe, so it is
; whatever opens a .txt on this machine and it never inherits setup's token.
; NOT from $PLUGINSDIR (Wind hit this, its #258): an elevated NSIS locks that
; folder to Administrators, and the viewer explorer starts is not elevated, so
; it was refused and nothing opened. Prism's setup asks for no elevation, but
; the rule costs nothing and keeps it true if that ever changes.
; GetTempFileName makes a fresh, uniquely named entry in the user's own temp
; folder; turned into a folder, it inherits the user's access and nobody can
; have planted anything at that name beforehand.
Function PrismOpenLicence
  ${If} $LicenceDir == ""
    GetTempFileName $LicenceDir
    Delete $LicenceDir
    CreateDirectory $LicenceDir
    SetOutPath $LicenceDir
    File "/oname=LICENSE.txt" "${PROJECT_DIR}\LICENSE"
  ${EndIf}
  Exec '"$WINDIR\explorer.exe" "$LicenceDir\LICENSE.txt"'
FunctionEnd

; Tidies the viewer's copy when setup closes. A viewer reads the whole file on
; open, so one still showing it is unaffected; RMDir without /r only removes
; the folder once it is empty. Neither MUI nor electron-builder's template
; defines .onGUIEnd, and this file is never compiled into the uninstaller.
Function .onGUIEnd
  ${If} $LicenceDir != ""
    ; SetOutPath also made that folder setup's working directory, which Windows
    ; will not remove while it is one (a Cancel straight after reading leaves it
    ; there), so step out of it first
    SetOutPath $TEMP
    Delete "$LicenceDir\LICENSE.txt"
    RMDir $LicenceDir
  ${EndIf}
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
