# run-soak-test.ps1 — FaceField Long-Running Soak Testing Runner
param (
    [string]$DeviceSerial = "",
    [int]$DurationMinutes = 5
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $ScriptDir
$ResultsDir = Join-Path $BaseDir "results"

. (Join-Path $BaseDir "config\load-env.ps1")
. (Join-Path $ScriptDir 'camera-evidence.ps1')

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }
if ($DurationMinutes -le 0) {
    $DurationMinutes = if ($env:SOAK_MINUTES) { [int]$env:SOAK_MINUTES } else { 5 }
}

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField Long-Running Soak Test" -ForegroundColor Cyan
Write-Host " Package   : $pkg" -ForegroundColor Cyan
Write-Host " Device    : $(if ($DeviceSerial) { $DeviceSerial } else { 'default' })" -ForegroundColor Cyan
Write-Host " Duration  : $DurationMinutes minutes" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Device check
$state = (& adb @adb get-state 2>&1).Trim()
if ($state -ne "device") {
    Write-Host "[ERROR] Target device '$DeviceSerial' is not ready (state: $state)." -ForegroundColor Red
    exit 1
}

function Get-Pid {
    $p = (& adb @adb shell "pidof $pkg" 2>&1).Trim()
    if ($p -match "^(\d+)") { return $Matches[1] }
    return $null
}

# 2. Launch App and Start Monitoring
Write-Host "[1/5] Starting continuous monitoring..." -ForegroundColor Cyan
& "$ScriptDir\start-monitoring.ps1" -DeviceSerial $DeviceSerial

Write-Host "[2/5] Launching $pkg..." -ForegroundColor Cyan
& adb @adb shell "am start -n $pkg/.MainActivity" 2>$null | Out-Null
Start-Sleep -Seconds 3

$initialPid = Get-Pid
if (-not $initialPid) {
    Write-Host "[ERROR] Application process not found." -ForegroundColor Red
    & "$ScriptDir\stop-monitoring.ps1" -DeviceSerial $DeviceSerial
    exit 1
}
Write-Host "[+] Initial Process PID: $initialPid" -ForegroundColor Green

# 3. Baseline Snapshot
Write-Host "[3/5] Recording baseline memory snapshot..." -ForegroundColor Cyan
& "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "soak-baseline"

# 4. Soak Execution Loop
Write-Host "[4/5] Starting soak test loop for $DurationMinutes minutes..." -ForegroundColor Cyan

$wmOut = (& adb @adb shell "wm size" 2>&1)
$w = 1080; $h = 2400
if ($wmOut -match "Physical size:\s*(\d+)x(\d+)") { $w = [int]$Matches[1]; $h = [int]$Matches[2] }

$markAttendanceX = [int]($w * 0.50)
$markAttendanceY = [int]($h * 0.55)
$startScanX      = [int]($w * 0.50)
$startScanY      = [int]($h * 0.88)

$startTime = Get-Date
$endTime = $startTime.AddMinutes($DurationMinutes)
$soakCycles = 0
$lastSampleTime = Get-Date
$sampleIntervalSec = 60
$soakPassed = $true

while ((Get-Date) -lt $endTime) {
    # Camera operation cycle
    & adb @adb shell "input tap $markAttendanceX $markAttendanceY"
    Start-Sleep -Milliseconds 1500
    $cameraCheckpoint = Get-CameraCheckpoint $adb
    & adb @adb shell "input tap $startScanX $startScanY"
    Start-Sleep -Seconds 3
    try { Assert-CameraPipeline $adb $initialPid $cameraCheckpoint } catch {
        Write-Host "[FAIL] $_" -ForegroundColor Red
        $soakPassed = $false
        break
    }
    & adb @adb shell "input keyevent 4" # Back to dashboard
    Start-Sleep -Milliseconds 1000

    $soakCycles++

    # Verify PID continuity
    $curPid = Get-Pid
    if (-not $curPid) {
        Write-Host "`n[CRITICAL FAIL] Process died on soak cycle $soakCycles!" -ForegroundColor Red
        $soakPassed = $false
        break
    } elseif ($curPid -ne $initialPid) {
        Write-Host "`n[CRITICAL FAIL] Process restarted on soak cycle $soakCycles! (Initial: $initialPid, Current: $curPid)" -ForegroundColor Red
        $soakPassed = $false
        break
    }

    # Periodic memory and thermal sampling
    $now = Get-Date
    if (($now - $lastSampleTime).TotalSeconds -ge $sampleIntervalSec) {
        $lastSampleTime = $now
        & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "soak-cycle-$soakCycles"

        # Check thermal status
        $batt = (& adb @adb shell "dumpsys battery" 2>&1) | Select-String "temperature:\s*(\d+)"
        $tempC = if ($batt -match "(\d+)") { [Math]::Round([int]$Matches[1] / 10, 1) } else { "?" }
        $elapsedMin = [Math]::Round(($now - $startTime).TotalMinutes, 1)
        Write-Host "  [Soak ${elapsedMin}m / ${DurationMinutes}m] Completed $soakCycles cycles | Temp: ${tempC}°C | PID: $curPid" -ForegroundColor Gray
    }
}

# 5. Stop Monitoring & Final Analysis
Write-Host "`n[5/5] Finalizing soak test & analyzing logs..." -ForegroundColor Cyan
& "$ScriptDir\stop-monitoring.ps1" -DeviceSerial $DeviceSerial
& "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "soak-final"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Soak Test Summary" -ForegroundColor Cyan
Write-Host " Total Cycles   : $soakCycles" -ForegroundColor Cyan
Write-Host " Total Time     : $([Math]::Round(((Get-Date) - $startTime).TotalMinutes, 1)) minutes" -ForegroundColor Cyan
Write-Host " Result         : $(if ($soakPassed) { 'PASSED [STABLE]' } else { 'FAILED [UNSTABLE]' })" -ForegroundColor $(if ($soakPassed) { "Green" } else { "Red" })
Write-Host "============================================================" -ForegroundColor Cyan

if ($soakPassed) { exit 0 } else { exit 1 }
