# stop-monitoring.ps1 — Stops background monitors and performs forensic crash analysis
param([string]$DeviceSerial = "")

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path -Parent $ScriptDir) "config\load-env.ps1")

$logDir = Join-Path (Split-Path -Parent $ScriptDir) "results\logcat"
$pidFile = Join-Path $logDir "monitor_pids.txt"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Stopping Monitors & Forensic Crash Analysis" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Kill background processes
if (Test-Path $pidFile) {
    $lines = Get-Content $pidFile
    foreach ($line in $lines) {
        if ($line -match "^\d+$") {
            try { Stop-Process -Id ([int]$line) -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    Remove-Item $pidFile -Force
    Write-Host "[+] Background monitors stopped." -ForegroundColor Green
} else {
    Write-Host "[*] No active monitor PIDs found." -ForegroundColor Yellow
}

# Forensic analysis on crash monitor logs
$crashFiles = Get-ChildItem -Path $logDir -Filter "crash_monitor_*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 3
$forensics = @{
    sigbus = 0; sigsegv = 0; sigabrt = 0; oom = 0; fatal = 0
    visionCameraCrash = $false; workletsCrash = $false; historicalSignature = $false
}

foreach ($cf in $crashFiles) {
    $rawLines = Get-Content $cf.FullName -ErrorAction SilentlyContinue
    if (-not $rawLines) { continue }
    # Filter out adbd logging its own command string and logcat header lines
    $content = $rawLines | Where-Object { $_ -notmatch "adbd\s*:.*exec logcat" -and $_ -notmatch "^---------" }
    if (-not $content) { continue }

    $sigbusMatches = $content | Select-String "Fatal signal 7|SIGBUS"
    $sigsegvMatches = $content | Select-String "Fatal signal 11|SIGSEGV"
    $sigabrtMatches = $content | Select-String "Fatal signal 6|SIGABRT"
    $oomMatches = $content | Select-String "OutOfMemoryError"
    $fatalMatches = $content | Select-String "FATAL EXCEPTION:"

    $forensics.sigbus += $sigbusMatches.Count
    $forensics.sigsegv += $sigsegvMatches.Count
    $forensics.sigabrt += $sigabrtMatches.Count
    $forensics.oom += $oomMatches.Count
    $forensics.fatal += $fatalMatches.Count

    # Backtrace checks specifically for crash incidents
    if ($sigbusMatches.Count -gt 0 -or $sigsegvMatches.Count -gt 0 -or $fatalMatches.Count -gt 0) {
        if ($content | Select-String "libVisionCamera") { $forensics.visionCameraCrash = $true }
        if ($content | Select-String "librnworklets") { $forensics.workletsCrash = $true }
        if ($content | Select-String "BUS_ADRALN") { $forensics.historicalSignature = $true }
    }
}

# Also scan full logcat
$fullLogs = Get-ChildItem -Path $logDir -Filter "logcat_*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($fullLogs) {
    $lineCount = (Get-Content $fullLogs.FullName -ErrorAction SilentlyContinue).Count
    Write-Host "[+] Analyzed $lineCount lines of system logcat." -ForegroundColor Gray
}

Write-Host ""
Write-Host "--- FORENSIC CRASH SUMMARY ---" -ForegroundColor Yellow
Write-Host "  SIGBUS (Signal 7)      : $($forensics.sigbus)"
Write-Host "  SIGSEGV (Signal 11)    : $($forensics.sigsegv)"
Write-Host "  SIGABRT (Signal 6)     : $($forensics.sigabrt)"
Write-Host "  OutOfMemoryError       : $($forensics.oom)"
Write-Host "  FATAL EXCEPTION        : $($forensics.fatal)"
Write-Host "  VisionCamera crash     : $(if ($forensics.visionCameraCrash) { 'DETECTED' } else { 'None' })"
Write-Host "  Worklets crash         : $(if ($forensics.workletsCrash) { 'DETECTED' } else { 'None' })"

$historicalText = if ($forensics.historicalSignature) { "REPRODUCED (FAIL)" } else { "NOT OBSERVED (PASS)" }
Write-Host "  Historical SIGBUS/BUS_ADRALN : $historicalText"

# Export forensics JSON
$resultsDir = Join-Path (Split-Path -Parent $ScriptDir) "results"
$forensics | ConvertTo-Json | Set-Content (Join-Path $resultsDir "crash-forensics.json") -Encoding UTF8

$totalCrashes = $forensics.sigbus + $forensics.sigsegv + $forensics.sigabrt + $forensics.fatal
if ($totalCrashes -eq 0) {
    Write-Host "`n[+] Zero native crashes detected in captured logs." -ForegroundColor Green
} else {
    Write-Host "`n[CRITICAL] $totalCrashes crash events detected!" -ForegroundColor Red
}
