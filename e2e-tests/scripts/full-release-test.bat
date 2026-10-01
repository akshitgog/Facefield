@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0full-release-test.ps1" %*
exit /b %ERRORLEVEL%
