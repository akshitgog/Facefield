# ==============================================================================
# Helper to load config/.env file safely into process environment
# ==============================================================================
param(
    [string]$EnvFile = "$PSScriptRoot\.env"
)

if (-not (Test-Path $EnvFile)) {
    $EnvExample = "$PSScriptRoot\.env.example"
    if (Test-Path $EnvExample) {
        Write-Warning "No .env found. Loading defaults from .env.example..."
        $EnvFile = $EnvExample
    } else {
        Write-Error "Configuration file not found: $EnvFile"
        return
    }
}

Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#")) {
        $idx = $line.IndexOf("=")
        if ($idx -gt 0) {
            $key = $line.Substring(0, $idx).Trim()
            $val = $line.Substring($idx + 1).Trim()
            [Environment]::SetEnvironmentVariable($key, $val, "Process")
        }
    }
}
