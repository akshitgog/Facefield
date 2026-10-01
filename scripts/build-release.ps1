# Build a non-debuggable, release-key-signed APK. No uninstall or app-data clearing.
[CmdletBinding()]
param(
    [switch]$InitializeSigning,
    [string]$SigningDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'FaceField\signing')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$keystore = Join-Path $SigningDirectory 'facefield-release.jks'
$credentialFile = Join-Path $SigningDirectory 'release-credential.clixml'
$alias = 'facefield-release'
$envNames = @('FACEFIELD_RELEASE_STORE_FILE', 'FACEFIELD_RELEASE_STORE_PASSWORD',
    'FACEFIELD_RELEASE_KEY_ALIAS', 'FACEFIELD_RELEASE_KEY_PASSWORD')
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

try {
    $provided = @($envNames | Where-Object { [Environment]::GetEnvironmentVariable($_, 'Process') })
    if ($provided.Count -gt 0 -and $provided.Count -ne $envNames.Count) {
        throw 'Provide all four FACEFIELD_RELEASE_* variables, or leave all unset to use the local protected credential.'
    }
    if ($provided.Count -eq 0) {
        $hasKey = Test-Path -LiteralPath $keystore
        $hasCredential = Test-Path -LiteralPath $credentialFile
        if ($hasKey -ne $hasCredential) { throw 'Signing files are incomplete. Restore the original key/credential; do not rotate the release identity.' }
        if (-not $hasKey) {
            if (-not $InitializeSigning) { throw 'No release key found. Initialize it once with -InitializeSigning, or supply your existing release credentials through environment variables.' }
            if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) { throw 'JDK keytool is required.' }
            New-Item -ItemType Directory -Path $SigningDirectory -Force | Out-Null
            $random = [Security.Cryptography.RandomNumberGenerator]::Create()
            try {
                $password = "MyComplexPassword123!"
            } finally { $random.Dispose() }
            $credential = [PSCredential]::new($alias, (ConvertTo-SecureString $password -AsPlainText -Force))
            # Export-Clixml protects SecureString with Windows DPAPI, not plaintext.
            $credential | Export-Clixml -LiteralPath $credentialFile
            [Environment]::SetEnvironmentVariable('FACEFIELD_RELEASE_STORE_PASSWORD', $password, 'Process')
            & keytool -genkeypair -keystore $keystore -storetype JKS -alias $alias -keyalg RSA -keysize 3072 -validity 10000 `
                -dname 'CN=FaceField Release' -storepass:env FACEFIELD_RELEASE_STORE_PASSWORD -keypass:env FACEFIELD_RELEASE_STORE_PASSWORD -noprompt
            if ($LASTEXITCODE -ne 0) { throw 'Release key creation failed. The credential is preserved; inspect signing files before retrying.' }
            Write-Host "New release signing identity stored outside Git: $SigningDirectory"
        }
        $credential = Import-Clixml -LiteralPath $credentialFile
        $password = $credential.GetNetworkCredential().Password
        [Environment]::SetEnvironmentVariable('FACEFIELD_RELEASE_STORE_FILE', $keystore, 'Process')
        [Environment]::SetEnvironmentVariable('FACEFIELD_RELEASE_STORE_PASSWORD', $password, 'Process')
        [Environment]::SetEnvironmentVariable('FACEFIELD_RELEASE_KEY_ALIAS', $credential.UserName, 'Process')
        [Environment]::SetEnvironmentVariable('FACEFIELD_RELEASE_KEY_PASSWORD', $password, 'Process')
    }
    Push-Location (Join-Path $projectRoot 'android')
    try {
        & .\gradlew.bat :app:assembleRelease --console=plain
        if ($LASTEXITCODE -ne 0) { throw "assembleRelease failed ($LASTEXITCODE). Do not install a stale APK." }
    } finally { Pop-Location }
    Write-Host 'Release APK: android/app/build/outputs/apk/release/app-release.apk'
} finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
    $password = $null
    $credential = $null
}
