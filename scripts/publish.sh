#!/usr/bin/env bash
# Build a combined deployment without touching the server's database.
set -euo pipefail
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root/FrontEnd"
npm ci
npm run build
cd "$project_root"
dotnet publish BackEnd/FarmBovi.Api.csproj --configuration Release --output artifacts/publish
mkdir -p artifacts/publish/wwwroot
cp -R FrontEnd/dist/. artifacts/publish/wwwroot/
printf 'Publicación generada en %s/artifacts/publish\n' "$project_root"
