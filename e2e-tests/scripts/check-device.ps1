# check-device.ps1 — Validates ADB device connectivity and gathers hardware info
param([string]$DeviceSerial = "")

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path -Parent $ScriptDir) "config\load-env.ps1")

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField Device Validation" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Check any device connected
$devices = (adb devices 2>&1) -split "`n" | Where-Object { $_ -match "\tdevice$" }
if ($devices.Count -eq 0) {
    Write-Host "[ERROR] No ADB devices found. Connect a phone and enable USB debugging." -ForegroundColor Red
    exit 1
}
if ($devices.Count -gt 1 -and $DeviceSerial -eq "") {
    Write-Host "[ERROR] Multiple devices connected. Set DEVICE_SERIAL in .env or pass -DeviceSerial." -ForegroundColor Red
    $devices | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    exit 1
}

# Verify specific device
$state = (& adb @adb get-state 2>&1).Trim()
if ($state -ne "device") {
    Write-Host "[ERROR] Device '$DeviceSerial' state is '$state' (expected 'device'). Authorize USB debugging." -ForegroundColor Red
    exit 1
}

# Gather info
$info = @{
    Manufacturer = (& adb @adb shell getprop ro.product.manufacturer 2>&1).Trim()
    Model        = (& adb @adb shell getprop ro.product.model 2>&1).Trim()
    Android      = (& adb @adb shell getprop ro.build.version.release 2>&1).Trim()
    SDK          = (& adb @adb shell getprop ro.build.version.sdk 2>&1).Trim()
    ABI          = (& adb @adb shell getprop ro.product.cpu.abi 2>&1).Trim()
    Serial       = if ($DeviceSerial) { $DeviceSerial } else { "default" }
}

$memLine = (& adb @adb shell "cat /proc/meminfo" 2>&1) | Select-String "MemTotal" | Select-Object -First 1
$ramKB = 0
if ($memLine -match "(\d+)") { $ramKB = [int]$Matches[1] }

$wm = (& adb @adb shell "wm size" 2>&1).Trim()
$display = if ($wm -match "Physical size:\s*(.+)") { $Matches[1] } else { "unknown" }

Write-Host "[+] Device Connected" -ForegroundColor Green
Write-Host "  Manufacturer : $($info.Manufacturer)"
Write-Host "  Model        : $($info.Model)"
Write-Host "  Android      : $($info.Android) (API $($info.SDK))"
Write-Host "  ABI          : $($info.ABI)"
Write-Host "  RAM          : $([Math]::Round($ramKB / 1024)) MB"
Write-Host "  Display      : $display"
Write-Host "  Serial       : $($info.Serial)"

# Check package
$pkgCheck = & adb @adb shell "pm list packages $pkg" 2>&1
if ($pkgCheck -match "package:$pkg") {
    $appPid = (& adb @adb shell "pidof $pkg" 2>&1).Trim()
    Write-Host "[+] Package '$pkg' installed." -ForegroundColor Green
    if ($appPid -match "^\d+$") {
        Write-Host "  Running PID  : $appPid" -ForegroundColor Green
    } else {
        Write-Host "  Not currently running." -ForegroundColor Yellow
    }
} else {
    Write-Host "[*] Package '$pkg' NOT installed." -ForegroundColor Yellow
}

# Export device info as JSON for report consumption
$resultsDir = Join-Path (Split-Path -Parent $ScriptDir) "results"
if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null }
$deviceJson = @{
    serial = $info.Serial
    manufacturer = $info.Manufacturer
    model = $info.Model
    android = $info.Android
    sdk = $info.SDK
    abi = $info.ABI
    ramMB = [Math]::Round($ramKB / 1024)
    display = $display
    packageInstalled = ($pkgCheck -match "package:$pkg")
    timestamp = (Get-Date -Format "o")
} | ConvertTo-Json
Set-Content -Path (Join-Path $resultsDir "device-info.json") -Value $deviceJson -Encoding UTF8

Write-Host "[+] Device validation PASSED." -ForegroundColor Green
