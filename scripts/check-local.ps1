$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Checking PostgreSQL"
psql --version
pg_isready

Write-Host "Checking API"
Push-Location apps/api
alembic current
pytest
Pop-Location

Write-Host "Checking Web"
corepack pnpm --filter web typecheck
corepack pnpm --filter web lint

Write-Host "chat-reader local checks completed"
