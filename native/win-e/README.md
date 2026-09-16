# Optional Win+E helper

`node tools/build-win-e.mjs` compiles the Windows GUI-subsystem executable using
the .NET Framework compiler shipped with Windows. There is no NuGet dependency.
The generated `vendor/win-e/PrismShortcut.exe` is packaged under `resources/win-e`.
Long-lived child processes use `CreateProcessW` with handle inheritance disabled,
so an enabled watcher cannot retain the settings command's redirected output pipes.

Commands `--enable`, `--disable`, `--status` and `--watch` take an absolute Prism
executable path and profile path. Control commands print JSON to inherited stdout.
The per-user `PrismWinE` Run value contains the exact quoted watch command. Other
installations/profiles cannot overwrite or remove it. `--uninstall` finds and
removes only this helper's registration. `--stop-own` stops that watcher but keeps
the opt-in for upgrades. The installer must stop the helper before replacing its
files, and its old uninstaller must preserve the registration when `isUpdated`.

The keyboard hook matches only physical Win+E, swallowing its repeat/key-up pair.
A short injected Ctrl pair prevents an unrelated Start-menu opening on Win release.
The hook does no filesystem/registry work or process/thread creation. A prestarted
worker receives a signal, creates a random named pipe, and invokes Prism with
`--user-data-dir=<profile>` and `--win-e=<UUID>`. The app must acknowledge by writing
that UUID and a newline to `\\.\pipe\PrismWinE.<UUID>` after Explorer is ready.
No acknowledgement within eight seconds, or a launch/availability failure, opens
Windows Explorer. Repeated requests while one is pending are coalesced.

A 500 ms lifecycle check exits the hook if its registration changes or the target
executable/application resources disappear. Owned stale registrations are removed.
Helper crashes naturally remove its process-owned hook. No shell associations or
Windows shortcut configuration are replaced. The worker finishes any pending
fallback before allowing installer replacement. No keyboard activity is logged.

`node tools/test-win-e.mjs` compiles and runs isolated self-tests. Tests use a unique
temporary HKCU key and real named pipes, verify deletion/ownership/disable/upgrade
pause/ACK timeout behavior and child-process pipe detachment, and remove their fixtures. They never install a real
keyboard hook, change the real Run value, or launch File Explorer. Actual Win-key
masking, hook removal after a crash, sign-in and installer lifecycle still require
hands-on verification on a disposable Windows session before release.
