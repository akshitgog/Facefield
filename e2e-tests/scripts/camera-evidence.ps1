# Evidence is scoped to the current app PID and a device-clock checkpoint.
function Get-CameraCheckpoint {
    param([string[]]$AdbArgs)
    $checkpoint = (& adb @AdbArgs shell "date '+%m-%d %H:%M:%S.000'" 2>&1) -join ''
    if ($LASTEXITCODE -ne 0 -or $checkpoint -notmatch '^\d\d-\d\d \d\d:\d\d:\d\d\.000$') {
        throw 'Could not obtain device time for camera evidence.'
    }
    return $checkpoint.Trim()
}

function Test-CameraEvidence {
    param([string]$Logs)
    return ($Logs -match 'CameraX started successfully' -and
        $Logs -match 'CAMERAX_PREVIEW_STREAMING' -and
        $Logs -match 'ANALYSIS_RESULT' -and
        $Logs -notmatch 'CameraX start failed|Analyzer error|ANALYSIS_RESULT status=ERROR|Failed to init Face|FATAL EXCEPTION|Fatal signal|OutOfMemoryError')
}

function Assert-CameraPipeline {
    param([string[]]$AdbArgs, [string]$AppPid, [string]$Since)
    if ($AppPid -notmatch '^\d+$') { throw 'App process is missing.' }
    $logs = (& adb @AdbArgs logcat -d --pid=$AppPid -v raw -T $Since 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0 -or -not (Test-CameraEvidence $logs)) {
        throw 'Camera pipeline not proven: require fresh bind, preview streaming, and completed analysis without errors.'
    }
}
