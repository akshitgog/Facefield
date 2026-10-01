@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-stress-test.ps1" %*
exit /b %ERRORLEVEL%
