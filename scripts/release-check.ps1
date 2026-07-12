$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "Running chat-reader release check"

$status = git status --short
if ($status) {
  $status
  throw "Working tree is not clean"
}

foreach ($file in @(
  "README.md",
  "PROJECT_STATE.md",
  "schemas/openapi_draft.yaml",
  "schemas/database_schema.sql",
  "docs/index.md",
  "docs/product.md",
  "docs/architecture.md",
  "docs/api-reference.md",
  "docs/development.md",
  "docs/deployment.md",
  "docs/troubleshooting.md"
)) {
  if (-not (Test-Path $file)) {
    throw "Required release file missing: $file"
  }
}

& "$PSScriptRoot\check-local.ps1"

Write-Host "Checking migration head"
Push-Location apps/api
alembic current
Pop-Location

Write-Host "Release check completed"
