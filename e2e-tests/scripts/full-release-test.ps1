# full-release-test.ps1 - Master FaceField E2E Test Orchestrator
# Usage: .\full-release-test.ps1 [-Mode quick|full|stress|soak] [-Build] [-FreshInstall]
param(
    [ValidateSet("quick","full","stress","soak")]
    [string]$Mode = "full",
    [string]$DeviceSerial = "",
    [switch]$Build,
    [switch]$FreshInstall,
    [int]$StressCycles = 0,
    [int]$SoakMinutes = 0
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $ScriptDir
$FlowsDir = Join-Path $BaseDir "flows"
$ResultsDir = Join-Path $BaseDir "results"

. (Join-Path $BaseDir "config\load-env.ps1")
. (Join-Path $ScriptDir 'camera-evidence.ps1')

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }
if ($StressCycles -le 0) { $StressCycles = if ($env:STRESS_CYCLES) { [int]$env:STRESS_CYCLES } else { 10 } }
if ($SoakMinutes -le 0) { $SoakMinutes = if ($env:SOAK_MINUTES) { [int]$env:SOAK_MINUTES } else { 5 } }
$maestro = if ($env:MAESTRO_PATH -and (Test-Path $env:MAESTRO_PATH)) { $env:MAESTRO_PATH } else { "maestro" }

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

# Ensure results directories exist
foreach ($d in @("$ResultsDir", "$ResultsDir\logcat", "$ResultsDir\memory", "$ResultsDir\reports", "$ResultsDir\screenshots", "$ResultsDir\failures")) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# Clear previous memory CSV for clean run
$memCsv = Join-Path $ResultsDir "memory\memory.csv"
if (Test-Path $memCsv) { Remove-Item $memCsv -Force }

$startTime = Get-Date
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# Results Tracker
$results = @{
    mode = $Mode
    startTime = $startTime.ToString("o")
    device = @{}
    apk = @{}
    scenarios = @()
    stressCyclesAttempted = 0
    stressCyclesCompleted = 0
    processRestarts = 0
    overallStatus = "PASSED"
}
$initialPid = $null

function Get-Pid {
    $p = (& adb @adb shell "pidof $pkg" 2>&1).Trim()
    if ($p -match "^(\d+)") { return $Matches[1] }
    return $null
}

function Check-Process {
    param([string]$Context)
    $curPid = Get-Pid
    if (-not $curPid) {
        Write-Host "[CRITICAL] Process died during: $Context" -ForegroundColor Red
        $script:results.processRestarts++
        $script:results.overallStatus = "FAILED"
        # Capture failure evidence
        $ts = Get-Date -Format "yyyyMMdd_HHmmss"
        $failDir = Join-Path $ResultsDir "failures\$ts-$($Context -replace '\s','_')"
        New-Item -ItemType Directory -Path $failDir -Force | Out-Null
        & adb @adb logcat -d -t 2000 > (Join-Path $failDir "logcat.log")
        & adb @adb shell screencap -p /sdcard/crash.png 2>$null
        & adb @adb pull /sdcard/crash.png (Join-Path $failDir "screenshot.png") 2>$null
        @{ context = $Context; pid = $initialPid; timestamp = (Get-Date -Format "o") } | ConvertTo-Json | Set-Content (Join-Path $failDir "failure.json")
        return $false
    }
    # Update tracked PID
    $script:initialPid = $curPid
    return $true
}

function Run-Maestro-Flow {
    param([string]$FlowFile, [string]$Name, [hashtable]$Env = @{})
    $scenario = @{ name = $Name; flow = (Split-Path -Leaf $FlowFile); status = "NOT_EXECUTED"; humanRequired = $false }

    if (-not (Test-Path $FlowFile) -or -not (Get-Command $maestro -ErrorAction SilentlyContinue)) {
        Write-Host "  [FAIL] Flow file or Maestro executable unavailable: $FlowFile" -ForegroundColor Red
        $scenario.status = "FAILED"
        $script:results.overallStatus = "FAILED"
        $script:results.scenarios += $scenario
        return $false
    }

    Write-Host "  -> Running: $Name" -ForegroundColor White
    $envArgs = @()
    foreach ($k in $Env.Keys) { $envArgs += @("-e", "$k=$($Env[$k])") }
    $deviceArgs = @()
    if ($DeviceSerial) { $deviceArgs = @('--device', $DeviceSerial) }

    & $maestro @deviceArgs test @envArgs $FlowFile 2>&1 | Tee-Object -Variable maestroOutput
    $exitCode = $LASTEXITCODE

    if ($exitCode -eq 0) {
        $scenario.status = "PASSED"
        Write-Host "  [+] ${Name}: PASSED" -ForegroundColor Green
    } else {
        $scenario.status = "FAILED"
        $script:results.overallStatus = "FAILED"
        Write-Host "  [!] ${Name}: FAILED (biometric flows require a live person)" -ForegroundColor Red
    }

    $script:results.scenarios += $scenario
    return ($exitCode -eq 0)
}

# ============================================================
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField E2E Release Test - Mode: $($Mode.ToUpper())" -ForegroundColor Cyan
Write-Host " Package  : $pkg" -ForegroundColor Cyan
Write-Host " Device   : $(if ($DeviceSerial) { $DeviceSerial } else { 'auto' })" -ForegroundColor Cyan
Write-Host " Started  : $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# -- STEP 1: Device Check ---------------------------------
Write-Host "`n[STEP 1] Device Validation" -ForegroundColor Yellow
& "$ScriptDir\check-device.ps1" -DeviceSerial $DeviceSerial
if ($LASTEXITCODE -ne 0) { Write-Host "[ABORT] Device check failed." -ForegroundColor Red; exit 1 }
if (Test-Path (Join-Path $ResultsDir "device-info.json")) {
    $results.device = Get-Content (Join-Path $ResultsDir "device-info.json") | ConvertFrom-Json
}

# -- STEP 2: Install APK ----------------------------------
Write-Host "`n[STEP 2] APK Installation" -ForegroundColor Yellow
$installParams = @{
    DeviceSerial = $DeviceSerial
}
if ($Build) { $installParams["Build"] = $true }
if ($FreshInstall) { $installParams["FreshInstall"] = $true }
& "$ScriptDir\install-release.ps1" @installParams
if ($LASTEXITCODE -ne 0) { Write-Host "[ABORT] Installation failed." -ForegroundColor Red; exit 1 }
if (Test-Path (Join-Path $ResultsDir "apk-info.json")) {
    $results.apk = Get-Content (Join-Path $ResultsDir "apk-info.json") | ConvertFrom-Json
}

# -- STEP 3: Start Monitoring -----------------------------
Write-Host "`n[STEP 3] Start Background Monitoring" -ForegroundColor Yellow
& "$ScriptDir\start-monitoring.ps1" -DeviceSerial $DeviceSerial

# -- STEP 4: Launch App & Baseline -------------------------
Write-Host "`n[STEP 4] Launch & Baseline" -ForegroundColor Yellow
& adb @adb shell "am start -n $pkg/.MainActivity" 2>$null | Out-Null
& adb @adb shell "pm grant $pkg android.permission.CAMERA" 2>$null | Out-Null
Start-Sleep -Seconds 3
$initialPid = Get-Pid
Write-Host "[+] App PID: $initialPid" -ForegroundColor Green
& "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "baseline"

# ============================================================
# FUNCTIONAL E2E
# ============================================================
if ($Mode -in @("quick", "full")) {
    Write-Host "`n[STEP 5] Functional E2E Tests" -ForegroundColor Yellow

    # Detect whether app is on Login/Signup or Dashboard
    & adb @adb shell "uiautomator dump /sdcard/ui_check.xml" 2>$null | Out-Null
    $uiContent = & adb @adb shell "cat /sdcard/ui_check.xml" 2>$null

    $needsSignup = ($FreshInstall -or $uiContent -match "Create Account|Register Your Face")
    if ($needsSignup) {
        Write-Host "  [*] Unregistered state detected - executing onboarding flow..." -ForegroundColor Cyan
        Run-Maestro-Flow (Join-Path $FlowsDir "01-create-account.yaml") "Account Creation (2-step signup)"
        Check-Process "Account Creation" | Out-Null
        & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "post-signup"

        Write-Host "  [*] [HUMAN BIOMETRIC STEP] Entering Face Registration boundary..." -ForegroundColor Yellow
        Run-Maestro-Flow (Join-Path $FlowsDir "02-face-registration.yaml") "Face Registration (biometric)"
        Check-Process "Face Registration" | Out-Null
        & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "post-face-reg"
    }

    # Login (authenticates user)
    Run-Maestro-Flow (Join-Path $FlowsDir "03-login.yaml") "Login / Session Restore"
    Check-Process "Login" | Out-Null

    # Tab navigation (Home -> History -> Profile -> Home)
    Run-Maestro-Flow (Join-Path $FlowsDir "04-tab-navigation.yaml") "Tab Navigation (Home/History/Profile)"
    Check-Process "Tab Navigation" | Out-Null
    & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "post-navigation"

    # Attendance camera lifecycle
    if ($Mode -eq "full") {
        Run-Maestro-Flow (Join-Path $FlowsDir "05-attendance-camera.yaml") "Attendance Camera & ML Pipeline"
        Check-Process "Attendance Camera" | Out-Null
        & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "post-attendance-camera"

        Run-Maestro-Flow (Join-Path $FlowsDir "06-logout.yaml") "Logout"
        Check-Process "Logout" | Out-Null

        Run-Maestro-Flow (Join-Path $FlowsDir "07-returning-user-login.yaml") "Returning User Login"
        Check-Process "Returning Login" | Out-Null
        & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "post-relogin"
    }
}

# ============================================================
# STRESS TESTING
# ============================================================
if ($Mode -in @("full", "stress")) {
    Write-Host "`n[STEP 6] Stress Testing ($StressCycles cycles)" -ForegroundColor Yellow
    $results.stressCyclesAttempted = $StressCycles

    Write-Host "  -> Camera mount/unmount stress ($StressCycles cycles)..." -ForegroundColor White

    $wmOut = (& adb @adb shell "wm size" 2>&1)
    $w = 1080; $h = 2400
    if ($wmOut -match "Physical size:\s*(\d+)x(\d+)") { $w = [int]$Matches[1]; $h = [int]$Matches[2] }

    $markAttendanceX = [int]($w * 0.50)
    $markAttendanceY = [int]($h * 0.55)
    $startScanX      = [int]($w * 0.50)
    $startScanY      = [int]($h * 0.88)

    $cameraDwellSec = [Math]::Max(1, [int]($env:CAMERA_DWELL_MS) / 1000)
    if ($cameraDwellSec -le 0) { $cameraDwellSec = 3 }

    $completed = 0
    $checkpoints = @(1, 5, 10, 20, 30, 50, $StressCycles) | Sort-Object -Unique

    for ($i = 1; $i -le $StressCycles; $i++) {
        $cameraCheckpoint = Get-CameraCheckpoint $adb
        # Enter attendance screen
        & adb @adb shell "input tap $markAttendanceX $markAttendanceY"
        Start-Sleep -Milliseconds 1500

        # Start scanning (activate frame processor)
        & adb @adb shell "input tap $startScanX $startScanY"

        # Dwell with ML active
        Start-Sleep -Seconds $cameraDwellSec
        try { Assert-CameraPipeline $adb $initialPid $cameraCheckpoint } catch {
            Write-Host "[FAIL] Cycle ${i}: $_" -ForegroundColor Red
            $results.overallStatus = 'FAILED'
            break
        }

        # Back out mid-processing via hardware back
        & adb @adb shell "input keyevent 4"
        Start-Sleep -Milliseconds 800

        if (-not (Check-Process "Stress cycle $i")) {
            Write-Host "  [CRASH] Process died on cycle $i!" -ForegroundColor Red
            break
        }

        $completed = $i

        if ($checkpoints -contains $i) {
            & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "stress-cycle-$i"
            $temp = (& adb @adb shell "dumpsys battery" 2>&1) | Select-String "temperature:\s*(\d+)"
            $tempC = if ($temp -match "(\d+)") { [Math]::Round([int]$Matches[1] / 10, 1) } else { "?" }
            Write-Host "  [Cycle $i/$StressCycles] OK | Temp: ${tempC}C" -ForegroundColor Green
        }
    }

    $results.stressCyclesCompleted = $completed
    Write-Host "  Completed $completed / $StressCycles camera stress cycles." -ForegroundColor $(if ($completed -eq $StressCycles) { "Green" } else { "Red" })
    & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "post-stress"
}

# ============================================================
# SOAK TESTING
# ============================================================
if ($Mode -eq "soak") {
    Write-Host "`n[STEP 6] Soak Testing ($SoakMinutes minutes)" -ForegroundColor Yellow
    $soakEnd = (Get-Date).AddMinutes($SoakMinutes)
    $soakCycles = 0
    $soakSampleInterval = 60

    $lastSampleTime = Get-Date
    & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "soak-start"

    $wmOut = (& adb @adb shell "wm size" 2>&1)
    $w = 1080; $h = 2400
    if ($wmOut -match "Physical size:\s*(\d+)x(\d+)") { $w = [int]$Matches[1]; $h = [int]$Matches[2] }

    while ((Get-Date) -lt $soakEnd) {
        $cameraCheckpoint = Get-CameraCheckpoint $adb
        & adb @adb shell "input tap $([int]($w*0.5)) $([int]($h*0.55))"
        Start-Sleep -Milliseconds 1500
        & adb @adb shell "input tap $([int]($w*0.5)) $([int]($h*0.88))"
        Start-Sleep -Seconds 3
        try { Assert-CameraPipeline $adb $initialPid $cameraCheckpoint } catch {
            Write-Host "[FAIL] $_" -ForegroundColor Red
            $results.overallStatus = 'FAILED'
            break
        }
        & adb @adb shell "input keyevent 4"
        Start-Sleep -Milliseconds 800

        $soakCycles++

        if (-not (Check-Process "Soak cycle $soakCycles")) { break }

        if (((Get-Date) - $lastSampleTime).TotalSeconds -ge $soakSampleInterval) {
            & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "soak-$soakCycles"
            $lastSampleTime = Get-Date
        }
    }

    & "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "soak-end"
    Write-Host "  Soak completed: $soakCycles cycles in $SoakMinutes minutes." -ForegroundColor Green
    $results.stressCyclesCompleted = $soakCycles
}

# ============================================================
# FINALIZE
# ============================================================
Write-Host "`n[STEP 7] Stop Monitoring & Forensics" -ForegroundColor Yellow
& "$ScriptDir\stop-monitoring.ps1" -DeviceSerial $DeviceSerial
& "$ScriptDir\memory-snapshot.ps1" -DeviceSerial $DeviceSerial -Label "final"

$stopwatch.Stop()
$results.endTime = (Get-Date).ToString("o")
$results.durationSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 1)

# Load crash forensics
if (Test-Path (Join-Path $ResultsDir "crash-forensics.json")) {
    $results.crashes = Get-Content (Join-Path $ResultsDir "crash-forensics.json") | ConvertFrom-Json
    if ($results.crashes.sigbus -gt 0 -or $results.crashes.sigsegv -gt 0 -or $results.crashes.fatal -gt 0) {
        $results.overallStatus = "FAILED"
    }
}

# Memory analysis
$results.memory = @{ baseline = 0; peak = 0; final = 0 }
if (Test-Path $memCsv) {
    $csv = Import-Csv $memCsv
    if ($csv.Count -gt 0) {
        $results.memory.baseline = [int]($csv[0].TotalPssKB)
        $results.memory.peak = ($csv | ForEach-Object { [int]$_.TotalPssKB } | Measure-Object -Maximum).Maximum
        $results.memory.final = [int]($csv[-1].TotalPssKB)
    }
}

# Write machine-readable results (latest.json)
$results | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $ResultsDir "latest.json") -Encoding UTF8

# -- STEP 8: Generate Report ------------------------------
Write-Host "`n[STEP 8] Generating Report" -ForegroundColor Yellow
& "$ScriptDir\generate-report.ps1"

# Summary
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " FaceField E2E Test Complete" -ForegroundColor Cyan
Write-Host " Mode     : $($Mode.ToUpper())" -ForegroundColor Cyan
Write-Host " Duration : $([Math]::Round($stopwatch.Elapsed.TotalMinutes, 1)) minutes" -ForegroundColor Cyan
Write-Host " Status   : $($results.overallStatus)" -ForegroundColor $(if ($results.overallStatus -eq "PASSED") { "Green" } else { "Red" })
Write-Host " Results  : $ResultsDir\latest.json" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

if ($results.overallStatus -ne "PASSED") { exit 1 }
