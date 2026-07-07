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
  "schemas/openapi_draft.yaml",
  "schemas/database_schema.sql",
  "docs/release_checklist.md",
  "docs/final_acceptance_report.md",
  "docs/local_installation_guide.md",
  "docs/troubleshooting.md",
  "docs/release_notes_v0.10.0-rc1.md"
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
