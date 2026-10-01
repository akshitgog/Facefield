$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
. (Join-Path $project 'e2e-tests/scripts/camera-evidence.ps1')
$good = "CameraX started successfully`nCAMERAX_PREVIEW_STREAMING`nANALYSIS_RESULT status=RETRY"
if (-not (Test-CameraEvidence $good)) { throw 'Expected completed pipeline to pass' }
foreach ($bad in @('', 'CameraX started successfully', 'FRAME_RECEIVED',
    "CameraX started successfully`nCAMERAX_PREVIEW_STREAMING", "$good`nAnalyzer error", "$good`nANALYSIS_RESULT status=ERROR", "$good`nFATAL EXCEPTION")) {
    if (Test-CameraEvidence $bad) { throw "Invalid camera evidence passed: $bad" }
}
$files = Get-ChildItem -LiteralPath (Join-Path $project 'e2e-tests/scripts') -Filter '*.ps1'
foreach ($file in $files) {
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "$($file.Name): $parseErrors" }
}
Write-Host "Camera evidence cases passed; $($files.Count) PowerShell scripts parsed successfully."
