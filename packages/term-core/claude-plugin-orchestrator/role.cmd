@echo off
rem THE ORCHESTRATOR'S ROLE (Prism Terminal, 2026-10-16). Claude Code runs this on
rem every prompt. When this tab is the one the owner promoted ("Make orchestrator"
rem in the tab's menu), the app has written the tab's PRISM_TAB_ID into
rem orchestrator-tab.txt beside PRISM_SESSIONS_FILE, and this prints a fixed
rem additionalContext telling Claude its role; anywhere else it prints nothing.
rem MEASURED (Claude Code 2.1.301): a plugin's UserPromptSubmit additionalContext
rem reaches the model, so a tab promoted mid-session knows from its next prompt.
rem Delayed expansion: the variables' values are never parsed as commands.
setlocal EnableDelayedExpansion
if not defined PRISM_SESSIONS_FILE exit /b 0
if not defined PRISM_TAB_ID exit /b 0
for %%F in ("!PRISM_SESSIONS_FILE!") do set "PT_DIR=%%~dpF"
set "PT_FILE=!PT_DIR!orchestrator-tab.txt"
if not exist "!PT_FILE!" exit /b 0
set "PT_ORCH="
set /p PT_ORCH=<"!PT_FILE!"
if not defined PT_ORCH exit /b 0
if not "!PT_ORCH!"=="!PRISM_TAB_ID!" exit /b 0
echo {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"This Prism Terminal tab is the ORCHESTRATOR: the owner promoted it to manage the Claude sessions in the other tabs. Before answering, load and follow the prism-terminal-orchestrator:orchestrator skill, unless the message is plainly about this session's own work."}}
exit /b 0
