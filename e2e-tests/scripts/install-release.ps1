# install-release.ps1 - Builds (optional) and installs the Release APK
param(
    [string]$DeviceSerial = "",
    [switch]$Build,
    [switch]$FreshInstall
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..\")).Path
. (Join-Path (Split-Path -Parent $ScriptDir) "config\load-env.ps1")

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }
$apkRel = if ($env:APK_PATH) { $env:APK_PATH } else { "android/app/build/outputs/apk/release/app-release.apk" }
$apkPath = Join-Path $ProjectRoot $apkRel

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " FaceField Release APK Installation" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Optional: Build
if ($Build) {
    Write-Host "[1] Building Release APK..." -ForegroundColor Yellow
    $androidDir = Join-Path $ProjectRoot "android"
    if (-not (Test-Path (Join-Path $androidDir "gradlew.bat"))) {
        Write-Host "[ERROR] gradlew.bat not found in $androidDir" -ForegroundColor Red
        exit 1
    }
    Push-Location $androidDir
    try {
        & (Join-Path $ProjectRoot 'scripts\build-release.ps1')
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[ERROR] Release build FAILED. Exit code: $LASTEXITCODE" -ForegroundColor Red
            Write-Host "[CRITICAL] Do NOT test with a stale APK. Fix the build first." -ForegroundColor Red
            exit 1
        }
        Write-Host "[+] Build succeeded." -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] Release build failed: $_" -ForegroundColor Red
        exit 1
    } finally {
        Pop-Location
    }
    $apkPath = Join-Path $ProjectRoot "android\app\build\outputs\apk\release\app-release.apk"
}

# Verify APK exists
if (-not (Test-Path $apkPath)) {
    Write-Host "[ERROR] Release APK not found at: $apkPath. Run with -Build." -ForegroundColor Red
    exit 1
}

$apkPath = (Resolve-Path -LiteralPath $apkPath).Path
if ($apkPath.StartsWith((Join-Path $ProjectRoot 'Source_Code') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing legacy Source_Code APK: use the active root Android project.'
}

Write-Host "[+] APK: $apkPath" -ForegroundColor Green
$apkSize = [Math]::Round((Get-Item $apkPath).Length / 1MB, 2)
$apkModified = (Get-Item $apkPath).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
Write-Host "  Size     : ${apkSize} MB"
Write-Host "  Modified : $apkModified"

# Safety: verify package name before uninstall
if ($FreshInstall) {
    Write-Host "[2] Fresh install - uninstalling '$pkg'..." -ForegroundColor Yellow
    if ($pkg -notmatch "^com\.helloworld$|^com\.facefield") {
        Write-Host "[SAFETY] Refusing to uninstall package '$pkg' - does not match expected pattern." -ForegroundColor Red
        exit 1
    }
    & adb @adb uninstall $pkg 2>$null
    Write-Host "[+] Uninstalled (or was not present)." -ForegroundColor Green
}

# Install
Write-Host "[3] Installing APK..." -ForegroundColor Yellow
$instOut = & adb @adb install -r -g $apkPath 2>&1
if ($LASTEXITCODE -ne 0 -or ($instOut -join " ") -notmatch "Success") {
    Write-Host "[*] Standard install restricted. Installing via staged /data/local/tmp..." -ForegroundColor Yellow
    & adb @adb push $apkPath /data/local/tmp/app-release.apk | Out-Null
    $pmOut = (& adb @adb shell "pm install -r -g /data/local/tmp/app-release.apk" 2>&1) -join " "
    & adb @adb shell "rm /data/local/tmp/app-release.apk" 2>$null | Out-Null
    if ($pmOut -notmatch "Success") {
        Write-Host "[ERROR] APK installation failed: $pmOut" -ForegroundColor Red
        exit 1
    }
}
Write-Host "[+] Installed successfully." -ForegroundColor Green

# Verify
$verify = & adb @adb shell "pm list packages $pkg" 2>&1
if ($verify -notmatch "package:$pkg") {
    Write-Host "[ERROR] Post-install verification failed - package not found." -ForegroundColor Red
    exit 1
}

# Record installed APK info
$resultsDir = Join-Path (Split-Path -Parent $ScriptDir) "results"
if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null }
@{
    apkPath = $apkPath
    apkSizeMB = $apkSize
    apkModified = $apkModified
    freshInstall = $FreshInstall.IsPresent
    installedAt = (Get-Date -Format "o")
} | ConvertTo-Json | Set-Content (Join-Path $resultsDir "apk-info.json") -Encoding UTF8

Write-Host "[+] APK installation complete and verified." -ForegroundColor Green
