# start-monitoring.ps1 — Starts background logcat capture and crash monitor
param([string]$DeviceSerial = "")

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path -Parent $ScriptDir) "config\load-env.ps1")

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

$logDir = Join-Path (Split-Path -Parent $ScriptDir) "results\logcat"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$fullLog = Join-Path $logDir "logcat_$ts.log"
$crashLog = Join-Path $logDir "crash_monitor_$ts.log"

Write-Host "[*] Clearing logcat buffer..." -ForegroundColor Cyan
& adb @adb logcat -c 2>$null

# Start full logcat capture in background
$logcatArgs = $adb + @("logcat", "-v", "threadtime")
$logcatProc = Start-Process -FilePath "adb" -ArgumentList $logcatArgs -RedirectStandardOutput $fullLog -WindowStyle Hidden -PassThru
Write-Host "[+] Logcat capture -> $fullLog (PID: $($logcatProc.Id))" -ForegroundColor Green

# Start filtered crash monitor in background
$crashFilter = "SIGBUS|SIGSEGV|SIGABRT|OutOfMemoryError|FATAL EXCEPTION|AndroidRuntime|CameraX|Camera2|CameraState|FaceAuth|MediaPipe|TFLite|LiteRT|SQLite|HardwareBuffer|ImageReader"
$crashArgs = $adb + @("logcat", "-v", "threadtime", "-e", $crashFilter)
$crashProc = Start-Process -FilePath "adb" -ArgumentList $crashArgs -RedirectStandardOutput $crashLog -WindowStyle Hidden -PassThru

Write-Host "[+] Crash monitor -> $crashLog (PID: $($crashProc.Id))" -ForegroundColor Green

# Store PIDs for stop-monitoring
$pidFile = Join-Path $logDir "monitor_pids.txt"
"$($logcatProc.Id)`n$($crashProc.Id)`n$fullLog`n$crashLog" | Set-Content $pidFile -Encoding UTF8

Write-Host "[+] Monitoring started." -ForegroundColor Green
