@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -ExecutionPolicy Bypass -File "%SCRIPT_DIR%run-onboarding-test.ps1" %*
exit /b %ERRORLEVEL%
