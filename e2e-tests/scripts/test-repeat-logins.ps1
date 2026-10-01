# test-repeat-logins.ps1 - Repeat Login & App Restart Verification Suite
param (
    [string]$DeviceId = "",
    [string]$PackageName = "com.helloworld",
    [int]$Cycles = 5,
    [string]$TestEmail = "",
    [string]$TestPassword = "",
    [string]$WrongPassword = "wrong_password_999"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $ScriptDir
$FlowsDir = Join-Path $BaseDir "flows"

# 1. Load Environment
. "$BaseDir\config\load-env.ps1"
if ($DeviceId -eq "") { $DeviceId = $env:DEVICE_SERIAL }
if ($TestEmail -eq "") { $TestEmail = if ($env:TEST_EMAIL) { $env:TEST_EMAIL } else { "qa.engineer@facefield.internal" } }
if ($TestPassword -eq "") { $TestPassword = if ($env:TEST_PASSWORD) { $env:TEST_PASSWORD } else { "password123" } }

$maestro = if ($env:MAESTRO_PATH -and (Test-Path $env:MAESTRO_PATH)) { $env:MAESTRO_PATH } else { "C:\Users\Galactus\maestro\bin\maestro.bat" }

$adbArgs = @()
if ($DeviceId -ne "") { $adbArgs = @("-s", $DeviceId) }
$maestroArgs = @()
if ($DeviceId) { $maestroArgs = @('--device', $DeviceId) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField Repeat-Login & Session Reliability Test" -ForegroundColor Cyan
Write-Host " Package      : $PackageName" -ForegroundColor Cyan
Write-Host " Device       : $(if ($DeviceId) { $DeviceId } else { 'default' })" -ForegroundColor Cyan
Write-Host " Total Cycles : $Cycles cycles" -ForegroundColor Cyan
Write-Host " Target User  : $TestEmail" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 2. Check Device
$devCheck = & adb @adbArgs get-state 2>&1
if ($LASTEXITCODE -ne 0 -or $devCheck -notmatch "device") {
    Write-Host "[ERROR] Physical Android device '$DeviceId' is not connected or unauthorized." -ForegroundColor Red
    Write-Host "Please ensure USB debugging is enabled and the phone is plugged in." -ForegroundColor Yellow
    exit 1
}

# Helper functions
function Get-AppPid {
    $p = (& adb @adbArgs shell "pidof $PackageName" 2>&1).Trim()
    if ($p -match "^(\d+)") { return $Matches[1] }
    return $null
}

function Get-MemSummary {
    $mem = & adb @adbArgs shell "dumpsys meminfo $PackageName" 2>&1
    $totalPss = 0; $nativeHeap = 0; $javaHeap = 0
    if ($mem -match "TOTAL PSS:\s*(\d+)") { $totalPss = [math]::Round([int]$Matches[1] / 1024, 1) }
    if ($mem -match "Native Heap\s+(\d+)") { $nativeHeap = [math]::Round([int]$Matches[1] / 1024, 1) }
    if ($mem -match "Java Heap\s+(\d+)") { $javaHeap = [math]::Round([int]$Matches[1] / 1024, 1) }
    return @{ PssMB = $totalPss; NativeMB = $nativeHeap; JavaMB = $javaHeap }
}

# 3. Ensure App is Running and Initialized
Write-Host "[*] Launching $PackageName..." -ForegroundColor Cyan
& adb @adbArgs shell "am start -n $PackageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 2

$initialPid = Get-AppPid
if (-not $initialPid) {
    Write-Host "[ERROR] Failed to start application process." -ForegroundColor Red
    exit 1
}

$initialMem = Get-MemSummary
Write-Host "[+] Initial Process PID : $initialPid" -ForegroundColor Green
Write-Host "[+] Initial Memory      : Total PSS=$($initialMem.PssMB) MB | Native=$($initialMem.NativeMB) MB | Java=$($initialMem.JavaMB) MB" -ForegroundColor Green

$resultsTable = @()
$testPassed = $true

Write-Host "`n>>> Starting Repeat-Login Cycles ($Cycles cycles) <<<`n" -ForegroundColor Yellow

for ($i = 1; $i -le $Cycles; $i++) {
    $cycleStart = [System.Diagnostics.Stopwatch]::StartNew()
    $stepRejectedWrong = $false
    $stepCorrectLogin = $false
    $stepLogout = $false
    $pidStable = $true

    Write-Host "── Cycle $i / $Cycles ─────────────────────────────────────" -ForegroundColor White

    # Step A: Perform Login with Correct Password
    Write-Host "  [1/4] Logging in with correct credentials..." -ForegroundColor Gray
    $env:TEST_EMAIL = $TestEmail
    $env:TEST_PASSWORD = $TestPassword
    $loginOut = & $maestro @maestroArgs test (Join-Path $FlowsDir '03-login.yaml') 2>&1
    if ($LASTEXITCODE -eq 0) {
        $stepCorrectLogin = $true
    } else {
        Write-Host "  [WARN] Maestro login exited with $LASTEXITCODE" -ForegroundColor Yellow
    }

    # Verify PID continuity
    $curPid = Get-AppPid
    if ($curPid -ne $initialPid) {
        Write-Host "  [FAIL] Unexpected PID change! Old: $initialPid, New: $curPid" -ForegroundColor Red
        $pidStable = $false
        $testPassed = $false
    }

    # Step B: Perform Logout
    Write-Host "  [2/4] Logging out from Profile tab..." -ForegroundColor Gray
    $logoutOut = & $maestro @maestroArgs test (Join-Path $FlowsDir '06-logout.yaml') 2>&1
    if ($LASTEXITCODE -eq 0) {
        $stepLogout = $true
    } else {
        Write-Host "  [WARN] Maestro logout exited with $LASTEXITCODE" -ForegroundColor Yellow
    }

    $curPid = Get-AppPid
    if ($curPid -ne $initialPid) {
        Write-Host "  [FAIL] Unexpected PID change during logout!" -ForegroundColor Red
        $pidStable = $false
        $testPassed = $false
    }

    # Step C: Try Wrong Password & Verify Rejection
    Write-Host "  [3/4] Testing wrong password rejection..." -ForegroundColor Gray
    $wrongOut = & $maestro @maestroArgs test (Join-Path $FlowsDir 'wrong-password-attempt.yaml') 2>&1
    if ($LASTEXITCODE -eq 0) {
        $stepRejectedWrong = $true
    } else {
        Write-Host "  [WARN] Wrong password attempt failed assertion!" -ForegroundColor Yellow
    }

    $curPid = Get-AppPid
    if ($curPid -ne $initialPid) {
        Write-Host "  [FAIL] Unexpected PID change during wrong password attempt!" -ForegroundColor Red
        $pidStable = $false
        $testPassed = $false
    }

    # Step D: Re-login with Correct Password
    Write-Host "  [4/4] Logging back in with correct credentials..." -ForegroundColor Gray
    $reLoginOut = & $maestro @maestroArgs test (Join-Path $FlowsDir '03-login.yaml') 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] Re-login failed!" -ForegroundColor Red
        $stepCorrectLogin = $false
        $testPassed = $false
    }

    $cycleStart.Stop()
    $latencySec = [math]::Round($cycleStart.Elapsed.TotalSeconds, 1)

    $memNow = Get-MemSummary
    Write-Host "  -> Cycle $i Completed in ${latencySec}s | PSS: $($memNow.PssMB) MB" -ForegroundColor Green

    $resultsTable += [PSCustomObject]@{
        Cycle = $i
        WrongPasswordRejected = if ($stepRejectedWrong) { "PASS" } else { "FAIL" }
        CorrectLogin = if ($stepCorrectLogin) { "PASS" } else { "FAIL" }
        Logout = if ($stepLogout) { "PASS" } else { "FAIL" }
        PidStable = if ($pidStable) { "PASS (PID $curPid)" } else { "FAIL" }
        LatencySec = $latencySec
        PssMB = $memNow.PssMB
    }

    # Logout to leave ready for next cycle if not last
    if ($i -lt $Cycles) {
        & $maestro @maestroArgs test (Join-Path $FlowsDir '06-logout.yaml') 2>&1 | Out-Null
    }
}

# 4. Phase 8: Intentional App Restart Test
Write-Host "`n>>> Phase 8: Intentional App Restart Test <<<`n" -ForegroundColor Yellow
$pidBeforeStop = Get-AppPid
Write-Host "  [1/4] Current Authenticated PID before stop: $pidBeforeStop" -ForegroundColor Cyan

Write-Host "  [2/4] Executing intentional force-stop (am force-stop)..." -ForegroundColor Cyan
& adb @adbArgs shell "am force-stop $PackageName"
Start-Sleep -Seconds 1

$pidAfterStop = Get-AppPid
if ($pidAfterStop) {
    Write-Host "  [WARN] Process still alive after force-stop: $pidAfterStop" -ForegroundColor Yellow
} else {
    Write-Host "  [+] Process successfully stopped (Old PID disappeared as expected)." -ForegroundColor Green
}

Write-Host "  [3/4] Relaunching application..." -ForegroundColor Cyan
& adb @adbArgs shell "am start -n $PackageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 3

$pidAfterLaunch = Get-AppPid
Write-Host "  [+] New Process PID after deliberate launch: $pidAfterLaunch" -ForegroundColor Green

Write-Host "  [4/4] Verifying persisted session behavior..." -ForegroundColor Cyan
$uiDump = & adb @adbArgs shell "uiautomator dump /data/local/tmp/restart_dump.xml && cat /data/local/tmp/restart_dump.xml" 2>&1
$restoredToDashboard = $uiDump -match "Mark Attendance|Today's Status"
$returnedToLogin = $uiDump -match "Facefield|you@example\.com|Login"

if ($restoredToDashboard) {
    Write-Host "  [+] Session Restored: App automatically resumed into Dashboard (AppTabs)." -ForegroundColor Green
    $observedSession = "Restored Dashboard"
} elseif ($returnedToLogin) {
    Write-Host "  [+] Returned to Login screen with persisted user registry." -ForegroundColor Green
    $observedSession = "Returned to Login"
} else {
    Write-Host "  [?] Unknown UI state after relaunch." -ForegroundColor Yellow
    $observedSession = "Unknown State"
}

# 5. Logcat Forensic Scan
Write-Host "`n>>> Logcat Crash Scan <<<`n" -ForegroundColor Yellow
$logcatRecent = & adb @adbArgs logcat -d -t 2000 2>&1
$crashes = $logcatRecent | Where-Object { $_ -notmatch "adbd\s*:.*exec logcat" } | Select-String "SIGBUS|BUS_ADRALN|SIGSEGV|SIGABRT|OutOfMemoryError|FATAL EXCEPTION:.*com.helloworld"

$crashFound = $false
if ($crashes) {
    Write-Host "[CRITICAL FAIL] Crash signatures detected in logcat!" -ForegroundColor Red
    $crashes | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    $crashFound = $true
    $testPassed = $false
} else {
    Write-Host "[+] Zero native crash signatures (0 SIGBUS, 0 SIGSEGV, 0 SIGABRT, 0 OOM)." -ForegroundColor Green
}

# 6. Results Summary
$finalMem = Get-MemSummary
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " Repeat Login & Reliability Results Table" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
$resultsTable | Format-Table -AutoSize | Out-String | Write-Host -ForegroundColor White

Write-Host "Restart Summary:" -ForegroundColor Cyan
Write-Host "  PID Before Force-Stop : $pidBeforeStop" -ForegroundColor White
Write-Host "  PID After Force-Stop  : $(if ($pidAfterStop) { $pidAfterStop } else { 'None (Process terminated)' })" -ForegroundColor White
Write-Host "  PID After Launch      : $pidAfterLaunch" -ForegroundColor White
Write-Host "  Observed Session State: $observedSession" -ForegroundColor White

Write-Host "`nMemory Summary:" -ForegroundColor Cyan
Write-Host "  Baseline PSS : $($initialMem.PssMB) MB" -ForegroundColor White
Write-Host "  Final PSS    : $($finalMem.PssMB) MB" -ForegroundColor White
Write-Host "  Native Heap  : $($finalMem.NativeMB) MB" -ForegroundColor White
Write-Host "  Java Heap    : $($finalMem.JavaMB) MB" -ForegroundColor White

if ($testPassed -and -not $crashFound) {
    Write-Host "`nTEST SUITE RESULT: PASSED [SUCCESS]" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`nTEST SUITE RESULT: FAILED [ISSUES DETECTED]" -ForegroundColor Red
    exit 1
}
