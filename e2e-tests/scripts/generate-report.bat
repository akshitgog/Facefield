@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0generate-report.ps1" %*
exit /b %ERRORLEVEL%
