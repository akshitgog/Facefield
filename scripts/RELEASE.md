# Android release build

Build the root app with `pwsh -NoProfile -File scripts/build-release.ps1`.
Initialize a new signing identity only once with `-InitializeSigning`. Existing
keys are reused, never overwritten. The APK is `android/app/build/outputs/apk/release/app-release.apk`.
Release builds are non-debuggable and never fall back to the debug signing key.

Local signing material is in `%LOCALAPPDATA%/FaceField/signing`, outside Git:
`facefield-release.jks` and `release-credential.clixml`. The credential is encrypted
with Windows DPAPI and can only be decrypted by the original Windows account on
that machine. Back up the keystore and save its password securely in a password
manager before distributing this release; the CLIXML file alone is not a portable
credential backup. Losing the signing key prevents signing compatible updates.

For an existing keystore or CI, provide all four process environment variables:
`FACEFIELD_RELEASE_STORE_FILE`, `FACEFIELD_RELEASE_STORE_PASSWORD`,
`FACEFIELD_RELEASE_KEY_ALIAS`, `FACEFIELD_RELEASE_KEY_PASSWORD`.
Do not commit signing keys, passwords, or credential files. Direct Gradle release
builds fail if these credentials are absent; debug builds continue using the debug key.

An APK signed with this release identity cannot replace a debug-key-signed install
of the same package. Do not uninstall or clear user data without authorization.
Signing the APK does not publish it to Google Play.
