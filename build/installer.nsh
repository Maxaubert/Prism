;
; Prism setup.
;
; The window is already playing something, and setup is the type over it. There
; is no title bar and there are no controls: each screen is a video frame with an
; alpha overlay composited on top, and the pointer is hit-tested by hand.
;
; Rebuild the media after changing over.html or the source clip:
;   npx electron build/installer/make-over.cjs 1440
;   npx electron build/installer/make-over.cjs 960
;   node build/installer/make-loop.cjs <clip.mp4>
;

!macro customHeader
  ; Windows must not stretch us: at 150% we load the 2x art instead.
  ManifestDPIAware true
!macroend

; The uninstaller is compiled from this same script with BUILD_UNINSTALLER set,
; and it has none of these pages. Without the guard its pass would resize a
; window it never draws, and warn about every function it does not call.
!ifndef BUILD_UNINSTALLER
  !include "installer\kit.nsh"     ; the window
  !include "installer\video.nsh"   ; the picture, and every click in it
  !include "installer\pages.nsh"   ; the four screens
!endif

; Registering the file types has nothing to do with the pages, and the
; uninstaller needs the other half of it.
!include "installer\assoc.nsh"
