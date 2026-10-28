param(
    [string]$SdkPath = $env:ANDROID_HOME,
    [string]$JavaPath = $env:JAVA_HOME,
    [string]$GradleHome = $env:GRADLE_USER_HOME
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot

# Los parámetros y las variables del usuario tienen prioridad. Los candidatos
# sólo facilitan el primer build con Android Studio en Windows.
if (-not $SdkPath) {
    $SdkPath = @($env:ANDROID_SDK_ROOT, "$env:LOCALAPPDATA\Android\Sdk", 'D:\Android\Sdk') |
        Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms\android-36')) } |
        Select-Object -First 1
}
if (-not $JavaPath) {
    $JavaPath = "$env:ProgramFiles\Android\Android Studio\jbr"
}
if (-not $SdkPath -or -not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-36'))) {
    throw 'Instala Android SDK Platform 36 y configura ANDROID_HOME o -SdkPath.'
}
if (-not (Test-Path -LiteralPath (Join-Path $JavaPath 'bin\java.exe'))) {
    throw 'Configura JAVA_HOME o -JavaPath con un JDK 21 (Android Studio incluye uno).'
}

$saved = @{}
foreach ($name in @('ANDROID_HOME', 'JAVA_HOME', 'GRADLE_USER_HOME', 'LEN_DEV_URL')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location $appRoot
try {
    $env:ANDROID_HOME = $SdkPath
    $env:JAVA_HOME = $JavaPath
    if ($GradleHome) { $env:GRADLE_USER_HOME = $GradleHome }
    # El APK siempre lleva dist dentro. Un LEN_DEV_URL heredado no puede
    # convertir accidentalmente la entrega en un visor del servidor Vite.
    Remove-Item Env:LEN_DEV_URL -ErrorAction SilentlyContinue

    & node '../node_modules/typescript/bin/tsc' '-p' 'tsconfig.json' '--noEmit'
    if ($LASTEXITCODE -ne 0) { throw 'Falló TypeScript.' }
    & node 'node_modules/vite/bin/vite.js' 'build'
    if ($LASTEXITCODE -ne 0) { throw 'Falló el build web.' }
    & node 'node_modules/@capacitor/cli/bin/capacitor' 'sync' 'android'
    if ($LASTEXITCODE -ne 0) { throw 'Falló Capacitor sync.' }
    & '.\android\gradlew.bat' '-p' 'android' '--no-daemon' '--console=plain' 'assembleDebug'
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de Android.' }

    $apk = Join-Path $appRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $apk)) { throw 'Gradle no produjo el APK esperado.' }
    Write-Output "APK de pruebas: $apk"
    # Compatible tambien con Windows PowerShell sin Get-FileHash.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($apk)
    try {
        $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        Write-Output "SHA256: $hash"
    } finally {
        $stream.Dispose()
        $sha.Dispose()
    }
} finally {
    Pop-Location
    foreach ($name in $saved.Keys) {
        [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
    }
}
