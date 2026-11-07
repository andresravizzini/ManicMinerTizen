param(
    [Parameter(Mandatory = $true)][string]$TzPath,
    [Parameter(Mandatory = $true)][string]$SigningProfile
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $TzPath)) { throw 'No se encuentra el CLI tz indicado.' }
$TzPath = (Resolve-Path -LiteralPath $TzPath).Path
Push-Location $projectRoot
try {
    & node tools/build-tv.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falló la generación web.' }
    Push-Location (Join-Path $projectRoot 'tizen')
    try {
        & $TzPath build -b Release -s $SigningProfile
        if ($LASTEXITCODE -ne 0) { throw 'Falló tz build.' }
        & $TzPath pack -s $SigningProfile
        if ($LASTEXITCODE -ne 0) { throw 'Falló tz pack.' }
        $packagePath = Join-Path $projectRoot 'tizen\Release\tizen.wgt'
        if (-not (Test-Path -LiteralPath $packagePath)) { throw 'No se generó el WGT.' }
        $artifactDir = Join-Path $projectRoot 'artifacts'
        New-Item -ItemType Directory -Force $artifactDir | Out-Null
        Copy-Item -LiteralPath $packagePath -Destination (Join-Path $artifactDir 'ManicMinerTizen.wgt')
        Write-Output 'Paquete generado: artifacts\ManicMinerTizen.wgt'
    } finally { Pop-Location }
} finally { Pop-Location }
