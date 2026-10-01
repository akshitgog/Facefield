@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "memory-snapshot.ps1" %*
if %ERRORLEVEL% neq 0 (
    exit /b %ERRORLEVEL%
)
endlocal
exit /b 0
