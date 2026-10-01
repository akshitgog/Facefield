# load-env.ps1 — Loads .env or .env.example into environment variables
$_cfgDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$_envFile = Join-Path $_cfgDir ".env"
$_exampleFile = Join-Path $_cfgDir ".env.example"

if (Test-Path $_envFile) {
    $_source = $_envFile
} elseif (Test-Path $_exampleFile) {
    $_source = $_exampleFile
} else {
    Write-Host "[ERROR] No .env or .env.example found in $_cfgDir" -ForegroundColor Red
    return
}

Get-Content $_source | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    if ($line -match "^([^=]+)=(.*)$") {
        $k = $Matches[1].Trim()
        $v = $Matches[2].Trim()
        [Environment]::SetEnvironmentVariable($k, $v, "Process")
    }
}
Remove-Variable -Name _cfgDir, _envFile, _exampleFile, _source, k, v -ErrorAction SilentlyContinue
