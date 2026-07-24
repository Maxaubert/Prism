@echo off
REM Serve the visualizer lab on localhost and open it.
REM Needed because a page opened straight from the file system cannot fetch the
REM demo track, and Web Audio refuses to analyse media it considers cross-origin.
cd /d "%~dp0"
start "" http://localhost:8777/
python -m http.server 8777
