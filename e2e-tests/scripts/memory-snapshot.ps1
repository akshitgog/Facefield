# memory-snapshot.ps1 — Takes a single memory snapshot via dumpsys meminfo
param(
    [Alias("DeviceId")]
    [string]$DeviceSerial = "",
    [string]$Label = "snapshot",
    [string]$PackageName = ""
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path (Split-Path -Parent $ScriptDir) "config\load-env.ps1")

if ($DeviceSerial -eq "") { $DeviceSerial = $env:DEVICE_SERIAL }
$pkg = if ($PackageName -ne "") { $PackageName } elseif ($env:PACKAGE_NAME) { $env:PACKAGE_NAME } else { "com.helloworld" }

$adb = @()
if ($DeviceSerial -ne "") { $adb = @("-s", $DeviceSerial) }

$memDir = Join-Path (Split-Path -Parent $ScriptDir) "results\memory"
if (-not (Test-Path $memDir)) { New-Item -ItemType Directory -Path $memDir -Force | Out-Null }
$csvFile = Join-Path $memDir "memory.csv"

# Initialize CSV if not present
if (-not (Test-Path $csvFile)) {
    "Timestamp,Label,PID,TotalPssKB,JavaHeapKB,NativeHeapKB,GraphicsKB,CodeKB,StackKB" | Set-Content $csvFile -Encoding UTF8
}

# Get PID
$pidStr = (& adb @adb shell "pidof $pkg" 2>&1).Trim()
$appPid = if ($pidStr -match "^(\d+)") { $Matches[1] } else { "0" }

if ($appPid -eq "0") {
    Write-Host "[WARN] Process '$pkg' not running. Skipping memory snapshot." -ForegroundColor Yellow
    return
}

# Capture dumpsys meminfo
$raw = & adb @adb shell "dumpsys meminfo $pkg" 2>&1

# Parse App Summary block
$totalPss = 0; $javaHeap = 0; $nativeHeap = 0; $graphics = 0; $code = 0; $stack = 0

foreach ($line in $raw) {
    if ($line -match "Java Heap:\s+(\d+)") { $javaHeap = [int]$Matches[1] }
    elseif ($line -match "Native Heap:\s+(\d+)") { $nativeHeap = [int]$Matches[1] }
    elseif ($line -match "Graphics:\s+(\d+)") { $graphics = [int]$Matches[1] }
    elseif ($line -match "Code:\s+(\d+)") { $code = [int]$Matches[1] }
    elseif ($line -match "Stack:\s+(\d+)") { $stack = [int]$Matches[1] }
    elseif ($line -match "TOTAL PSS:\s+(\d+)") { $totalPss = [int]$Matches[1] }
    elseif ($line -match "TOTAL:\s+(\d+)" -and $totalPss -eq 0) { $totalPss = [int]$Matches[1] }
}

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"$ts,$Label,$appPid,$totalPss,$javaHeap,$nativeHeap,$graphics,$code,$stack" | Add-Content $csvFile -Encoding UTF8

$totalMB = [Math]::Round($totalPss / 1024, 1)
$nativeMB = [Math]::Round($nativeHeap / 1024, 1)
Write-Host "[$ts] Memory [$Label] PID=$appPid | PSS=${totalMB}MB | Native=${nativeMB}MB | Java=$([Math]::Round($javaHeap/1024,1))MB | Graphics=$([Math]::Round($graphics/1024,1))MB" -ForegroundColor Gray
