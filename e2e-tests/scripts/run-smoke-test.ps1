# run-smoke-test.ps1 — FaceField Quick Smoke Test Runner
param (
    [string]$DeviceSerial = "",
    [ValidateSet('maestro', 'adb', 'auto')]
    [string]$Runner = "auto"
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $ScriptDir
$FlowsDir = Join-Path $BaseDir "flows"

. (Join-Path $BaseDir "config\load-env.ps1")
. (Join-Path $ScriptDir 'camera-evidence.ps1')

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }
$maestro = if ($env:MAESTRO_PATH -and (Test-Path $env:MAESTRO_PATH)) { $env:MAESTRO_PATH } else { "maestro" }

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField E2E Quick Smoke Test" -ForegroundColor Cyan
Write-Host " Package : $pkg" -ForegroundColor Cyan
Write-Host " Device  : $(if ($DeviceSerial) { $DeviceSerial } else { 'default' })" -ForegroundColor Cyan
Write-Host " Runner  : $Runner" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Device check
$state = (& adb @adb get-state 2>&1).Trim()
if ($state -ne "device") {
    Write-Host "[ERROR] Target device '$DeviceSerial' is not ready (state: $state)." -ForegroundColor Red
    exit 1
}

# 2. Package check
$pkgCheck = & adb @adb shell "pm list packages $pkg" 2>&1
if ($pkgCheck -notmatch "package:$pkg") {
    Write-Host "[ERROR] Package '$pkg' is not installed." -ForegroundColor Red
    exit 1
}

function Get-Pid {
    $p = (& adb @adb shell "pidof $pkg" 2>&1).Trim()
    if ($p -match "^(\d+)") { return $Matches[1] }
    return $null
}

# 3. Ensure App is Running and Focused
Write-Host "[1/6] Launching application..." -ForegroundColor Cyan
& adb @adb shell "am start -n $pkg/.MainActivity" 2>$null | Out-Null
Start-Sleep -Seconds 3

$initialPid = Get-Pid
if (-not $initialPid) {
    Write-Host "[ERROR] Failed to start application process." -ForegroundColor Red
    exit 1
}
Write-Host "[+] Application running with PID: $initialPid" -ForegroundColor Green

# 4. Take Baseline Memory Snapshot
Write-Host "[2/6] Recording baseline memory snapshot..." -ForegroundColor Cyan
& "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "smoke-baseline"

# 5. Execute Smoke Test Flows
$smokePassed = $true
$cameraCheckpoint = Get-CameraCheckpoint $adb
$useMaestro = ($Runner -eq "maestro" -or $Runner -eq "auto")
if ($Runner -eq 'auto' -and -not (Get-Command $maestro -ErrorAction SilentlyContinue)) { $useMaestro = $false }
if ($Runner -eq 'maestro' -and -not (Get-Command $maestro -ErrorAction SilentlyContinue)) { throw 'Maestro executable not found.' }
$maestroArgs = @()
if ($DeviceSerial) { $maestroArgs = @('--device', $DeviceSerial) }

if ($useMaestro) {
    Write-Host "[3/6] Running smoke tests with Maestro CLI..." -ForegroundColor Cyan
    $smokeFlows = @(
        @{ file = "03-login.yaml"; name = "Login & Session" },
        @{ file = "04-tab-navigation.yaml"; name = "Tab Navigation" },
        @{ file = "05-attendance-camera.yaml"; name = "Attendance Camera Lifecycle" }
    )

    foreach ($f in $smokeFlows) {
        $flowPath = Join-Path $FlowsDir $f.file
        if (Test-Path $flowPath) {
            Write-Host "  -> Running flow: $($f.name)..." -ForegroundColor White
            & $maestro @maestroArgs test $flowPath 2>&1 | Tee-Object -Variable mOut
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [FAIL] Maestro flow $($f.file) failed. No fallback can override this failure." -ForegroundColor Red
                $smokePassed = $false
                break
            }
        } else {
            $smokePassed = $false
            break
        }
    }
}

if (-not $useMaestro -or $Runner -eq "adb") {
    Write-Host "[3/6] Running smoke tests via native ADB automation..." -ForegroundColor Cyan

    $wmOut = (& adb @adb shell "wm size" 2>&1)
    $w = 1080; $h = 2400
    if ($wmOut -match "Physical size:\s*(\d+)x(\d+)") { $w = [int]$Matches[1]; $h = [int]$Matches[2] }

    # Tab navigation via native tap coordinates
    Write-Host "  -> Step A: Testing tab navigation..." -ForegroundColor White
    $navY = [int]($h - 60)
    # History tab (~center)
    & adb @adb shell "input tap $([int]($w * 0.50)) $navY"
    Start-Sleep -Seconds 2
    # Profile tab (~right)
    & adb @adb shell "input tap $([int]($w * 0.83)) $navY"
    Start-Sleep -Seconds 2
    # Home tab (~left)
    & adb @adb shell "input tap $([int]($w * 0.17)) $navY"
    Start-Sleep -Seconds 2

    # Attendance camera check
    Write-Host "  -> Step B: Testing Attendance camera initialization & ML frame processor..." -ForegroundColor White
    # Tap "Mark Attendance"
    & adb @adb shell "input tap $([int]($w * 0.50)) $([int]($h * 0.55))"
    Start-Sleep -Seconds 2
    # Tap "Start Scanning"
    & adb @adb shell "input tap $([int]($w * 0.50)) $([int]($h * 0.88))"
    Write-Host "  [*] Active frame processing streaming. Dwelling 3s..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
    # Close camera via Back button
    & adb @adb shell "input keyevent 4"
    Start-Sleep -Seconds 2
}

# 6. Verify Process Continuity
try { Assert-CameraPipeline $adb $initialPid $cameraCheckpoint } catch {
    Write-Host "[FAIL] $_" -ForegroundColor Red
    $smokePassed = $false
}
Write-Host "[4/6] Verifying process PID continuity..." -ForegroundColor Cyan
$currentPid = Get-Pid
if (-not $currentPid) {
    Write-Host "[CRITICAL FAIL] Application process died during smoke test!" -ForegroundColor Red
    $smokePassed = $false
} elseif ($currentPid -ne $initialPid) {
    Write-Host "[CRITICAL FAIL] Application restarted! (Initial: $initialPid, Current: $currentPid)" -ForegroundColor Red
    $smokePassed = $false
} else {
    Write-Host "[+] Process PID remained constant ($currentPid). No crash occurred." -ForegroundColor Green
}

# 7. Post-Smoke Memory Snapshot
Write-Host "[5/6] Recording post-smoke memory snapshot..." -ForegroundColor Cyan
& "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "smoke-post"

# 8. Check Logcat Buffer for Serious Signals
Write-Host "[6/6] Checking for fatal signals in recent logcat..." -ForegroundColor Cyan
$recentLogs = & adb @adb logcat -d -t 500 2>&1
$fatalMatch = $recentLogs | Where-Object { $_ -notmatch "adbd\s*:.*exec logcat" } | Select-String "Fatal signal 7|Fatal signal 11|Fatal signal 6|OutOfMemoryError|FATAL EXCEPTION:\s*com\.helloworld"
if ($fatalMatch) {
    Write-Host "[CRITICAL FAIL] Crash signatures detected in logcat!" -ForegroundColor Red
    $fatalMatch | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    $smokePassed = $false
} else {
    Write-Host "[+] Zero crash signatures detected in logcat." -ForegroundColor Green
}

Write-Host "============================================================" -ForegroundColor Cyan
if ($smokePassed) {
    Write-Host " SMOKE TEST: PASSED [SUCCESS]" -ForegroundColor Green
    exit 0
} else {
    Write-Host " SMOKE TEST: FAILED [CRITICAL]" -ForegroundColor Red
    exit 1
}
