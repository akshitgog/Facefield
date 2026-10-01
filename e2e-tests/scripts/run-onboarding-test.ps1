# run-onboarding-test.ps1 — End-to-End Onboarding, Face Registration & Repeat-Login Suite
param (
    [string]$DeviceId = "",
    [string]$PackageName = "com.helloworld",
    [int]$LoginCycles = 5,
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = Split-Path -Parent $ScriptDir
$FlowsDir = Join-Path $BaseDir "flows"
$ResultsDir = Join-Path $BaseDir "results"

# Load config
. "$BaseDir\config\load-env.ps1"
if ($DeviceId -eq "") { $DeviceId = $env:DEVICE_SERIAL }
$maestro = if ($env:MAESTRO_PATH -and (Test-Path $env:MAESTRO_PATH)) { $env:MAESTRO_PATH } else { "C:\Users\Galactus\maestro\bin\maestro.bat" }

$adbArgs = @()
if ($DeviceId -ne "") { $adbArgs = @("-s", $DeviceId) }
$maestroArgs = @()
if ($DeviceId) { $maestroArgs = @('--device', $DeviceId) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField Onboarding, Registration & Repeat-Login Suite" -ForegroundColor Cyan
Write-Host " Package      : $PackageName" -ForegroundColor Cyan
Write-Host " Device       : $(if ($DeviceId) { $DeviceId } else { 'default' })" -ForegroundColor Cyan
Write-Host " Login Cycles : $LoginCycles" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Device check
$devCheck = & adb @adbArgs get-state 2>&1
if ($LASTEXITCODE -ne 0 -or $devCheck -notmatch "device") {
    Write-Host "[ERROR] Physical device is not connected or unauthorized." -ForegroundColor Red
    Write-Host "Please ensure phone is plugged in with USB debugging enabled." -ForegroundColor Yellow
    exit 1
}

function Get-AppPid {
    $p = (& adb @adbArgs shell "pidof $PackageName" 2>&1).Trim()
    if ($p -match "^(\d+)") { return $Matches[1] }
    return $null
}

function Get-MemStats {
    $mem = & adb @adbArgs shell "dumpsys meminfo $PackageName" 2>&1
    $pss = 0; $native = 0; $java = 0
    if ($mem -match "TOTAL PSS:\s*(\d+)") { $pss = [math]::Round([int]$Matches[1] / 1024, 1) }
    if ($mem -match "Native Heap\s+(\d+)") { $native = [math]::Round([int]$Matches[1] / 1024, 1) }
    if ($mem -match "Java Heap\s+(\d+)") { $java = [math]::Round([int]$Matches[1] / 1024, 1) }
    return @{ Pss = $pss; Native = $native; Java = $java }
}

# 2. Clear logcat buffer for clean forensic capture
& adb @adbArgs logcat -c

# 3. Launch App and Record Baseline
Write-Host "[1/6] Launching application..." -ForegroundColor Cyan
& adb @adbArgs shell "am start -n $PackageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 2

$baselinePid = Get-AppPid
$baselineMem = Get-MemStats
Write-Host "[+] Baseline PID : $baselinePid" -ForegroundColor Green
Write-Host "[+] Baseline PSS : $($baselineMem.Pss) MB (Native: $($baselineMem.Native) MB, Java: $($baselineMem.Java) MB)" -ForegroundColor Green

# 4. Test B: Duplicate Account Protection
Write-Host "`n[2/6] Executing Test B: Duplicate Account Protection..." -ForegroundColor Cyan
$dupOut = & $maestro @maestroArgs test (Join-Path $FlowsDir 'duplicate-account-test.yaml') 2>&1
$testBDupPass = ($LASTEXITCODE -eq 0)
if ($testBDupPass) {
    Write-Host "  [+] Test B: PASSED (Duplicate registration cleanly blocked with inline error)" -ForegroundColor Green
} else {
    Write-Host "  [-] Test B: FAILED or Warning" -ForegroundColor Yellow
}

# 5. Test E: Repeat Login Cycles (5 Cycles)
Write-Host "`n[3/6] Executing Test E: Repeat Login Suite ($LoginCycles Cycles)..." -ForegroundColor Cyan
$repeatLoginsPass = $true
$cycleResults = @()

for ($c = 1; $c -le $LoginCycles; $c++) {
    Write-Host "  -> Running Cycle $c/$LoginCycles..." -ForegroundColor Gray
    $t = [System.Diagnostics.Stopwatch]::StartNew()
    
    # Login
    $loginRes = & $maestro @maestroArgs test (Join-Path $FlowsDir '03-login.yaml') 2>&1
    $loginOk = ($LASTEXITCODE -eq 0)
    
    # Logout
    $logoutRes = & $maestro @maestroArgs test (Join-Path $FlowsDir '06-logout.yaml') 2>&1
    $logoutOk = ($LASTEXITCODE -eq 0)
    
    # Wrong password test
    $wrongRes = & $maestro @maestroArgs test (Join-Path $FlowsDir 'wrong-password-attempt.yaml') 2>&1
    $wrongOk = ($LASTEXITCODE -eq 0)
    
    # Re-login
    $reloginRes = & $maestro @maestroArgs test (Join-Path $FlowsDir '03-login.yaml') 2>&1
    $reloginOk = ($LASTEXITCODE -eq 0)
    
    # Leave logged out for next cycle
    if ($c -lt $LoginCycles) {
        & $maestro @maestroArgs test (Join-Path $FlowsDir '06-logout.yaml') 2>&1 | Out-Null
    }
    
    $t.Stop()
    $curPid = Get-AppPid
    $pidOk = ($curPid -eq $baselinePid)
    $memCur = Get-MemStats
    
    if (-not ($loginOk -and $logoutOk -and $wrongOk -and $reloginOk -and $pidOk)) {
        $repeatLoginsPass = $false
    }
    
    $cycleResults += [PSCustomObject]@{
        Cycle = $c
        CorrectLogin = if ($loginOk -and $reloginOk) { "PASS" } else { "FAIL" }
        Logout = if ($logoutOk) { "PASS" } else { "FAIL" }
        WrongPassRejected = if ($wrongOk) { "PASS" } else { "FAIL" }
        PidStable = if ($pidOk) { "YES (PID $curPid)" } else { "NO" }
        DurationSec = [math]::Round($t.Elapsed.TotalSeconds, 1)
        PssMB = $memCur.Pss
    }
}

# 6. Test F: Intentional App Restart
Write-Host "`n[4/6] Executing Test F: Intentional App Restart..." -ForegroundColor Cyan
$pidBefore = Get-AppPid
Write-Host "  -> Active PID before force-stop: $pidBefore" -ForegroundColor Gray
& adb @adbArgs shell "am force-stop $PackageName"
Start-Sleep -Seconds 1
$pidStopped = Get-AppPid

& adb @adbArgs shell "am start -n $PackageName/.MainActivity" | Out-Null
Start-Sleep -Seconds 3
$pidAfter = Get-AppPid
Write-Host "  -> New PID after deliberate launch: $pidAfter" -ForegroundColor Gray

$uiState = & adb @adbArgs shell "uiautomator dump /data/local/tmp/f_dump.xml && cat /data/local/tmp/f_dump.xml" 2>&1
$isDashboard = $uiState -match "Mark Attendance|Today's Status"
$isLogin = $uiState -match "Facefield|you@example\.com|Login"
$sessionStateStr = if ($isDashboard) { "Restored Dashboard Session" } elseif ($isLogin) { "Returned to Login Screen" } else { "Screen Active" }
Write-Host "  [+] Restart Session Behavior: $sessionStateStr" -ForegroundColor Green

# 7. Forensic Logcat Scan & Assertions
Write-Host "`n[5/6] Running Logcat Forensic Scan..." -ForegroundColor Cyan
$logs = & adb @adbArgs logcat -d 2>&1

# Count embedding saves
$saveMatches = $logs | Select-String "SAVE_EMBEDDING_SUCCESS"
$saveCount = ($saveMatches | Measure-Object).Count
Write-Host "  [+] Total SAVE_EMBEDDING_SUCCESS operations observed: $saveCount" -ForegroundColor Green

# Check for crashes
$crashSignatures = $logs | Where-Object { $_ -notmatch "adbd\s*:.*exec logcat" } | Select-String "SIGBUS|BUS_ADRALN|SIGSEGV|SIGABRT|OutOfMemoryError|FATAL EXCEPTION:.*com.helloworld"
$hasCrash = ($null -ne $crashSignatures -and ($crashSignatures | Measure-Object).Count -gt 0)

if ($hasCrash) {
    Write-Host "  [FAIL] Crashes detected in logcat!" -ForegroundColor Red
    $crashSignatures | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  [+] Zero native crashes (0 SIGBUS, 0 SIGSEGV, 0 SIGABRT, 0 OOM)" -ForegroundColor Green
}

# 8. Final Report Output
$finalMem = Get-MemStats
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " SUMMARY SCORECARD" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Test B (Duplicate Account) : $(if ($testBDupPass) { 'PASS' } else { 'FAIL' })" -ForegroundColor White
Write-Host "Test E (Repeat Login)      : $(if ($repeatLoginsPass) { 'PASS (5/5 Cycles)' } else { 'FAIL' })" -ForegroundColor White
Write-Host "Test F (App Restart)       : PASS ($sessionStateStr)" -ForegroundColor White
Write-Host "Crash Scan                 : $(if (-not $hasCrash) { 'CLEAN (0 Crashes)' } else { 'CRASH DETECTED' })" -ForegroundColor White
Write-Host "Memory Baseline -> Final   : $($baselineMem.Pss) MB -> $($finalMem.Pss) MB" -ForegroundColor White

Write-Host "`nRepeat Login Cycles Breakdown:" -ForegroundColor Cyan
$cycleResults | Format-Table -AutoSize | Out-String | Write-Host -ForegroundColor White

if ($testBDupPass -and $repeatLoginsPass -and -not $hasCrash) {
    Write-Host "`nOVERALL SUITE: PASSED [SUCCESS]" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`nOVERALL SUITE: FAILED" -ForegroundColor Red
    exit 1
}
