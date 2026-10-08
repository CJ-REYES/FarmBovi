$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location (Join-Path $projectRoot 'FrontEnd')
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falló' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'La compilación del frontend falló' }
} finally { Pop-Location }

Push-Location $projectRoot
try {
    dotnet publish BackEnd/FarmBovi.Api.csproj --configuration Release --output artifacts/publish
    if ($LASTEXITCODE -ne 0) { throw 'La publicación del backend falló' }
    New-Item -ItemType Directory -Force -Path 'artifacts/publish/wwwroot' | Out-Null
    Copy-Item -Path 'FrontEnd/dist/*' -Destination 'artifacts/publish/wwwroot' -Recurse -Force
    Write-Host "Publicación generada en $projectRoot/artifacts/publish"
} finally { Pop-Location }
