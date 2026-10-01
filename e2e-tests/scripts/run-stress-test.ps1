# run-stress-test.ps1 - FaceField Camera & Native ML Pipeline Stress Test Runner
param (
    [string]$DeviceId = "",
    [string]$PackageName = "com.helloworld",
    [int]$Cycles = 0,
    [int]$CameraDwellSeconds = 0
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $ScriptDir
. (Join-Path $ScriptDir 'camera-evidence.ps1')

# Load environment configuration
. "$BaseDir\config\test-env.ps1"
if ($DeviceId -eq "") { $DeviceId = $env:TEST_DEVICE_ID }
if ($PackageName -eq "") { $PackageName = $env:TEST_PACKAGE_NAME }
if ($Cycles -le 0) {
    $Cycles = if ($env:TEST_STRESS_CYCLES) { [int]$env:TEST_STRESS_CYCLES } else { 20 }
}
if ($CameraDwellSeconds -le 0) {
    $CameraDwellSeconds = if ($env:TEST_CAMERA_DWELL_SECONDS) { [int]$env:TEST_CAMERA_DWELL_SECONDS } else { 3 }
}

$adbArgs = @()
if ($DeviceId -ne "") { $adbArgs = @("-s", $DeviceId) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField Camera & ML Frame Processor Stress Test" -ForegroundColor Cyan
Write-Host " Package       : $PackageName" -ForegroundColor Cyan
Write-Host " Device        : $(if ($DeviceId) { $DeviceId } else { 'default' })" -ForegroundColor Cyan
Write-Host " Total Cycles  : $Cycles iterations" -ForegroundColor Cyan
Write-Host " Active Dwell  : $CameraDwellSeconds seconds / cycle" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Verify Device
$devCheck = & adb @adbArgs get-state 2>&1
if ($LASTEXITCODE -ne 0 -or $devCheck -notmatch "device") {
    Write-Host "[ERROR] Target device '$DeviceId' is not connected or unauthorized." -ForegroundColor Red
    exit 1
}

# 2. Check Package Installed
$pkgCheck = & adb @adbArgs shell "pm list packages $PackageName" 2>&1
if ($pkgCheck -notmatch "package:$PackageName") {
    Write-Host "[ERROR] Package '$PackageName' is not installed on device." -ForegroundColor Red
    exit 1
}

# Helper functions
function Get-AppPid {
    $pidStr = & adb @adbArgs shell "pidof $PackageName" 2>&1
    $p = ($pidStr -split "\s+")[0].Trim()
    if ($p -match "^\d+$") { return $p }
    return $null
}

function Get-DeviceTemperature {
    $batt = & adb @adbArgs shell "dumpsys battery" 2>&1
    if ($batt -match "temperature:\s*(\d+)") {
        $degC = [double]$Matches[1] / 10.0
        return "${degC} C"
    }
    return "N/A"
}

function Get-ThermalStatus {
    $th = & adb @adbArgs shell "dumpsys thermalservice" 2>&1
    if ($th -match "ThermalStatus:\s*(\d+)") {
        $statusCodes = @{ 0 = "NONE"; 1 = "LIGHT"; 2 = "MODERATE"; 3 = "SEVERE"; 4 = "CRITICAL"; 5 = "EMERGENCY"; 6 = "SHUTDOWN" }
        $code = [int]$Matches[1]
        $name = if ($statusCodes.ContainsKey($code)) { $statusCodes[$code] } else { "UNKNOWN ($code)" }
        return $name
    }
    return "NORMAL"
}

function Tap-ElementOrCoords {
    param([string]$Text, [int]$X, [int]$Y)
    & adb @adbArgs shell "input tap $X $Y"
}

# 3. Get Screen Dimensions
$wmSize = & adb @adbArgs shell "wm size" 2>&1
$width = 1080
$height = 2400
if ($wmSize -match "Physical size:\s*(\d+)x(\d+)") {
    $width = [int]$Matches[1]
    $height = [int]$Matches[2]
}

$btnAttendanceX = [int]($width * 0.5)
$btnAttendanceY = [int]($height * 0.65)
$btnStartX      = [int]($width * 0.5)
$btnStartY      = [int]($height * 0.88)
$btnCancelX     = [int]($width * 0.88)
$btnCancelY     = [int]($height * 0.08)

# 4. Launch App and Verify Baseline
Write-Host "[*] Ensuring $PackageName is in foreground..." -ForegroundColor Cyan
& adb @adbArgs shell "am start -n $PackageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 3

$initialPid = Get-AppPid
if (-not $initialPid) {
    Write-Host "[ERROR] Application process not found. Launch failed." -ForegroundColor Red
    exit 1
}

$initialTemp = Get-DeviceTemperature
$initialThermal = Get-ThermalStatus
Write-Host "[+] Initial Process PID : $initialPid" -ForegroundColor Green
Write-Host "[+] Initial Temperature : $initialTemp (Thermal: $initialThermal)" -ForegroundColor Green

# Baseline Memory Snapshot
Write-Host "[*] Recording baseline memory snapshot..." -ForegroundColor Cyan
& "$ScriptDir\memory-snapshot.ps1" -Label "stress_baseline" -DeviceId $DeviceId -PackageName $PackageName | Out-Null

$screenshotDir = "$BaseDir\results\screenshots"
if (-not (Test-Path $screenshotDir)) { New-Item -ItemType Directory -Path $screenshotDir -Force | Out-Null }

$stressPassed = $true
$completedCycles = 0
$checkpoints = @(1, 5, 10, 20, 30, 40, 50, $Cycles)

Write-Host "`n>>> Starting Stress Testing Loop ($Cycles cycles) <<<`n" -ForegroundColor Yellow

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

for ($i = 1; $i -le $Cycles; $i++) {
    $cycleStart = [System.Diagnostics.Stopwatch]::StartNew()
    $cameraCheckpoint = Get-CameraCheckpoint $adbArgs
    
    # Step A: Mount camera via Attendance screen
    & adb @adbArgs shell "input tap $btnAttendanceX $btnAttendanceY"
    Start-Sleep -Milliseconds 1200
    
    # Step B: Engage native frame processor
    & adb @adbArgs shell "input tap $btnStartX $btnStartY"
    
    # Step C: Stream frames under active ML inference
    Start-Sleep -Seconds $CameraDwellSeconds
    try { Assert-CameraPipeline $adbArgs $initialPid $cameraCheckpoint } catch {
        Write-Host "[FAIL] Cycle ${i}: $_" -ForegroundColor Red
        $stressPassed = $false
        break
    }
    
    # Step D: Rapid tear-down / unmount while ML is running
    & adb @adbArgs shell "input keyevent 4" # KEYCODE_BACK
    Start-Sleep -Milliseconds 800
    
    # Step E: Liveness and PID Continuity Check
    $curPid = Get-AppPid
    if (-not $curPid) {
        Write-Host "`n[CRITICAL FAILURE] Application crashed on cycle $i! (Process died)" -ForegroundColor Red
        $stressPassed = $false
        
        # Capture emergency artifacts
        $ts = Get-Date -Format "yyyyMMdd_HHmmss"
        & adb @adbArgs shell "screencap -p /sdcard/crash_$ts.png"
        & adb @adbArgs pull /sdcard/crash_$ts.png "$screenshotDir\crash_cycle_${i}_$ts.png" 2>$null
        & adb @adbArgs logcat -d -t 1000 > "$BaseDir\results\logcat\crash_dump_cycle_${i}_$ts.log"
        break
    } elseif ($curPid -ne $initialPid) {
        Write-Host "`n[CRITICAL FAILURE] Application crashed and restarted on cycle $i! (Old PID: $initialPid, New PID: $curPid)" -ForegroundColor Red
        $stressPassed = $false
        break
    }
    
    $completedCycles = $i
    $cycleMs = $cycleStart.ElapsedMilliseconds
    
    # Checkpoint snapshot
    if ($checkpoints -contains $i) {
        $curTemp = Get-DeviceTemperature
        Write-Host "  -> [Cycle $i/$Cycles] OK (${cycleMs}ms) | Temp: $curTemp | Recording checkpoint snapshot..." -ForegroundColor Green
        & "$ScriptDir\memory-snapshot.ps1" -Label "stress_cycle_$i" -DeviceId $DeviceId -PackageName $PackageName | Out-Null
    } else {
        if ($i % 2 -eq 0 -or $i -le 5) {
            Write-Host "  -> [Cycle $i/$Cycles] OK (${cycleMs}ms) | PID: $curPid" -ForegroundColor Gray
        }
    }
}

$stopwatch.Stop()
$totalElapsedSec = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 1)

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " Stress Test Completed" -ForegroundColor Cyan
Write-Host " Cycles Completed : $completedCycles / $Cycles" -ForegroundColor Cyan
Write-Host " Total Duration   : ${totalElapsedSec}s" -ForegroundColor Cyan
Write-Host " Final Temperature: $(Get-DeviceTemperature) (Thermal: $(Get-ThermalStatus))" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Final Snapshot & Analysis
if ($stressPassed) {
    Write-Host "[*] Recording post-stress memory snapshot..." -ForegroundColor Cyan
    & "$ScriptDir\memory-snapshot.ps1" -Label "stress_final" -DeviceId $DeviceId -PackageName $PackageName | Out-Null

    # Forensic logcat check
    Write-Host "[*] Running forensic crash scan on logcat..." -ForegroundColor Cyan
    $crashes = & adb @adbArgs logcat -d -t 1500 2>&1 | Select-String "SIGBUS|SIGSEGV|SIGABRT|OutOfMemoryError|FATAL EXCEPTION:.*com.helloworld"
    if ($crashes) {
        Write-Host "[CRITICAL FAIL] Crash signatures detected in logcat after stress run!" -ForegroundColor Red
        $crashes | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
        $stressPassed = $false
    } else {
        Write-Host "[+] Zero native crashes or SIGBUS/SIGSEGV observed across $completedCycles cycles." -ForegroundColor Green
    }
}

Write-Host "============================================================" -ForegroundColor Cyan
if ($stressPassed) {
    Write-Host " STRESS TEST RESULT: PASSED [ROBUST & STABLE]" -ForegroundColor Green
    exit 0
} else {
    Write-Host " STRESS TEST RESULT: FAILED [UNSTABLE]" -ForegroundColor Red
    exit 1
}
