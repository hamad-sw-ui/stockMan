# Applique les scripts SQL dans l'ordre sur la base indiquée par DATABASE_URL.
# Prérequis : PostgreSQL client (psql) dans le PATH.
# Usage (depuis la racine du dépôt) :
#   $env:DATABASE_URL = "postgresql://user:pass@localhost:5432/stockman"
#   powershell -ExecutionPolicy Bypass -File database/apply.ps1

param(
    [string]$DatabaseUrl = $env:DATABASE_URL
)

$ErrorActionPreference = "Stop"

if (-not $DatabaseUrl) {
    Write-Error "Definissez la variable d'environnement DATABASE_URL (URI PostgreSQL)."
}

$RepoRoot = Split-Path $PSScriptRoot -Parent
$files = @(
    "database.sql",
    "migration_phase3.sql",
    "migration_phase3_movements.sql",
    "migration_phase4.sql"
)

foreach ($name in $files) {
    $path = Join-Path $RepoRoot $name
    if (-not (Test-Path $path)) {
        Write-Error "Fichier introuvable : $path"
    }
    Write-Host ">> $name"
    & psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $path
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

Write-Host "Schema applique. Etapes optionnelles :"
Write-Host "  - cd backend ; node create-admin.js   (compte super admin)"
Write-Host "  - psql ... -f seed_roles.sql puis seed_data.sql (donnees de demo, si compatibles)"
