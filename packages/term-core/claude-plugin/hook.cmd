@echo off
rem PRISM TERMINAL READS THE AGENT STATE FROM THIS (#131). Claude Code runs it for
rem the events in hooks\hooks.json and writes the terminalSequence it prints into
rem its OWN terminal, so the sequence reaches that tab and nothing else. A static
rem echo and no node: blocking events wait for it (MEASURED 20 to 100 ms).
rem The arguments are fixed words from hooks.json: a state, then the error kind
rem of a failure, or +sid. Nothing from stdin is read or repeated.
rem hooks.json starts it as cmd.exe /d /c call <this file> (exec form, no
rem shell): a command STRING runs through PowerShell where Git Bash is
rem missing, which cannot parse a quoted path and an argument (MEASURED).
rem
rem +sid (the catch-up report, 2026-10-16): the turn's own hooks also name the
rem Claude session, so the app knows which transcript is this tab's. The id is
rem Claude's CLAUDE_CODE_SESSION_ID (MEASURED: the transcript's file name). It
rem is read with DELAYED expansion, which is inert to & | < > ^ ) and quotes,
rem and printed only when it is 36 characters of 0-9 a-f and -; anything else
rem is left out and the state is printed as before, so an odd value never
rem costs the tab its indicator.
setlocal EnableDelayedExpansion
set "PT_ID="
if "%~2"=="+sid" call :sid
if defined PT_ID (
  echo {"terminalSequence":"\u001b]777;prism-agent;state=%~1;session=!PT_ID!\u0007"}
) else if "%~2"=="" (
  echo {"terminalSequence":"\u001b]777;prism-agent;state=%~1\u0007"}
) else if "%~2"=="+sid" (
  echo {"terminalSequence":"\u001b]777;prism-agent;state=%~1\u0007"}
) else (
  echo {"terminalSequence":"\u001b]777;prism-agent;state=%~1;kind=%~2\u0007"}
)
exit /b 0

:sid
set "PT_V=!CLAUDE_CODE_SESSION_ID!"
if not defined PT_V exit /b 0
if "!PT_V:~35,1!"=="" exit /b 0
if not "!PT_V:~36,1!"=="" exit /b 0
rem "x" first, so a value starting with the eol character is still read. The
rem valid id is all delimiters: "x" is then the only token.
set "PT_A="
set "PT_B="
for /f "tokens=1,2 delims=0123456789abcdef-" %%a in ("x!PT_V!") do (
  set "PT_A=%%a"
  set "PT_B=%%b"
)
if not "!PT_A!"=="x" exit /b 0
if defined PT_B exit /b 0
set "PT_ID=!PT_V!"
exit /b 0
