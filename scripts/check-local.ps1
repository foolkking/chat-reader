$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Assert-LocalCommandSucceeded([string]$step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed (exit code $LASTEXITCODE)."
  }
}

Write-Host "Checking PostgreSQL"
psql --version
Assert-LocalCommandSucceeded "PostgreSQL client check"
pg_isready
Assert-LocalCommandSucceeded "PostgreSQL readiness check"

Write-Host "Checking API"
Push-Location apps/api
try {
  alembic current
  Assert-LocalCommandSucceeded "API migration check"
  pytest
  Assert-LocalCommandSucceeded "API tests"
} finally {
  Pop-Location
}

Write-Host "Checking Web"
corepack pnpm --filter web typecheck
Assert-LocalCommandSucceeded "Web typecheck"
corepack pnpm --filter web lint
Assert-LocalCommandSucceeded "Web lint"

Write-Host "chat-reader local checks completed"
